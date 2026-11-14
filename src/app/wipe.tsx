import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSQLiteContext } from 'expo-sqlite';

import { ConfirmSheet } from '../components/ConfirmSheet';
import { Icon } from '../components/Icon';
import { Txt } from '../components/Txt';
import { getSetup, wipeCounts } from '../db/repo';
import { getDevice } from '../device';
import { nav } from '../lib/nav';
import { speak, stopSpeaking } from '../lib/speak';
import { useSyncStatus } from '../sync/app';
import { backupBeforeWipe, wipeEverything } from '../wipe/app';
import {
  HOLD_MS,
  START,
  WIPE_FAIL_BN,
  chooseScope,
  finalWarning,
  holdProgress,
  nameMatches,
  step,
  typeName,
  wordToType,
  type Counts,
  type WipeFlow,
  type WipeScope,
} from '../wipe/flow';
import { colors, fontSize, radius, size, spacing } from '../theme/tokens';

const DANGER = '#B3261E';
const DANGER_TINT = '#FBE9E7';

/**
 * ⚙ › সব তথ্য মুছুন (danger zone). Each step opens after the one before:
 * where from → a backup file first → the shop's name typed exactly → hold the button 5 s →
 * a last spoken warning and হ্যাঁ. With "সব ফোন + Google" the other phones are asked on their own.
 */
export default function WipeScreen() {
  const db = useSQLiteContext();
  const status = useSyncStatus();
  const signedIn = !!status?.email;
  const [flow, setFlow] = useState<WipeFlow>(START);
  const [shopName, setShopName] = useState<string | null>(null);
  const [counts, setCounts] = useState<Counts>({ entries: 0, customers: 0, products: 0 });
  const [busy, setBusy] = useState<null | 'backup' | 'wipe'>(null);
  const [held, setHeld] = useState(0);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const holdTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const holdStart = useRef(0);

  useEffect(() => {
    void getSetup(db, getDevice().id).then((s) => setShopName(s.shopName));
    void wipeCounts(db).then(setCounts);
    void speak('সব তথ্য মোছার জায়গা। সাবধানে এগোন। আগে বাছুন কোথা থেকে মুছবেন।');
    return () => {
      stopSpeaking();
      if (holdTimer.current) clearInterval(holdTimer.current);
    };
  }, [db]);

  const at = step(flow, shopName);
  const word = wordToType(shopName);

  const backup = async () => {
    setBusy('backup');
    setError(null);
    try {
      const r = await backupBeforeWipe();
      setFlow((f) => ({ ...f, backedUp: true }));
      void speak(r.shared ? 'ব্যাকআপ ফাইল রাখা হয়েছে।' : 'ব্যাকআপ ফাইল ফোনে রাখা হয়েছে।');
    } catch (e) {
      console.warn('backup before wipe failed', e);
      setError('ব্যাকআপ ফাইল বানানো গেল না। ব্যাকআপ ছাড়া মোছা যাবে না।');
      void speak('ব্যাকআপ ফাইল বানানো গেল না।');
    } finally {
      setBusy(null);
    }
  };

  const pressIn = () => {
    if (at !== 'hold') return;
    holdStart.current = Date.now();
    setHeld(0);
    holdTimer.current = setInterval(() => {
      const ms = Date.now() - holdStart.current;
      setHeld(ms);
      if (ms >= HOLD_MS) {
        if (holdTimer.current) clearInterval(holdTimer.current);
        holdTimer.current = null;
        setFlow((f) => ({ ...f, held: true }));
        setAsking(true);
      }
    }, 80);
  };
  const pressOut = () => {
    if (holdTimer.current) clearInterval(holdTimer.current);
    holdTimer.current = null;
    setHeld(0);
  };

  const wipe = async () => {
    if (!flow.scope) return;
    setBusy('wipe');
    setError(null);
    const r = await wipeEverything(flow.scope);
    setBusy(null);
    setAsking(false);
    if (r === 'ok') {
      void speak('সব তথ্য মুছে ফেলা হয়েছে।');
      nav.replace('/setup');
      return;
    }
    setFlow((f) => ({ ...f, held: false, confirmed: false }));
    setError(WIPE_FAIL_BN[r]);
    void speak(WIPE_FAIL_BN[r]);
  };

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.top}>
        <Pressable accessibilityRole="button" accessibilityLabel="ফিরে যান" onPress={() => nav.back()} style={styles.square}>
          <Icon name="back" size={26} color={colors.ink} strokeWidth={2.2} />
        </Pressable>
        <Txt accessibilityRole="header" size={fontSize.heading} weight="bold" color={DANGER} style={styles.flex}>
          সব তথ্য মুছুন
        </Txt>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="শুনুন"
          onPress={() => void speak('এখানে দোকানের সব হিসাব চিরদিনের জন্য মুছে যায়। আগে ব্যাকআপ ফাইল রাখতে হবে, তারপর দোকানের নাম লিখতে হবে, তারপর পাঁচ সেকেন্ড চেপে ধরতে হবে।')}
          style={styles.listen}
        >
          <Icon name="speaker" size={26} color={colors.onColor} strokeWidth={2} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={styles.warn}>
          <Icon name="alert" size={28} color={DANGER} strokeWidth={2.6} />
          <Txt wrap size={fontSize.body} weight="bold" color={DANGER} style={styles.flex}>
            {`${counts.entries}টা হিসাব, ${counts.customers} জন ক্রেতা, ${counts.products}টা মাল মুছে যাবে। আর ফেরত আনা যাবে না।`}
          </Txt>
        </View>

        {/* 1 */}
        <Txt size={fontSize.label} weight="bold">
          ১. কোথা থেকে মুছবেন?
        </Txt>
        <ScopeCard
          title="শুধু এই ফোন থেকে"
          detail="এই ফোনের হিসাব মুছবে, ফোন লগ আউট হবে। অন্য ফোন আর Google এ হিসাব থাকবে।"
          on={flow.scope === 'phone'}
          onPress={() => setFlow((f) => chooseScope(f, 'phone'))}
        />
        <ScopeCard
          title="সব ফোন + Google থেকে"
          detail={signedIn ? "Google এর ডাটাবেস আর Drive এর “Mudi Dokan” ফোল্ডারসহ সব। অন্য ফোনগুলো মুছতে চাইবে।" : 'আগে Google অ্যাকাউন্টে ঢুকতে হবে।'}
          on={flow.scope === 'everywhere'}
          disabled={!signedIn}
          onPress={() => setFlow((f) => chooseScope(f, 'everywhere'))}
        />

        {/* 2 */}
        {at !== 'scope' && (
          <>
            <Txt size={fontSize.label} weight="bold">
              ২. আগে ব্যাকআপ রাখুন
            </Txt>
            <Pressable
              accessibilityRole="button"
              disabled={!!busy}
              onPress={() => void backup()}
              style={({ pressed }) => [styles.action, flow.backedUp ? styles.done : styles.todo, pressed && styles.pressed]}
            >
              {busy === 'backup' ? <ActivityIndicator color={colors.ink} /> : <Icon name={flow.backedUp ? 'check' : 'up'} size={26} color={flow.backedUp ? colors.saleDark : colors.ink} strokeWidth={2.4} />}
              <Txt size={fontSize.label} weight="bold" color={flow.backedUp ? colors.saleDark : colors.ink} style={styles.flex}>
                {flow.backedUp ? 'ব্যাকআপ ফাইল রাখা হয়েছে' : 'ব্যাকআপ ফাইল বানান ও রাখুন'}
              </Txt>
            </Pressable>
          </>
        )}

        {/* 3 */}
        {(at === 'name' || at === 'hold' || at === 'final' || at === 'ready') && (
          <>
            <Txt size={fontSize.label} weight="bold">
              ৩. দোকানের নাম লিখুন
            </Txt>
            <Txt wrap size={fontSize.captionLg} weight="medium" color={colors.muted}>
              {shopName ? 'হুবহু এভাবে লিখুন:' : 'দোকানের নাম নেই, এই শব্দটা লিখুন:'} “{word}”
            </Txt>
            <TextInput
              value={flow.typed}
              onChangeText={(t) => setFlow((f) => typeName(f, t))}
              placeholder={word}
              placeholderTextColor={colors.muted}
              autoCorrect={false}
              style={[styles.input, nameMatches(flow.typed, shopName) && styles.inputOk]}
            />
          </>
        )}

        {/* 4 */}
        {(at === 'hold' || at === 'final' || at === 'ready') && (
          <>
            <Txt size={fontSize.label} weight="bold">
              ৪. পাঁচ সেকেন্ড চেপে ধরুন
            </Txt>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="পাঁচ সেকেন্ড চেপে ধরুন"
              onPressIn={pressIn}
              onPressOut={pressOut}
              disabled={!!busy}
              style={styles.hold}
            >
              <View style={[styles.holdFill, { width: `${Math.round(holdProgress(held) * 100)}%` }]} />
              <Icon name="trash" size={30} color={colors.onColor} strokeWidth={2.2} />
              <Txt size={fontSize.listAmount} weight="bold" color={colors.onColor}>
                {held > 0 ? `${Math.max(1, Math.ceil((HOLD_MS - held) / 1000))}…` : 'চেপে ধরুন'}
              </Txt>
            </Pressable>
          </>
        )}

        {error && (
          <Txt wrap size={fontSize.body} weight="bold" color={DANGER}>
            {error}
          </Txt>
        )}
        {busy === 'wipe' && <ActivityIndicator color={DANGER} />}
      </ScrollView>

      <ConfirmSheet
        visible={asking}
        busy={busy === 'wipe'}
        text={flow.scope ? finalWarning(flow.scope as WipeScope, shopName, counts) : ''}
        onYes={() => {
          setFlow((f) => ({ ...f, confirmed: true }));
          void wipe();
        }}
        onNo={() => {
          setAsking(false);
          setFlow((f) => ({ ...f, held: false }));
          void speak('ঠিক আছে, কিছু মোছা হয়নি।');
        }}
      />
    </SafeAreaView>
  );
}

function ScopeCard(p: { title: string; detail: string; on: boolean; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: p.on, disabled: p.disabled }}
      disabled={p.disabled}
      onPress={p.onPress}
      style={({ pressed }) => [styles.scope, p.on && styles.scopeOn, p.disabled && styles.disabled, pressed && styles.pressed]}
    >
      <View style={[styles.radio, p.on && styles.radioOn]}>{p.on && <Icon name="check" size={18} color={colors.onColor} strokeWidth={3} />}</View>
      <View style={styles.flex}>
        <Txt wrap size={fontSize.label} weight="bold" color={p.on ? DANGER : colors.ink}>
          {p.title}
        </Txt>
        <Txt wrap size={fontSize.caption} weight="medium" color={colors.muted}>
          {p.detail}
        </Txt>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: spacing.screen, paddingTop: spacing.screenTop, paddingBottom: 18, gap: spacing.md },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
  square: { width: size.iconButton, height: size.iconButton, borderRadius: radius.icon, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  listen: { width: size.iconButton, height: size.iconButton, borderRadius: radius.pill, backgroundColor: colors.dark, alignItems: 'center', justifyContent: 'center' },
  body: { gap: spacing.md, paddingBottom: spacing.xl },
  warn: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: DANGER_TINT, borderRadius: radius.card, padding: spacing.lg, borderWidth: 2, borderColor: DANGER },
  scope: { minHeight: 80, borderRadius: radius.card, borderWidth: 2, borderColor: colors.border, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg },
  scopeOn: { borderColor: DANGER, backgroundColor: DANGER_TINT },
  radio: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  radioOn: { backgroundColor: DANGER, borderColor: DANGER },
  action: { minHeight: 64, borderRadius: radius.card, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg },
  todo: { backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.border },
  done: { backgroundColor: colors.saleTint },
  input: { minHeight: 64, borderRadius: radius.card, borderWidth: 2, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: spacing.lg, paddingVertical: 0, fontSize: fontSize.label, color: colors.ink, fontFamily: 'HindSiliguri_600SemiBold' },
  inputOk: { borderColor: colors.sale },
  hold: { height: 84, borderRadius: radius.section, backgroundColor: '#8C1D18', overflow: 'hidden', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  holdFill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: DANGER },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
});
