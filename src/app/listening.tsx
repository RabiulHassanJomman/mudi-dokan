import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Paths } from 'expo-file-system';
import { useSQLiteContext } from 'expo-sqlite';
import { AudioModule, setAudioModeAsync, useAudioRecorder, type RecordingOptions } from 'expo-audio';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import Svg, { Path } from 'react-native-svg';

import { Icon } from '../components/Icon';
import { Txt } from '../components/Txt';
import { createVoiceLog, setOutcome } from '../db/repo';
import { writer } from '../device';
import { getEngine } from '../lib/engine';
import { shownEngine } from '../gemini/fallback';
import { GEMINI_WAIT_MS, runGemini } from '../lib/gemini';
import { colors, fontSize, radius, spacing } from '../theme/tokens';
import { nav } from '../lib/nav';

type Phase = 'starting' | 'listening' | 'thinking' | 'error';

/**
 * Gemini mode on Android < 13: the recognizer can't keep the clip, so expo-audio records it
 * (AAC in ADTS, which Gemini takes; 16 kHz mono ≈ 4 KB/s). No live transcript then.
 */
const AAC_16K: RecordingOptions = {
  extension: '.aac',
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 32000,
  android: { extension: '.aac', outputFormat: 'aac_adts', audioEncoder: 'aac' },
  ios: { extension: '.aac', audioQuality: 32, outputFormat: 'aac ' },
  web: {},
};
/** The recorder has no end-of-speech detection: stop by itself after this. */
const RECORD_MAX_MS = 15_000;

const ERROR_TEXT: Record<string, string> = {
  'no-speech': 'কিছু শুনতে পাইনি',
  'speech-timeout': 'কিছু শুনতে পাইনি',
  network: 'ইন্টারনেট নেই। নেট চালু করে আবার বলুন',
  'not-allowed': 'মাইকের অনুমতি দিন',
  'language-not-supported': 'এই ফোনে বাংলা শোনা যাচ্ছে না',
  busy: 'মাইক ব্যস্ত, একটু পরে বলুন',
};

/** শুনছি: speech → text. On a final result: log it, then the confirm card. */
export default function ListeningScreen() {
  const db = useSQLiteContext();
  /** customer / kind: from the customer screen (জমা নিন / বাকি দিন), passed on to the confirm card. */
  const { tab = 'sale', customer, kind } = useLocalSearchParams<{ tab?: string; customer?: string; kind?: string }>();
  const carry = { ...(customer ? { customer } : {}), ...(kind ? { kind } : {}) };
  /** No goods to pick: বাকি/জমা and খরচ fall back to the number pad. */
  const byPad = tab === 'ledger' || tab === 'expense';
  const [phase, setPhase] = useState<Phase>('starting');
  const [heard, setHeard] = useState('');
  const [errorText, setErrorText] = useState('');
  const [volume, setVolume] = useState(0);
  /** Fixed for this command (debug setting, pilot log screen). */
  const engine = useRef(getEngine()).current;
  const useRecorder = engine === 'gemini' && Platform.OS === 'android' && Number(Platform.Version) < 33;
  const recorder = useAudioRecorder(AAC_16K);
  const recordTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** ✕ pressed: drop a Gemini answer that comes in later. */
  const left = useRef(false);

  const final = useRef<{ text: string; alternatives: string[] } | null>(null);
  const audio = useRef<string | null>(null);
  const sttError = useRef<string | null>(null);
  const closing = useRef(false);

  const start = useCallback(async () => {
    final.current = null;
    audio.current = null;
    sttError.current = null;
    closing.current = false;
    left.current = false;
    setHeard('');
    setPhase('starting');
    if (useRecorder) return startRecorder();
    const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!perm.granted) {
      setErrorText(ERROR_TEXT['not-allowed']!);
      setPhase('error');
      return;
    }
    ExpoSpeechRecognitionModule.start({
      lang: 'bn-BD',
      interimResults: true,
      maxAlternatives: 3,
      continuous: false,
      // keep the clip for the pilot log and History replay (Android 13+)
      recordingOptions: { persist: true, outputDirectory: Paths.document.uri, outputFileName: `voice_${Date.now()}.wav` },
      volumeChangeEventOptions: { enabled: true, intervalMillis: 120 },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startRecorder() {
    const perm = await AudioModule.requestRecordingPermissionsAsync();
    if (!perm.granted) {
      setErrorText(ERROR_TEXT['not-allowed']!);
      setPhase('error');
      return;
    }
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    setPhase('listening');
    recordTimer.current = setTimeout(() => void stopRecorder(), RECORD_MAX_MS);
  }

  async function stopRecorder() {
    if (recordTimer.current) clearTimeout(recordTimer.current);
    recordTimer.current = null;
    if (closing.current) return;
    closing.current = true;
    await recorder.stop();
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    if (recorder.uri) return finishGemini(recorder.uri, null, null);
    setErrorText(ERROR_TEXT['no-speech']!);
    setPhase('error');
  }

  useEffect(() => {
    void start();
    return () => {
      closing.current = true;
      if (recordTimer.current) clearTimeout(recordTimer.current);
      if (useRecorder) void recorder.stop().catch(() => undefined);
      else ExpoSpeechRecognitionModule.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start]);

  useSpeechRecognitionEvent('start', () => setPhase('listening'));
  useSpeechRecognitionEvent('volumechange', (e) => setVolume(Math.max(0, Math.min(1, (e.value + 2) / 12))));
  useSpeechRecognitionEvent('result', (e) => {
    const text = e.results[0]?.transcript ?? '';
    setHeard(text);
    if (e.isFinal) final.current = { text, alternatives: e.results.slice(1).map((r) => r.transcript) };
  });
  useSpeechRecognitionEvent('audioend', (e) => {
    if (e.uri) audio.current = e.uri;
  });
  useSpeechRecognitionEvent('error', (e) => {
    sttError.current = e.error;
  });
  useSpeechRecognitionEvent('end', () => {
    if (closing.current) return;
    void finish();
  });

  async function finish() {
    const w = writer();
    const got = final.current?.text.trim();
    const clip = audio.current;
    const code = sttError.current ?? 'no-speech';
    if (code === 'aborted' && !got) return;
    if (engine === 'gemini' && clip) {
      closing.current = true;
      return finishGemini(clip, got || null, got ? null : code);
    }
    if (got) {
      closing.current = true;
      const logId = await createVoiceLog(db, w, {
        transcript: got,
        source: 'voice',
        contextTab: tab,
        alternatives: final.current?.alternatives,
        audioPath: clip,
        engine,
      });
      // both: Gemini hears the same clip in the background; the card uses Android's result
      if (engine === 'both' && clip) void runGemini(db, logId, clip, { tab, hint: got });
      nav.replace({ pathname: '/confirm', params: { logId, tab, ...carry } });
      return;
    }
    const logId = await createVoiceLog(db, w, { transcript: '', source: 'voice', contextTab: tab, sttError: code, audioPath: clip, engine });
    // measured too: would Gemini have understood what the recognizer missed?
    if (engine === 'both' && clip) void runGemini(db, logId, clip, { tab, hint: null });
    setErrorText(ERROR_TEXT[code] ?? `শুনতে সমস্যা (${code})`);
    setPhase('error');
  }

  /**
   * gemini mode: wait for Gemini (≤ ~12 s). Its result drives the confirm card; if it fails
   * or did not understand, the Android transcript does (fallback); with neither, "আবার বলুন".
   */
  async function finishGemini(clip: string, got: string | null, code: string | null) {
    setPhase('thinking');
    const w = writer();
    const logId = await createVoiceLog(db, w, {
      transcript: got ?? '',
      source: 'voice',
      contextTab: tab,
      alternatives: final.current?.alternatives,
      audioPath: clip,
      engine: 'gemini',
      sttError: code,
      keepPending: true,
    });
    const g = await runGemini(db, logId, clip, { tab, hint: got, deadlineMs: GEMINI_WAIT_MS });
    if (left.current) {
      await setOutcome(db, w, logId, g.ok || got ? 'cancelled' : 'stt_error');
      return;
    }
    if (shownEngine(g.ok ? g.parsed : null, got ?? '') !== 'none') {
      nav.replace({ pathname: '/confirm', params: { logId, tab, ...carry } });
      return;
    }
    await setOutcome(db, w, logId, 'stt_error');
    closing.current = false;
    setErrorText(g.ok ? 'কিছু বুঝিনি' : code && ERROR_TEXT[code] ? ERROR_TEXT[code]! : 'বুঝতে পারিনি');
    setPhase('error');
  }

  const close = () => {
    closing.current = true;
    left.current = true;
    if (useRecorder) void recorder.stop().catch(() => undefined);
    else ExpoSpeechRecognitionModule.abort();
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
          {phase === 'error' ? 'আবার বলুন' : phase === 'starting' ? 'একটু দাঁড়ান…' : phase === 'thinking' ? 'বুঝছি…' : 'শুনছি…'}
        </Txt>
        {phase === 'listening' && <Bars volume={volume} />}
      </View>

      {(heard || phase === 'error') && (
        <View style={styles.heard}>
          <Txt wrap size={fontSize.headingLg} weight="bold" style={styles.center}>
            {phase === 'error' && !heard ? errorText : `“${heard}”`}
          </Txt>
        </View>
      )}

      {phase === 'error' ? (
        <>
          <Pressable accessibilityRole="button" onPress={() => void start()} style={styles.action}>
            <Icon name="mic" size={32} color={colors.listening.bg} />
            <Txt size={fontSize.listAmount} weight="bold" color={colors.listening.bg}>
              আবার বলুন
            </Txt>
          </Pressable>
          {/* voice failed: products by picture (Pick: sale or purchase); বাকি/জমা/খরচ on the number
              pad (empty confirm card) */}
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              closing.current = true;
              if (byPad) nav.replace({ pathname: '/confirm', params: { text: '', tab, ...carry } });
              else nav.replace({ pathname: '/pick', params: { tab: tab === 'purchase' ? 'purchase' : 'sale' } });
            }}
            style={[styles.action, styles.actionAlt]}
          >
            <Icon name={byPad ? 'keypad' : 'image'} size={30} color={colors.onColor} />
            <Txt size={fontSize.listAmount} weight="bold" color={colors.onColor}>
              {byPad ? 'টাকা চেপে দিন' : 'ছবি দেখে বেছে নিন'}
            </Txt>
          </Pressable>
        </>
      ) : phase === 'thinking' ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="থামুন"
          onPress={() => (useRecorder ? void stopRecorder() : ExpoSpeechRecognitionModule.stop())}
          style={styles.action}
        >
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
