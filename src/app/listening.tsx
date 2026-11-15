import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { File, Paths } from 'expo-file-system';
import { useSQLiteContext } from 'expo-sqlite';
import { AudioModule, setAudioModeAsync, useAudioRecorder, useAudioRecorderState, type RecordingOptions } from 'expo-audio';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import Svg, { Path } from 'react-native-svg';

import { Icon } from '../components/Icon';
import { Txt } from '../components/Txt';
import { createVoiceLog, setOutcome } from '../db/repo';
import { writer } from '../device';
import { joinWavs } from '../gemini/audio';
import { NO_KEY_BN, NO_KEY_HELP_BN, hasGemini } from '../lib/engine';
import { GEMINI_WAIT_MS, runGemini } from '../lib/gemini';
import { MAX_MS, START as ENDPOINT_START, barLevel, feed, type EndpointState } from '../lib/endpoint';
import { bumpQueue, gate } from '../lib/understand';
import { speak } from '../lib/speak';
import { withTimeout } from '../lib/withTimeout';
import { QUEUED_BN, queueNext } from '../queue/listen';
import { classify, enqueueUnderstanding } from '../queue/understand';
import { colors, fontSize, radius, spacing } from '../theme/tokens';
import { nav } from '../lib/nav';

type Phase = 'starting' | 'listening' | 'paused' | 'thinking' | 'error' | 'nokey';

/**
 * Every command is a clip for Gemini: AAC, mono, 16 kHz (≈ 4 KB/s) in ADTS, which Gemini takes
 * and the Drive upload sends as it is. Metering gives the sound bars and the end of speech.
 */
const AAC_16K: RecordingOptions = {
  extension: '.aac',
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 32000,
  isMeteringEnabled: true,
  android: { extension: '.aac', outputFormat: 'aac_adts', audioEncoder: 'aac' },
  ios: { extension: '.aac', audioQuality: 32, outputFormat: 'aac ' },
  web: {},
};

/**
 * Android 13+: the phone's recognizer runs beside Gemini only to show the words as they are said
 * and to keep the clip (WAV, 16 kHz). Gemini alone understands the command. Older phones can't keep
 * the clip that way, so expo-audio records it and there are no live words.
 */
const LIVE = Platform.OS === 'android' && Number(Platform.Version) >= 33;

const STT_ERROR_BN: Record<string, string> = {
  'no-speech': 'কিছু শুনতে পাইনি',
  'speech-timeout': 'কিছু শুনতে পাইনি',
  network: 'ইন্টারনেট নেই। নেট চালু করে আবার বলুন',
  'not-allowed': 'মাইকের অনুমতি দিন',
  'language-not-supported': 'এই ফোনে বাংলা শোনা যাচ্ছে না',
  busy: 'মাইক ব্যস্ত, একটু পরে বলুন',
};

/** শুনছি: the clip → Gemini (≤ ~12 s). Understood → the confirm card; no net / 429 / error → the queue. */
export default function ListeningScreen() {
  const db = useSQLiteContext();
  /** customer / kind: from the customer screen (জমা নিন / বাকি দিন), passed on to the confirm card. */
  const { tab = 'sale', customer, kind } = useLocalSearchParams<{ tab?: string; customer?: string; kind?: string }>();
  const carry = { ...(customer ? { customer } : {}), ...(kind ? { kind } : {}) };
  /** No goods to pick: বাকি/জমা and খরচ fall back to the number pad. */
  const byPad = tab === 'ledger' || tab === 'expense';
  const [phase, setPhase] = useState<Phase>('starting');
  const [errorText, setErrorText] = useState('');
  const recorder = useAudioRecorder(AAC_16K);
  const rec = useAudioRecorderState(recorder, 100);
  const endpoint = useRef<EndpointState>(ENDPOINT_START);
  const stopping = useRef(false);
  /** ✕ pressed: drop a Gemini answer that comes in later. */
  const left = useRef(false);
  const [heard, setHeard] = useState('');
  const [liveVolume, setLiveVolume] = useState(0);
  const heardRef = useRef('');
  /** Phrases the recognizer has already finished. */
  const doneText = useRef('');
  /** One clip per recognizer session: pause ends a session, resume starts the next. */
  const segments = useRef<string[]>([]);
  const pausing = useRef(false);
  const sttError = useRef<string | null>(null);
  const volume = LIVE ? liveVolume : barLevel(rec.metering);

  function beginRecognizer() {
    ExpoSpeechRecognitionModule.start({
      lang: 'bn-BD',
      interimResults: true,
      continuous: false,
      recordingOptions: { persist: true, outputDirectory: Paths.document.uri, outputFileName: `voice_${Date.now()}.wav` },
      volumeChangeEventOptions: { enabled: true, intervalMillis: 120 },
    });
  }

  const start = useCallback(async () => {
    left.current = false;
    stopping.current = false;
    endpoint.current = ENDPOINT_START;
    if (!hasGemini()) {
      setErrorText(NO_KEY_BN);
      setPhase('nokey');
      void speak(NO_KEY_HELP_BN);
      return;
    }
    setPhase('starting');
    setHeard('');
    heardRef.current = '';
    doneText.current = '';
    segments.current = [];
    pausing.current = false;
    sttError.current = null;
    if (LIVE) {
      const p = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!p.granted) {
        setErrorText(STT_ERROR_BN['not-allowed']!);
        setPhase('error');
        return;
      }
      beginRecognizer();
      return;
    }
    const perm = await AudioModule.requestRecordingPermissionsAsync();
    if (!perm.granted) {
      setErrorText('মাইকের অনুমতি দিন');
      setPhase('error');
      return;
    }
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setPhase('listening');
    } catch (e) {
      console.warn('record failed', e);
      setErrorText('মাইক ব্যস্ত, একটু পরে বলুন');
      setPhase('error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void start();
    return () => {
      left.current = true;
      if (LIVE) ExpoSpeechRecognitionModule.abort();
      else if (!stopping.current) void recorder.stop().catch(() => undefined);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start]);

  // end of speech from the level; the button does the same
  useEffect(() => {
    if (LIVE || phase !== 'listening' || stopping.current) return;
    const r = feed(endpoint.current, rec.metering, rec.durationMillis);
    endpoint.current = r.state;
    if (r.verdict === 'stop') void stop();
    else if (r.verdict === 'nothing') void stop(true);
    else if (rec.durationMillis >= MAX_MS) void stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec.metering, rec.durationMillis, phase]);

  useSpeechRecognitionEvent('start', () => setPhase('listening'));
  useSpeechRecognitionEvent('volumechange', (e) => setLiveVolume(Math.max(0, Math.min(1, (e.value + 2) / 12))));
  useSpeechRecognitionEvent('result', (e) => {
    // a final result closes one phrase and the next result starts a new one: keep every phrase
    // instead of letting the latest replace the rest
    const part = e.results[0]?.transcript ?? '';
    const text = [doneText.current, part].filter(Boolean).join(' ');
    if (e.isFinal) doneText.current = text;
    heardRef.current = text;
    setHeard(text);
  });
  useSpeechRecognitionEvent('audioend', (e) => {
    if (e.uri) segments.current.push(e.uri);
  });
  useSpeechRecognitionEvent('error', (e) => {
    sttError.current = e.error;
  });
  useSpeechRecognitionEvent('end', () => {
    if (!LIVE || stopping.current) return;
    if (pausing.current) {
      setPhase('paused');
      return;
    }
    void finishLive();
  });

  /** The recognizer is done: the clip goes to Gemini whether or not the phone heard words. */
  async function finishLive() {
    stopping.current = true;
    const saidAt = Date.now();
    const code = sttError.current;
    if (code === 'aborted' && !heardRef.current) return;
    const clip = await joinSegments();
    if (!clip) {
      setErrorText(STT_ERROR_BN[code ?? 'no-speech'] ?? 'কিছু শুনতে পাইনি');
      stopping.current = false;
      setPhase('error');
      return;
    }
    await understand(clip, saidAt);
  }

  /** The clips of every session as one file for Gemini (one session = the clip as it is). */
  async function joinSegments(): Promise<string | null> {
    const parts = segments.current;
    if (parts.length <= 1) return parts[0] ?? null;
    try {
      const joined = joinWavs(await Promise.all(parts.map((u) => new File(u).bytes())));
      const dest = new File(Paths.document, `voice_${Date.now()}.wav`);
      dest.create();
      dest.write(joined);
      parts.forEach((u) => {
        try {
          new File(u).delete();
        } catch {
          // a leftover part is harmless
        }
      });
      return dest.uri;
    } catch (e) {
      console.warn('joining the clips failed, using the first', e);
      return parts[0] ?? null;
    }
  }

  /** ⏸: the clip so far is kept; nothing is sent until থামুন. */
  function pause() {
    if (phase !== 'listening') return;
    if (LIVE) {
      pausing.current = true;
      ExpoSpeechRecognitionModule.stop();
      return;
    }
    try {
      recorder.pause();
      setPhase('paused');
    } catch (e) {
      console.warn('pause failed', e);
    }
  }

  /** ▶️: recording continues after the pause; the words and the clip keep adding up. */
  function resume() {
    if (phase !== 'paused') return;
    if (LIVE) {
      pausing.current = false;
      sttError.current = null;
      beginRecognizer();
      return;
    }
    endpoint.current = ENDPOINT_START;
    recorder.record();
    setPhase('listening');
  }

  /** থামুন: while paused the recognizer is already done, so the clips go straight on. */
  function finish() {
    if (LIVE) {
      if (phase === 'paused') void finishLive();
      else ExpoSpeechRecognitionModule.stop();
    } else void stop();
  }

  async function stop(silent = false) {
    if (stopping.current) return;
    stopping.current = true;
    const saidAt = Date.now();
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    } catch (e) {
      console.warn('stop failed', e);
    }
    if (silent || !recorder.uri) {
      setErrorText('কিছু শুনতে পাইনি');
      setPhase('error');
      return;
    }
    // the clip lives with the app (not the cache): ▶️ later, Drive, the queue
    let clip = recorder.uri;
    try {
      const dest = new File(Paths.document, `voice_${saidAt}.aac`);
      if (dest.exists) dest.delete();
      dest.create();
      dest.write(await new File(recorder.uri).bytes());
      clip = dest.uri;
      new File(recorder.uri).delete();
    } catch (e) {
      console.warn('keeping the clip failed, using the cache copy', e);
    }
    await understand(clip, saidAt);
  }

  /** Which step is running, for the error line if one stalls or fails. */
  const stepNow = useRef('log');

  /**
   * Gemini hears the clip while the shopkeeper waits; whatever happens, the clip is kept. Nothing
   * may leave the screen on "বুঝছি…" for good: a step that stalls or throws sends the clip to the queue.
   */
  async function understand(clip: string, saidAt: number) {
    setPhase('thinking');
    const w = writer();
    let logId: string | null = null;
    try {
      stepNow.current = 'log';
      logId = await withTimeout(createVoiceLog(db, w, { transcript: heardRef.current, source: 'voice', contextTab: tab, audioPath: clip, engine: 'gemini', keepPending: true }), 15_000, 'log');
      gate.mark(Date.now());
      stepNow.current = 'gemini';
      const g = await withTimeout(runGemini(db, logId, clip, { tab, hint: null, deadlineMs: GEMINI_WAIT_MS }), GEMINI_WAIT_MS + 20_000, 'gemini');
      if (left.current) {
        // ✕ while Gemini was working: the clip would be lost, so it waits in the queue instead
        if (!g.ok) await enqueueUnderstanding(db, logId, tab, saidAt, g.error);
        else await setOutcome(db, w, logId, 'cancelled');
        bumpQueue();
        return;
      }
      const v = classify({ ok: g.ok, parsed: g.parsed, error: g.error });
      if (v.kind === 'ready') {
        nav.replace({ pathname: '/confirm', params: { logId, tab, ...carry } });
        return;
      }
      stepNow.current = 'queue';
      if (v.kind === 'retry') {
        // no internet, 429 or an error: keep the clip, tab and time; it is understood when it can be
        await enqueueUnderstanding(db, logId, tab, saidAt, g.error, queueNext(v, Date.now()));
        bumpQueue();
        void speak(QUEUED_BN);
        nav.back();
        return;
      }
      // Gemini answered but understood nothing
      await setOutcome(db, w, logId, 'stt_error');
      stopping.current = false;
      setErrorText('কিছু বুঝিনি');
      setPhase('error');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn('understand failed at', stepNow.current, msg);
      // the clip is kept either way: with a log it waits in the queue
      let queued = false;
      if (logId) {
        try {
          await enqueueUnderstanding(db, logId, tab, saidAt, `${stepNow.current}: ${msg}`);
          bumpQueue();
          queued = true;
        } catch {
          // the DB itself is the problem
        }
      }
      if (left.current) return;
      if (queued) {
        void speak(QUEUED_BN);
        nav.back();
        return;
      }
      stopping.current = false;
      setErrorText(`বুঝতে পারিনি (${stepNow.current}: ${msg})`);
      setPhase('error');
    }
  }

  const close = () => {
    left.current = true;
    if (LIVE) ExpoSpeechRecognitionModule.abort();
    else if (!stopping.current) {
      stopping.current = true;
      void recorder.stop().catch(() => undefined);
    }
    nav.back();
  };

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.top}>
        <Pressable accessibilityRole="button" accessibilityLabel="বাতিল" onPress={close} style={styles.close}>
          <Svg width={26} height={26} viewBox="0 0 24 24">
            <Path d="M6 6l12 12M18 6L6 18" stroke={colors.onColor} strokeWidth={2.4} strokeLinecap="round" />
          </Svg>
        </Pressable>
      </View>

      <View style={styles.middle}>
        <View style={[styles.ring, { backgroundColor: colors.listening.ringOuter, transform: [{ scale: 1 + volume * 0.08 }] }]}>
          <View style={[styles.ringInner, { backgroundColor: colors.listening.ringInner }]}>
            <View style={styles.micCore}>
              <Icon name="mic" size={80} color={colors.listening.bg} />
            </View>
          </View>
        </View>
        <Txt size={fontSize.promptLg} weight="bold" color={colors.onColor}>
          {phase === 'nokey' ? NO_KEY_BN : phase === 'error' ? 'আবার বলুন' : phase === 'starting' ? 'একটু দাঁড়ান…' : phase === 'paused' ? 'বিরতি' : phase === 'thinking' ? 'বুঝছি…' : 'শুনছি…'}
        </Txt>
        {phase === 'listening' && <Bars volume={volume} />}
        {(phase === 'thinking' || phase === 'starting') && <ActivityIndicator size="large" color={colors.onColor} />}
      </View>

      {!!heard && phase !== 'error' && phase !== 'nokey' && (
        <View style={styles.heard}>
          <Txt wrap size={fontSize.headingLg} weight="bold" style={styles.center}>
            {`“${heard}”`}
          </Txt>
        </View>
      )}

      {(phase === 'error' || phase === 'nokey') && (
        <View style={styles.heard}>
          <Txt wrap size={fontSize.headingLg} weight="bold" style={styles.center}>
            {phase === 'nokey' ? NO_KEY_HELP_BN : errorText}
          </Txt>
        </View>
      )}

      {phase === 'error' || phase === 'nokey' ? (
        <>
          {phase === 'error' && (
            <Pressable accessibilityRole="button" onPress={() => void start()} style={styles.action}>
              <Icon name="mic" size={32} color={colors.listening.bg} />
              <Txt size={fontSize.listAmount} weight="bold" color={colors.listening.bg}>
                আবার বলুন
              </Txt>
            </Pressable>
          )}
          {/* voice failed: products by picture (Pick: sale or purchase); বাকি/জমা/খরচ on the number
              pad (empty confirm card) */}
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              left.current = true;
              if (byPad) nav.replace({ pathname: '/confirm', params: { text: '', tab, ...carry } });
              else nav.replace({ pathname: '/pick', params: { tab: tab === 'purchase' ? 'purchase' : 'sale' } });
            }}
            style={[styles.action, phase === 'error' && styles.actionAlt]}
          >
            <Icon name={byPad ? 'keypad' : 'image'} size={30} color={phase === 'error' ? colors.onColor : colors.listening.bg} />
            <Txt size={fontSize.listAmount} weight="bold" color={phase === 'error' ? colors.onColor : colors.listening.bg}>
              {byPad ? 'টাকা চেপে দিন' : 'ছবি দেখে বেছে নিন'}
            </Txt>
          </Pressable>
        </>
      ) : phase === 'thinking' ? null : (
        <View style={styles.actions}>
          {phase === 'paused' ? (
            <Pressable accessibilityRole="button" accessibilityLabel="আবার চালু করুন" onPress={resume} style={styles.action}>
              <Icon name="mic" size={32} color={colors.listening.bg} />
              <Txt size={fontSize.listAmount} weight="bold" color={colors.listening.bg}>
                চালিয়ে যান
              </Txt>
            </Pressable>
          ) : (
            <Pressable accessibilityRole="button" accessibilityLabel="বিরতি" onPress={pause} style={[styles.action, styles.pauseButton]}>
              <View style={styles.pauseBars}>
                <View style={styles.pauseBar} />
                <View style={styles.pauseBar} />
              </View>
              <Txt size={fontSize.listAmount} weight="bold" color={colors.onColor}>
                বিরতি
              </Txt>
            </Pressable>
          )}
          <Pressable accessibilityRole="button" accessibilityLabel="থামুন" onPress={finish} style={styles.action}>
            <View style={styles.stopSquare} />
            <Txt size={fontSize.listAmount} weight="bold" color={colors.listening.bg}>
              থামুন
            </Txt>
          </Pressable>
        </View>
      )}
    </SafeAreaView>
  );
}

const BAR_SHAPE = [0.35, 0.75, 1, 0.6, 0.85, 0.45, 0.25];

function Bars({ volume }: { volume: number }) {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.bars}>
      {BAR_SHAPE.map((s, i) => (
        <View
          key={i}
          style={[
            styles.bar,
            { height: 8 + 32 * s * Math.max(0.25, volume), backgroundColor: i % 2 ? colors.onColor : colors.listening.bars },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.listening.bg,
    paddingHorizontal: 20,
    paddingTop: spacing.screen,
    paddingBottom: 24,
    gap: spacing.xl,
  },
  top: { flexDirection: 'row', justifyContent: 'flex-end' },
  close: {
    width: 52,
    height: 52,
    borderRadius: radius.pill,
    backgroundColor: colors.listening.close,
    alignItems: 'center',
    justifyContent: 'center',
  },
  middle: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.xxl },
  ring: { width: 260, height: 260, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  ringInner: { width: 210, height: 210, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  micCore: {
    width: 160,
    height: 160,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bars: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 40 },
  bar: { width: 8, borderRadius: 4 },
  heard: { backgroundColor: colors.surface, borderRadius: radius.section, padding: spacing.xl },
  center: { textAlign: 'center' },
  action: {
    height: 84,
    borderRadius: radius.section,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  actionAlt: { backgroundColor: colors.listening.close, marginTop: -spacing.md },
  actions: { gap: spacing.md },
  pauseButton: { backgroundColor: colors.listening.close },
  pauseBars: { flexDirection: 'row', gap: 6 },
  pauseBar: { width: 8, height: 26, borderRadius: 3, backgroundColor: colors.onColor },
  stopSquare: { width: 24, height: 24, borderRadius: 4, backgroundColor: colors.listening.bg },
});
