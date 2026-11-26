import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { Icon } from '../components/Icon';
import { ScreenHeader } from '../components/ScreenHeader';
import { Txt } from '../components/Txt';
import { createVoiceLog, customerAliasMap, knownNames, productAliasMap, setOutcome, setParsed } from '../db/repo';
import { writer } from '../device';
import { fixedAsParsed } from '../domain/entry';
import { EXAMPLE_BN, fixedProblemWords, readKeyboardText } from '../domain/keyboard';
import { nav } from '../lib/nav';
import { speak, stopSpeaking } from '../lib/speak';
import { colors, fonts, fontSize, radius, spacing } from '../theme/tokens';

type Tab = keyof typeof EXAMPLE_BN;

/**
 * বলুন (Android mode): a big text box with the keyboard up. The shopkeeper taps the Ridmik
 * keyboard's mic (an app can't press it), speaks, and taps "হয়ে গেছে". A complete sentence
 * goes to the confirm card; otherwise what is missing is said, and the text stays to fix.
 * No clip is kept (keyboard voice typing gives only text).
 */
export default function SayScreen() {
  const db = useSQLiteContext();
  const { tab: tabParam = 'sale', customer, kind } = useLocalSearchParams<{ tab?: string; customer?: string; kind?: string }>();
  const tab: Tab = tabParam === 'purchase' || tabParam === 'ledger' ? tabParam : 'sale';
  const examples = EXAMPLE_BN[tab];
  const [text, setText] = useState('');
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<React.ComponentRef<typeof TextInput>>(null);

  const intro = `${customer ? `${customer}। ` : ''}কিবোর্ডের মাইক চেপে বলুন। যেমন: ${examples.join('। অথবা: ')}। বলা হলে, হয়ে গেছে চাপুন।`;

  useEffect(() => {
    // the keyboard opens a moment after the screen, or Android sometimes drops it
    const t = setTimeout(() => input.current?.focus(), 350);
    return () => {
      clearTimeout(t);
      stopSpeaking();
    };
  }, []);

  async function done() {
    if (busy) return;
    const said = text.trim();
    if (!said) {
      setProblem('কিছু লেখা হয়নি। কিবোর্ডের মাইক চেপে বলুন।');
      void speak('কিছু লেখা হয়নি। কিবোর্ডের মাইক চেপে বলুন।');
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
      );
      const w = writer();
      const logId = await createVoiceLog(db, w, { transcript: said, source: 'voice', contextTab: tabParam, engine: 'android' });
      const words = fixedProblemWords(cmd);
      if (words) {
        // kept in the debug log: what Ridmik wrote and what was missing
        await setParsed(db, w, logId, fixedAsParsed(cmd), { by: 'android' });
        await setOutcome(db, w, logId, 'unsupported');
        setProblem(words);
        void speak(words);
        input.current?.focus();
        return;
      }
      stopSpeaking();
      nav.replace({ pathname: '/confirm', params: { logId, tab: tabParam, ...(customer ? { customer } : {}), ...(kind ? { kind } : {}) } });
    } catch (e) {
      console.warn('keyboard entry failed', e);
      setProblem('রাখা গেল না। আবার চাপুন।');
      void speak('রাখা গেল না। আবার চাপুন।');
    } finally {
      setBusy(false);
    }
  }

  const clear = () => {
    setText('');
    setProblem('');
    input.current?.focus();
  };

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        <View style={styles.top}>
          <Pressable accessibilityRole="button" accessibilityLabel="ফিরে যান" onPress={() => nav.back()} style={styles.back}>
            <Icon name="back" size={26} color={colors.ink} strokeWidth={2.2} />
          </Pressable>
          <View style={styles.flex}>
            <ScreenHeader title={customer ? `${customer}` : 'বলুন'} onListen={() => void speak(intro)} />
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <View style={styles.example}>
            <View style={styles.exampleHead}>
              <Icon name="mic" size={22} color={colors.saleDark} />
              <Txt size={fontSize.body} weight="bold" color={colors.saleDark}>
                কিবোর্ডের মাইক চেপে এভাবে বলুন:
              </Txt>
            </View>
            {examples.map((ex) => (
              <Txt key={ex} wrap size={fontSize.label} weight="semibold">
                {`“${ex}”`}
              </Txt>
            ))}
          </View>

          <TextInput
            ref={input}
            value={text}
            onChangeText={(t) => {
              setText(t);
              if (problem) setProblem('');
            }}
            multiline
            autoFocus
            showSoftInputOnFocus
            accessibilityLabel="যা বললেন"
            placeholder="এখানে লেখা আসবে…"
            placeholderTextColor={colors.muted}
            style={[styles.input, !!problem && styles.inputWarn]}
          />

          {!!problem && (
            <View style={styles.problem}>
              <Txt wrap size={fontSize.label} weight="bold" color={colors.bakiInk}>
                {problem}
              </Txt>
            </View>
          )}
        </ScrollView>

        <View style={styles.actions}>
          {!!text && (
            <Pressable accessibilityRole="button" accessibilityLabel="মুছে আবার বলুন" onPress={clear} style={({ pressed }) => [styles.clear, pressed && styles.pressed]}>
              <Icon name="close" size={30} color={colors.ink} strokeWidth={2.6} />
              <Txt size={fontSize.button} weight="bold">
                মুছুন
              </Txt>
            </Pressable>
          )}
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
    borderColor: colors.sale,
    borderRadius: radius.card,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    textAlignVertical: 'top',
    fontFamily: fonts.bold,
    fontSize: fontSize.heading,
    color: colors.ink,
  },
  inputWarn: { borderColor: colors.baki },
  problem: { backgroundColor: colors.bakiTint, borderRadius: radius.card, padding: spacing.lg },
  actions: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.screen, paddingVertical: spacing.sm },
  clear: {
    flex: 1,
    height: 72,
    borderRadius: radius.button,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  done: { flex: 2, height: 72, borderRadius: radius.button, backgroundColor: colors.sale, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
});
