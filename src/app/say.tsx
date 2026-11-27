import { useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';

import { Icon } from '../components/Icon';
import { ScreenHeader } from '../components/ScreenHeader';
import { Txt } from '../components/Txt';
import { createVoiceLog, customerAliasMap, knownNames, productAliasMap, setOutcome, setParsed } from '../db/repo';
import { writer } from '../device';
import { fixedAsParsed } from '../domain/entry';
import { EXAMPLE_BN, fixedProblemWords, heardErrorWords, joinHeard, readKeyboardText } from '../domain/keyboard';
import { nav } from '../lib/nav';
import { speak, stopSpeaking } from '../lib/speak';
import { colors, fonts, fontSize, radius, spacing } from '../theme/tokens';

type Tab = keyof typeof EXAMPLE_BN;

/**
 * বলুন: opens listening in Bangla (the phone's own recognizer, bn-BD: on most phones Google's,
 * the same one the Ridmik keyboard's mic uses). When the speaker stops, the text goes to the
 * confirm card; if something is missing it is said, and the text stays to add to or fix.
 * 🎤 listens again (adds to the text). Tapping the text box opens the keyboard (Ridmik's mic
 * still works there). No clip is kept.
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
  /** The text in the box when this listen started: what is heard goes after it. */
  const before = useRef('');
  const listeningRef = useRef(false);
  const textRef = useRef(text);
  textRef.current = text;
  const leaving = useRef(false);

  const intro = `${customer ? `${customer}। ` : ''}মাইক চেপে বলুন। যেমন: ${examples.join('। অথবা: ')}।`;

  const showProblem = useCallback((words: string) => {
    setProblem(words);
    scroll.current?.scrollTo({ y: 0, animated: true });
    if (words) void speak(words);
  }, []);

  const listen = useCallback(async () => {
    if (listeningRef.current || leaving.current) return;
    stopSpeaking();
    input.current?.blur();
    const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!perm.granted) {
      showProblem(heardErrorWords('not-allowed'));
      return;
    }
    if (leaving.current) return;
    setProblem('');
    before.current = textRef.current;
    listeningRef.current = true;
    setListening(true);
    ExpoSpeechRecognitionModule.start({ lang: 'bn-BD', interimResults: true, maxAlternatives: 1, continuous: false });
  }, [showProblem]);

  const stopListening = useCallback(() => {
    if (!listeningRef.current) return;
    ExpoSpeechRecognitionModule.stop();
  }, []);

  useSpeechRecognitionEvent('result', (e) => {
    if (!listeningRef.current) return;
    const heard = e.results[0]?.transcript ?? '';
    const next = joinHeard(before.current, heard);
    setText(next);
    if (e.isFinal) {
      listeningRef.current = false;
      setListening(false);
      if (heard.trim()) void done(next);
    }
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
    const t = setTimeout(() => void listen(), 300);
    return () => {
      leaving.current = true;
      clearTimeout(t);
      if (listeningRef.current) ExpoSpeechRecognitionModule.abort();
      stopSpeaking();
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
      const logId = await createVoiceLog(db, w, { transcript: said, source: 'voice', contextTab: tabParam, engine: 'android' });
      const words = fixedProblemWords(cmd);
      if (words) {
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
            onPress={() => (listening ? stopListening() : void listen())}
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
