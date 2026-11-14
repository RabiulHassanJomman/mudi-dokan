import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { File, Paths } from 'expo-file-system';
import { useSQLiteContext } from 'expo-sqlite';
import { AudioModule, setAudioModeAsync, useAudioRecorder, useAudioRecorderState, type RecordingOptions } from 'expo-audio';
import Svg, { Path } from 'react-native-svg';

import { Icon } from '../components/Icon';
import { Txt } from '../components/Txt';
import { createVoiceLog, setOutcome } from '../db/repo';
import { writer } from '../device';
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

type Phase = 'starting' | 'listening' | 'thinking' | 'error' | 'nokey';

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
  const volume = barLevel(rec.metering);

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
      if (!stopping.current) void recorder.stop().catch(() => undefined);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start]);

  // end of speech from the level; the button does the same
  useEffect(() => {
    if (phase !== 'listening' || stopping.current) return;
    const r = feed(endpoint.current, rec.metering, rec.durationMillis);
    endpoint.current = r.state;
    if (r.verdict === 'stop') void stop();
    else if (r.verdict === 'nothing') void stop(true);
    else if (rec.durationMillis >= MAX_MS) void stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec.metering, rec.durationMillis, phase]);

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
      logId = await withTimeout(createVoiceLog(db, w, { transcript: '', source: 'voice', contextTab: tab, audioPath: clip, engine: 'gemini', keepPending: true }), 15_000, 'log');
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
    if (!stopping.current) {
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
          {phase === 'nokey' ? NO_KEY_BN : phase === 'error' ? 'আবার বলুন' : phase === 'starting' ? 'একটু দাঁড়ান…' : phase === 'thinking' ? 'বুঝছি…' : 'শুনছি…'}
        </Txt>
        {phase === 'listening' && <Bars volume={volume} />}
      </View>

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
        <Pressable accessibilityRole="button" accessibilityLabel="থামুন" onPress={() => void stop()} style={styles.action}>
          <View style={styles.stopSquare} />
          <Txt size={fontSize.listAmount} weight="bold" color={colors.listening.bg}>
            থামুন
          </Txt>
        </Pressable>
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
  stopSquare: { width: 24, height: 24, borderRadius: 4, backgroundColor: colors.listening.bg },
});
