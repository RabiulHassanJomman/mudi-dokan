import { useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { File, Paths } from 'expo-file-system';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';

import { Icon } from '../components/Icon';
import { ScreenHeader } from '../components/ScreenHeader';
import { Txt } from '../components/Txt';
import { createVoiceLog, customerAliasMap, knownNames, productAliasMap, setOutcome, setParsed } from '../db/repo';
import { writer } from '../device';
import { fixedAsParsed } from '../domain/entry';
import { EXAMPLE_BN, fixedProblemWords, heardErrorWords, readKeyboardText } from '../domain/keyboard';
import { nav } from '../lib/nav';
import { speak, stopSpeaking } from '../lib/speak';
import { colors, fonts, fontSize, radius, spacing } from '../theme/tokens';

type Tab = keyof typeof EXAMPLE_BN;

/**
 * বলুন: opens listening in Bangla (the phone's own recognizer, bn-BD: on most phones Google's,
 * the same one the Ridmik keyboard's mic uses). When the speaker stops, the text goes to the
 * confirm card; if something is missing it is said, and the text stays to see or fix by
 * keyboard (the clip is kept for it). 🎤 starts over (clears the text and its clip). Tapping the text box opens the keyboard
 * (Ridmik's mic still works there).
 * The clip (WAV, Android 13+) goes with the voice log → Drive; a command not understood
 * keeps none. Cancelled ones are dropped by the upload queue and deleted by retention.
 */
export default function SayScreen() {
  const db = useSQLiteContext();
  const { tab: tabParam = 'sale', customer, kind } = useLocalSearchParams<{ tab?: string; customer?: string; kind?: string }>();
  const tab: Tab = tabParam === 'purchase' || tabParam === 'ledger' ? tabParam : 'sale';
  const examples = EXAMPLE_BN[tab];
  const [text, setText] = useState('');
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const input = useRef<React.ComponentRef<typeof TextInput>>(null);
  const listeningRef = useRef(false);
  /** Between the tap and start(): a second call must not start the recognizer again (it cuts off the first). */
  const starting = useRef(false);
  const leaving = useRef(false);
  /** This listen's recording: its file once audioend says so; waiters for it. */
  const clip = useRef<{ uri: string | null; ended: boolean; waiters: (() => void)[] } | null>(null);

  const intro = `${customer ? `${customer}। ` : ''}মাইক চেপে বলুন। যেমন: ${examples.join('। অথবা: ')}।`;

  const showProblem = useCallback((words: string) => {
    setProblem(words);
    scroll.current?.scrollTo({ y: 0, animated: true });
    if (words) void speak(words);
  }, []);

  const listen = useCallback(async (why: string) => {
    console.log(`MUDI_SAY listen ${why}${listeningRef.current || starting.current ? ' (already on)' : ''}`);
    if (listeningRef.current || starting.current || leaving.current) return;
    starting.current = true;
    try {
      await startListening();
    } finally {
      starting.current = false;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function startListening() {
    stopSpeaking();
    input.current?.blur();
    const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!perm.granted) {
      showProblem(heardErrorWords('not-allowed'));
      return;
    }
    if (leaving.current) return;
    // a new try starts clean: the old text and its clip go
    dropClip(clip.current);
    clip.current = { uri: null, ended: false, waiters: [] };
    setText('');
    setProblem('');
    listeningRef.current = true;
    setListening(true);
    ExpoSpeechRecognitionModule.start({
      lang: 'bn-BD',
      interimResults: true,
      maxAlternatives: 1,
      continuous: false,
      // Android 13+ only; older phones give no file (the entry is kept without a clip)
      recordingOptions: { persist: true, outputDirectory: Paths.document.uri, outputFileName: `voice_${Date.now()}.wav` },
    });
  }

  const stopListening = useCallback(() => {
    if (!listeningRef.current) return;
    ExpoSpeechRecognitionModule.stop();
  }, []);

  useSpeechRecognitionEvent('result', (e) => {
    if (!listeningRef.current) return;
    const heard = (e.results[0]?.transcript ?? '').trim();
    setText(heard);
    if (e.isFinal) {
      listeningRef.current = false;
      setListening(false);
      if (heard) void done(heard);
    }
  });
  useSpeechRecognitionEvent('audioend', (e) => {
    const c = clip.current;
    if (!c || c.ended) return;
    c.uri = e.uri;
    c.ended = true;
    for (const w of c.waiters.splice(0)) w();
  });
  useSpeechRecognitionEvent('error', (e) => {
    if (!listeningRef.current) return;
    listeningRef.current = false;
    setListening(false);
    showProblem(heardErrorWords(e.error));
  });
  useSpeechRecognitionEvent('end', () => {
    listeningRef.current = false;
    setListening(false);
  });

  useEffect(() => {
    // a moment after the screen opens, so the tap that opened it isn't heard
    const t = setTimeout(() => void listen('open'), 300);
    return () => {
      leaving.current = true;
      clearTimeout(t);
      if (listeningRef.current) ExpoSpeechRecognitionModule.abort();
      stopSpeaking();
      // left without a saved command: the clip isn't kept (one handed to a log is null here)
      dropClip(clip.current);
      clip.current = null;
    };
  }, [listen]);

  async function done(said = text.trim()) {
    if (busy) return;
    stopListening();
    if (!said) {
      showProblem('কিছু লেখা হয়নি। মাইক চেপে বলুন।');
      return;
    }
    setBusy(true);
    try {
      const names = await knownNames(db);
      const aliases = await customerAliasMap(db);
      const cmd = readKeyboardText(
        said,
        { knownProducts: names.products, knownCustomers: [...names.customers, ...Object.keys(aliases)], productAliases: await productAliasMap(db) },
        { customer },
        aliases,
      );
      const w = writer();
      const words = fixedProblemWords(cmd);
      // only a command that goes to the card keeps its clip
      const audioPath = words ? null : await clipFile(clip.current);
      if (!words && audioPath) clip.current = null; // the log owns it now
      const logId = await createVoiceLog(db, w, { transcript: said, source: 'voice', contextTab: tabParam, engine: 'android', audioPath });
      if (words) {
        // the clip stays until a new try or leaving: fixed by keyboard, it still goes with the entry
        // kept in the debug log: what was heard and what was missing
        await setParsed(db, w, logId, fixedAsParsed(cmd), { by: 'android' });
        await setOutcome(db, w, logId, 'unsupported');
        showProblem(words);
        return;
      }
      leaving.current = true;
      stopSpeaking();
      nav.replace({ pathname: '/confirm', params: { logId, tab: tabParam, ...(customer ? { customer } : {}), ...(kind ? { kind } : {}) } });
    } catch (e) {
      console.warn('voice entry failed', e);
      showProblem('রাখা গেল না। আবার চাপুন।');
    } finally {
      setBusy(false);
    }
  }

  const clear = () => {
    stopListening();
    setText('');
    setProblem('');
  };

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        <View style={styles.top}>
          <Pressable accessibilityRole="button" accessibilityLabel="ফিরে যান" onPress={() => nav.back()} style={styles.back}>
            <Icon name="back" size={26} color={colors.ink} strokeWidth={2.2} />
          </Pressable>
          <View style={styles.flex}>
            <ScreenHeader
              title={customer ? `${customer}` : 'বলুন'}
              onListen={() => {
                stopListening();
                void speak(intro);
              }}
            />
          </View>
        </View>

        <ScrollView ref={scroll} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <View style={styles.example}>
            <View style={styles.exampleHead}>
              <Icon name="mic" size={22} color={colors.saleDark} />
              <Txt size={fontSize.body} weight="bold" color={colors.saleDark}>
                এভাবে বলুন:
              </Txt>
            </View>
            {examples.map((ex) => (
              <Txt key={ex} wrap size={fontSize.label} weight="semibold">
                {`“${ex}”`}
              </Txt>
            ))}
          </View>

          {/* above the text box: below it the keyboard would cover it */}
          {!!problem && (
            <View accessibilityLiveRegion="polite" style={styles.problem}>
              <Txt wrap size={fontSize.label} weight="bold" color={colors.bakiInk}>
                {problem}
              </Txt>
            </View>
          )}
          <TextInput
            ref={input}
            value={text}
            onFocus={stopListening}
            onChangeText={(t) => {
              setText(t);
              if (problem) setProblem('');
            }}
            multiline
            accessibilityLabel="যা বললেন"
            placeholder={listening ? 'শুনছি… বলুন' : 'এখানে লেখা আসবে…'}
            placeholderTextColor={listening ? colors.saleDark : colors.muted}
            style={[styles.input, listening && styles.inputListening, !!problem && styles.inputWarn]}
          />
        </ScrollView>

        <View style={styles.actions}>
          {!!text && !listening && (
            <Pressable accessibilityRole="button" accessibilityLabel="মুছে আবার বলুন" onPress={clear} style={({ pressed }) => [styles.clear, pressed && styles.pressed]}>
              <Icon name="close" size={30} color={colors.ink} strokeWidth={2.6} />
            </Pressable>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={listening ? 'থামুন' : 'মাইক চেপে বলুন'}
            onPress={() => (listening ? stopListening() : void listen('tap'))}
            style={({ pressed }) => [styles.mic, listening && styles.micOn, pressed && styles.pressed]}
          >
            <Icon name="mic" size={34} color={listening ? colors.onColor : colors.saleDark} strokeWidth={2.4} />
            <Txt size={fontSize.button} weight="bold" color={listening ? colors.onColor : colors.saleDark}>
              {listening ? 'থামুন' : 'বলুন'}
            </Txt>
          </Pressable>
          {!!text && !listening && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="হয়ে গেছে"
              accessibilityState={{ disabled: busy }}
              onPress={() => void done()}
              style={({ pressed }) => [styles.done, busy && styles.disabled, pressed && styles.pressed]}
            >
              <Icon name="check" size={36} color={colors.onColor} strokeWidth={2.8} />
              <Txt size={fontSize.button} weight="bold" color={colors.onColor}>
                {busy ? 'দেখছি…' : 'হয়ে গেছে'}
              </Txt>
            </Pressable>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  top: { flexDirection: 'row', alignItems: 'center', paddingLeft: spacing.screen },
  back: { width: 52, height: 52, borderRadius: radius.pill, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', marginTop: spacing.screenTop },
  body: { paddingHorizontal: spacing.screen, gap: spacing.md, paddingBottom: spacing.md },
  example: { backgroundColor: colors.saleTint, borderRadius: radius.card, padding: spacing.lg, gap: spacing.xs },
  exampleHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  input: {
    minHeight: 150,
    borderWidth: 3,
    borderColor: colors.border,
    borderRadius: radius.card,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    textAlignVertical: 'top',
    fontFamily: fonts.bold,
    fontSize: fontSize.heading,
    color: colors.ink,
  },
  inputListening: { borderColor: colors.sale },
  inputWarn: { borderColor: colors.baki },
  problem: { backgroundColor: colors.bakiTint, borderRadius: radius.card, padding: spacing.lg },
  actions: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.screen, paddingVertical: spacing.sm },
  clear: {
    width: 72,
    height: 72,
    borderRadius: radius.button,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mic: {
    flex: 1,
    height: 72,
    borderRadius: radius.button,
    backgroundColor: colors.saleTint,
    borderWidth: 2,
    borderColor: colors.sale,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  micOn: { backgroundColor: colors.baki, borderColor: colors.baki },
  done: { flex: 1, height: 72, borderRadius: radius.button, backgroundColor: colors.sale, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
});

type Clip = { uri: string | null; ended: boolean; waiters: (() => void)[] } | null;

/** The recording's file, once the recorder has closed it (waits up to 2 s for audioend). */
async function clipFile(c: Clip): Promise<string | null> {
  if (!c) return null;
  if (!c.ended) await Promise.race([new Promise<void>((r) => c.waiters.push(r)), new Promise((r) => setTimeout(r, 2000))]);
  return c.uri;
}

/** Delete a recording nobody keeps (now, or when the recorder closes it). */
function dropClip(c: Clip): void {
  if (!c) return;
  const del = () => {
    if (!c.uri) return;
    try {
      new File(c.uri).delete();
    } catch {
      // already gone
    }
  };
  if (c.ended) del();
  else c.waiters.push(del);
}
