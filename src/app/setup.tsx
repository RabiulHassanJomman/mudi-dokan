import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { ConfirmSheet } from '../components/ConfirmSheet';
import { Icon } from '../components/Icon';
import { NumberPadSheet } from '../components/NumberPadSheet';
import { Txt } from '../components/Txt';
import { getSetup, saveSetup } from '../db/repo';
import { getDevice, markSetupDone, setDevice, writer } from '../device';
import {
  DEVICE_PRESETS,
  ROLE_BN,
  businessDate,
  defaultRole,
  setupProblems,
  setupReadback,
  type Role,
  type SetupDraft,
  type SetupProblem,
} from '../domain/setup';
import { formatNumber, formatTaka, toBnDigits } from '../lib/bn';
import { speak, stopSpeaking } from '../lib/speak';
import { useVoiceOnce } from '../lib/useVoiceOnce';
import { parseSpokenAmount } from '../parser';
import { colors, fonts, fontSize, radius, size, spacing } from '../theme/tokens';

const PLACEHOLDER_DEVICE = 'এই ফোন';

const PROBLEM_TEXT: Record<SetupProblem, string> = {
  shop_name: 'দোকানের নাম লিখুন।',
  device_name: 'এই ফোন কার, বেছে নিন।',
  role: 'মালিক না কর্মচারী, বেছে নিন।',
  opening_cash: 'ক্যাশে কত টাকা, বলুন বা চাপুন।',
};

/**
 * প্রথমবার চালু: shop name, whose phone (+ role), opening cash. Runs once (first launch);
 * ?edit=1 opens it from ⚙ on the home screen with the saved values. Nothing is saved
 * before the ঠিক আছে? sheet's হ্যাঁ.
 */
export default function SetupScreen() {
  const db = useSQLiteContext();
  const editing = useLocalSearchParams<{ edit?: string }>().edit === '1';
  const voice = useVoiceOnce();

  const [draft, setDraft] = useState<SetupDraft>({ shopName: '', deviceName: '', role: null, openingCashPoisha: null });
  const [customName, setCustomName] = useState(false);
  const [padOpen, setPadOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [heard, setHeard] = useState<string | null>(null);
  const [shown, setShown] = useState<SetupProblem[]>([]);

  useEffect(() => {
    void (async () => {
      const s = await getSetup(db, getDevice().id);
      const name = s.deviceName && s.deviceName !== PLACEHOLDER_DEVICE ? s.deviceName : '';
      setCustomName(!!name && !(DEVICE_PRESETS as readonly string[]).includes(name));
      setDraft({
        shopName: s.shopName ?? '',
        deviceName: name,
        role: name ? s.role : null,
        openingCashPoisha: s.openingCashPoisha,
      });
    })();
    return () => {
      stopSpeaking();
    };
  }, [db]);

  const set = (patch: Partial<SetupDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setShown([]);
  };

  const pickName = (name: string) => {
    setCustomName(false);
    set({ deviceName: name, role: defaultRole(name) });
    void speak(name);
  };

  const listenCash = async () => {
    if (voice.listening) return voice.stop();
    stopSpeaking();
    setHeard(null);
    const alts = await voice.listen();
    if (!alts?.length) {
      void speak('শুনতে পাইনি। আবার বলুন, না হলে নম্বর চাপুন।');
      return;
    }
    setHeard(alts[0]!);
    const taka = alts.map(parseSpokenAmount).find((v) => v !== null) ?? null;
    if (taka === null) {
      void speak('বুঝিনি। নম্বর চেপে দিন।');
      setPadOpen(true);
      return;
    }
    set({ openingCashPoisha: Math.round(taka * 100) });
    void speak(`${formatNumber(taka)} টাকা`);
  };

  const readScreen = () => {
    const parts = [
      editing ? 'দোকানের তথ্য।' : 'দোকান চালু করুন।',
      `এক, দোকানের নাম। ${draft.shopName.trim() || 'লেখা হয়নি।'}`,
      `দুই, এই ফোন কার? ${draft.deviceName.trim() ? `${draft.deviceName}, ${draft.role ? ROLE_BN[draft.role] : 'মালিক না কর্মচারী বেছে নিন'}।` : 'আব্বু, আম্মু, না কর্মচারী?'}`,
      `তিন, এখন ক্যাশে কত টাকা? ${draft.openingCashPoisha === null ? 'মাইক চেপে বলুন।' : `${formatNumber(draft.openingCashPoisha / 100)} টাকা।`}`,
      editing ? 'শেষে রাখুন চাপুন।' : 'শেষে শুরু করুন চাপুন।',
    ];
    void speak(parts.join(' '));
  };

  const submit = () => {
    const problems = setupProblems(draft);
    if (problems.length) {
      setShown(problems);
      void speak(problems.map((p) => PROBLEM_TEXT[p]).join(' '));
      return;
    }
    setConfirming(true);
  };

  const save = async () => {
    if (!draft.role) return;
    setSaving(true);
    try {
      const name = draft.deviceName.trim();
      // the kv copy first: writer() stamps device_name on the opening-cash entry
      setDevice(name, draft.role);
      await saveSetup(db, writer(), { ...draft, deviceName: name }, businessDate(new Date()));
      markSetupDone();
      setConfirming(false);
      void speak(editing ? 'রাখা হয়েছে।' : 'দোকান চালু হয়েছে।');
      if (editing && router.canGoBack()) router.back();
      else router.replace('/');
    } catch (e) {
      setSaving(false);
      setConfirming(false);
      void speak('রাখা গেল না।');
      console.warn('saveSetup failed', e);
    }
  };

  const bad = (p: SetupProblem) => shown.includes(p);

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        {editing && (
          <Pressable accessibilityRole="button" accessibilityLabel="ফিরে যান" onPress={() => router.back()} style={styles.back}>
            <Icon name="back" size={26} color={colors.ink} strokeWidth={2.2} />
          </Pressable>
        )}
        <Txt accessibilityRole="header" size={fontSize.headingLg} weight="bold" style={styles.flex}>
          {editing ? 'দোকানের তথ্য' : 'দোকান চালু করুন'}
        </Txt>
        <Pressable accessibilityRole="button" accessibilityLabel="শুনুন" onPress={readScreen} style={styles.listen}>
          <Icon name="speaker" size={26} color={colors.onColor} strokeWidth={2} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Section n={1} title="দোকানের নাম" bad={bad('shop_name')}>
          <TextInput
            value={draft.shopName}
            onChangeText={(t) => set({ shopName: t })}
            accessibilityLabel="দোকানের নাম"
            placeholder="যেমন: রহমান স্টোর"
            placeholderTextColor={colors.muted}
            returnKeyType="done"
            style={styles.input}
          />
        </Section>

        <Section n={2} title="এই ফোন কার?" bad={bad('device_name') || bad('role')}>
          <View accessibilityRole="radiogroup" accessibilityLabel="এই ফোন কার" style={styles.grid}>
            {DEVICE_PRESETS.map((name) => (
              <Chip key={name} label={name} on={!customName && draft.deviceName === name} color={colors.stock} tint={colors.stockTint} onPress={() => pickName(name)} />
            ))}
            {customName ? (
              <TextInput
                autoFocus={!draft.deviceName}
                value={draft.deviceName}
                onChangeText={(t) => set({ deviceName: t })}
                accessibilityLabel="নতুন নাম"
                placeholder="নাম লিখুন"
                placeholderTextColor={colors.muted}
                style={[styles.chip, styles.chipInput]}
              />
            ) : (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setCustomName(true);
                  set({ deviceName: '', role: null });
                }}
                style={[styles.chip, styles.chipNew]}
              >
                <Icon name="plus" size={22} color={colors.ink2} strokeWidth={2.4} />
                <Txt size={fontSize.bodyLg} weight="semibold" color={colors.ink2}>
                  নতুন নাম
                </Txt>
              </Pressable>
            )}
          </View>
          <Txt size={fontSize.captionLg} weight="semibold" color={colors.muted}>
            কাজ
          </Txt>
          <View accessibilityRole="radiogroup" accessibilityLabel="মালিক না কর্মচারী" style={styles.row}>
            {(['owner', 'staff'] as Role[]).map((r) => (
              <Chip
                key={r}
                label={ROLE_BN[r]}
                on={draft.role === r}
                color={colors.sale}
                tint={colors.saleTint}
                onPress={() => {
                  set({ role: r });
                  void speak(ROLE_BN[r]);
                }}
              />
            ))}
          </View>
        </Section>

        <Section n={3} title="এখন ক্যাশে কত টাকা?" bad={bad('opening_cash')}>
          <View style={styles.cashRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={draft.openingCashPoisha === null ? 'টাকা চেপে দিন' : `${formatTaka(draft.openingCashPoisha)}, বদলান`}
              onPress={() => setPadOpen(true)}
              style={styles.flex}
            >
              <Txt size={fontSize.promptLg} weight="bold" color={draft.openingCashPoisha === null ? colors.muted : colors.ink}>
                {draft.openingCashPoisha === null ? '৳ —' : formatTaka(draft.openingCashPoisha)}
              </Txt>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={voice.listening ? 'থামুন' : 'বলে দিন'}
              onPress={() => void listenCash()}
              style={[styles.round, { backgroundColor: voice.listening ? colors.baki : colors.sale }]}
            >
              <Icon name="mic" size={32} color={colors.onColor} />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="নম্বর চেপে দিন" onPress={() => setPadOpen(true)} style={[styles.round, styles.roundNeutral]}>
              <Icon name="keypad" size={28} color={colors.ink} />
            </Pressable>
          </View>
          {voice.listening ? (
            <Txt size={fontSize.captionLg} weight="semibold" color={colors.baki}>
              শুনছি… যেমন “পাঁচ হাজার টাকা”
            </Txt>
          ) : heard ? (
            <Txt size={fontSize.captionLg} weight="medium" color={colors.muted}>
              শুনেছি: “{heard}”
            </Txt>
          ) : null}
        </Section>

        {/* settings only: bring in an existing customer list (.txt) */}
        {editing && (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/import', params: { kind: 'customers' } })}
            style={({ pressed }) => [styles.importButton, pressed && styles.pressed]}
          >
            <Icon name="list" size={28} color={colors.baki} />
            <Txt size={fontSize.label} weight="bold" color={colors.bakiInk} style={styles.flex}>
              ক্রেতার তালিকা আনুন
            </Txt>
            <Icon name="arrow" size={24} color={colors.bakiInk} />
          </Pressable>
        )}
      </ScrollView>

      <Pressable accessibilityRole="button" onPress={submit} style={({ pressed }) => [styles.start, pressed && styles.pressed]}>
        <Txt size={fontSize.listAmount} weight="bold" color={colors.onColor}>
          {editing ? 'রাখুন' : 'শুরু করুন'}
        </Txt>
        <Icon name={editing ? 'check' : 'arrow'} size={30} color={colors.onColor} strokeWidth={2.4} />
      </Pressable>

      <NumberPadSheet
        visible={padOpen}
        title="এখন ক্যাশে কত টাকা?"
        prefix="৳"
        initial={draft.openingCashPoisha === null ? null : draft.openingCashPoisha / 100}
        onClose={() => setPadOpen(false)}
        onDone={(v) => {
          setPadOpen(false);
          if (v === null) return;
          set({ openingCashPoisha: Math.round(v * 100) });
          void speak(`${formatNumber(v)} টাকা`);
        }}
      />
      <ConfirmSheet
        visible={confirming}
        text={setupReadback(draft)}
        busy={saving}
        onYes={() => void save()}
        onNo={() => setConfirming(false)}
      />
    </SafeAreaView>
  );
}

function Section({ n, title, bad, children }: { n: number; title: string; bad: boolean; children: React.ReactNode }) {
  return (
    <View style={[styles.section, bad && styles.sectionBad]}>
      <View style={styles.sectionHead}>
        <View style={styles.num}>
          <Txt size={fontSize.button} weight="bold" color={colors.onColor}>
            {toBnDigits(n)}
          </Txt>
        </View>
        <Txt size={21} weight="bold" style={styles.flex}>
          {title}
        </Txt>
      </View>
      {children}
    </View>
  );
}

function Chip({ label, on, color, tint, onPress }: { label: string; on: boolean; color: string; tint: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: on }}
      onPress={onPress}
      style={[styles.chip, on ? { borderColor: color, backgroundColor: tint } : null]}
    >
      <Txt size={fontSize.bodyLg} weight={on ? 'bold' : 'semibold'} color={on ? color : colors.ink2}>
        {label}
      </Txt>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  importButton: {
    minHeight: 64,
    borderRadius: radius.card,
    borderWidth: 2,
    borderColor: colors.bakiBorder,
    backgroundColor: colors.bakiTint,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  screen: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: spacing.screen, paddingBottom: spacing.screen, gap: spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingTop: spacing.xl },
  flex: { flex: 1 },
  back: {
    width: size.iconButton,
    height: size.iconButton,
    borderRadius: radius.icon,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listen: {
    width: size.iconButton,
    height: size.iconButton,
    borderRadius: radius.pill,
    backgroundColor: colors.dark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { gap: spacing.md, paddingBottom: spacing.md },
  section: { backgroundColor: colors.surface, borderRadius: radius.section, padding: spacing.lg, gap: spacing.sm, borderWidth: 3, borderColor: colors.surface },
  sectionBad: { borderColor: colors.baki },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  num: { width: 40, height: 40, borderRadius: radius.pill, backgroundColor: colors.sale, alignItems: 'center', justifyContent: 'center' },
  input: {
    height: size.stepper,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: radius.icon,
    paddingHorizontal: spacing.lg,
    paddingVertical: 0,
    fontFamily: fonts.semibold,
    fontSize: fontSize.label,
    color: colors.ink,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  row: { flexDirection: 'row', gap: spacing.xs },
  chip: {
    flexGrow: 1,
    flexBasis: '45%',
    height: 60,
    borderRadius: radius.tab,
    borderWidth: 3,
    borderColor: colors.divider,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xxs,
  },
  chipNew: { borderStyle: 'dashed', borderColor: colors.border },
  chipInput: {
    borderColor: colors.stock,
    paddingHorizontal: spacing.md,
    paddingVertical: 0,
    fontFamily: fonts.bold,
    fontSize: fontSize.bodyLg,
    color: colors.stock,
    textAlign: 'center',
  },
  cashRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  round: { width: size.stepper, height: size.stepper, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  roundNeutral: { backgroundColor: colors.neutralTint },
  start: {
    height: 80,
    borderRadius: radius.section,
    backgroundColor: colors.sale,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  pressed: { opacity: 0.85 },
});
