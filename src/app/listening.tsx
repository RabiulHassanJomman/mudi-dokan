import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Paths } from 'expo-file-system';
import { useSQLiteContext } from 'expo-sqlite';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import Svg, { Path } from 'react-native-svg';

import { Icon } from '../components/Icon';
import { Txt } from '../components/Txt';
import { createVoiceLog } from '../db/repo';
import { writer } from '../device';
import { colors, fontSize, radius, spacing } from '../theme/tokens';

type Phase = 'starting' | 'listening' | 'error';

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
  const { tab = 'sale' } = useLocalSearchParams<{ tab?: string }>();
  const [phase, setPhase] = useState<Phase>('starting');
  const [heard, setHeard] = useState('');
  const [errorText, setErrorText] = useState('');
  const [volume, setVolume] = useState(0);

  const final = useRef<{ text: string; alternatives: string[] } | null>(null);
  const audio = useRef<string | null>(null);
  const sttError = useRef<string | null>(null);
  const closing = useRef(false);

  const start = useCallback(async () => {
    final.current = null;
    audio.current = null;
    sttError.current = null;
    setHeard('');
    setPhase('starting');
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
  }, []);

  useEffect(() => {
    void start();
    return () => {
      closing.current = true;
      ExpoSpeechRecognitionModule.abort();
    };
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
    if (got) {
      closing.current = true;
      const logId = await createVoiceLog(db, w, {
        transcript: got,
        source: 'voice',
        contextTab: tab,
        alternatives: final.current?.alternatives,
        audioPath: audio.current,
      });
      router.replace({ pathname: '/confirm', params: { logId, tab } });
      return;
    }
    const code = sttError.current ?? 'no-speech';
    if (code === 'aborted') return;
    await createVoiceLog(db, w, { transcript: '', source: 'voice', contextTab: tab, sttError: code, audioPath: audio.current });
    setErrorText(ERROR_TEXT[code] ?? `শুনতে সমস্যা (${code})`);
    setPhase('error');
  }

  const close = () => {
    closing.current = true;
    ExpoSpeechRecognitionModule.abort();
    router.back();
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
          {phase === 'error' ? 'আবার বলুন' : phase === 'starting' ? 'একটু দাঁড়ান…' : 'শুনছি…'}
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
          {/* voice failed: choose by picture (Pick) instead */}
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              closing.current = true;
              router.replace('/pick');
            }}
            style={[styles.action, styles.actionAlt]}
          >
            <Icon name="image" size={30} color={colors.onColor} />
            <Txt size={fontSize.listAmount} weight="bold" color={colors.onColor}>
              ছবি দেখে বেছে নিন
            </Txt>
          </Pressable>
        </>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="থামুন"
          onPress={() => ExpoSpeechRecognitionModule.stop()}
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
