import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { AccountCard } from '../components/AccountCard';
import { ConfirmSheet } from '../components/ConfirmSheet';
import { Icon } from '../components/Icon';
import { NumberPadSheet } from '../components/NumberPadSheet';
import { Txt } from '../components/Txt';
import { getSetup, saveDeviceSetup, saveSetup } from '../db/repo';
import { getDevice, isTutorialSeen, markSetupDone, setDevice, writer } from '../device';
import {
  DEVICE_NAME_MAX,
  ROLE_BN,
  businessDate,
  cleanDeviceName,
  nameFromSpeech,
  newSetupDraft,
  setupProblems,
  setupReadback,
  type Role,
  type SetupDraft,
  type SetupProblem,
} from '../domain/setup';
import { formatNumber, formatTaka, toBnDigits } from '../lib/bn';
import { speak, stopSpeaking } from '../lib/speak';
import { useVoiceOnce } from '../lib/useVoiceOnce';
import { useDataVersion, useSyncStatus } from '../sync/app';
import { parseSpokenAmount } from '../parser';
import { colors, fonts, fontSize, radius, size, spacing } from '../theme/tokens';
import { nav } from '../lib/nav';
import { buildLabel } from '../lib/buildInfo';

const DANGER_INK = '#B3261E';

const PLACEHOLDER_DEVICE = 'এই ফোন';

const PROBLEM_TEXT: Record<SetupProblem, string> = {
  shop_name: 'দোকানের নাম লিখুন।',
  device_name: 'আপনার নাম লিখুন বা বলুন।',
  role: 'মালিক না কর্মচারী, বেছে নিন।',
  opening_cash: 'ক্যাশে কত টাকা, বলুন বা চাপুন।',
};

/**
 * প্রথমবার চালু: the shop's Google account (sync; optional), shop name, whose phone (+ role),
 * opening cash. Runs once (first launch);
 * ?edit=1 opens it from ⚙ on the home screen with the saved values. Nothing is saved
 * before the ঠিক আছে? sheet's হ্যাঁ.
 */
export default function SetupScreen() {
  const db = useSQLiteContext();
  const editing = useLocalSearchParams<{ edit?: string }>().edit === '1';
  const voice = useVoiceOnce();
  const synced = useDataVersion();
  const status = useSyncStatus();
  const email = status?.email ?? null;
  /** First run: sign-in comes first; "পরে ঢুকব" = set up offline, sign in later from ⚙. */
  const [later, setLater] = useState(false);
  const waitingSignIn = !editing && !email && !later;
  /** Signed in, first sync still running: we don't know yet whether the shop exists. */
  const fetching = !editing && !!email && status?.stats?.lastSyncAt == null && status?.phase !== 'error';
  /** The shop came from the cloud: only this phone's name and role are asked. */
  const joined = !editing && !!email && !!status?.stats?.cloudShop;
  const mode = { joinedShop: joined };
  const showForm = !waitingSignIn && !fetching;

  const [draft, setDraft] = useState<SetupDraft>(newSetupDraft());
  /** Which 🎤 is listening: the name or the cash. */
  const [listeningFor, setListeningFor] = useState<'name' | 'cash' | null>(null);
  const [heardName, setHeardName] = useState<string | null>(null);
  const [padOpen, setPadOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [heard, setHeard] = useState<string | null>(null);
  const [shown, setShown] = useState<SetupProblem[]>([]);

  useEffect(() => {
    void (async () => {
      const s = await getSetup(db, getDevice().id);
      // an existing phone keeps its saved name and role; a new one starts as কর্মচারী
      const name = s.deviceName && s.deviceName !== PLACEHOLDER_DEVICE ? s.deviceName : '';
      setDraft({
        shopName: s.shopName ?? '',
        deviceName: name,
        role: s.role ?? 'staff',
        openingCashPoisha: s.openingCashPoisha,
      });
    })();
    return () => {
      stopSpeaking();
    };
  }, [db]);

  // another phone's shop came in by sync: fill what is still empty (shop name, opening cash);
  // if the cloud's shop replaced this phone's (shop_adopted), show the cloud's values
  const adopted = status?.notice === 'shop_adopted';
  useEffect(() => {
    if (!synced && !adopted) return;
    void (async () => {
      const s = await getSetup(db, getDevice().id);
      setDraft((d) => ({
        ...d,
        shopName: adopted || !d.shopName.trim() ? (s.shopName ?? '') : d.shopName,
        openingCashPoisha: adopted ? s.openingCashPoisha : (d.openingCashPoisha ?? s.openingCashPoisha),
      }));
    })();
  }, [db, synced, adopted]);

  const set = (patch: Partial<SetupDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setShown([]);
  };

  /** 🎤 next to "আপনার নাম": "আমার নাম রফিক" → রফিক. */
  const listenName = async () => {
    if (voice.listening) {
      setListeningFor(null);
      return voice.stop();
    }
    stopSpeaking();
    setHeardName(null);
    setListeningFor('name');
    const alts = await voice.listen();
    setListeningFor(null);
    const name = alts?.length ? nameFromSpeech(alts[0]!) : '';
    if (!name) {
      void speak('শুনতে পাইনি। আবার বলুন, না হলে লিখে দিন।');
      return;
    }
    setHeardName(alts![0]!);
    set({ deviceName: name });
    void speak(name);
  };

  const listenCash = async () => {
    if (voice.listening) {
      setListeningFor(null);
      return voice.stop();
    }
    stopSpeaking();
    setHeard(null);
    setListeningFor('cash');
    const alts = await voice.listen();
    setListeningFor(null);
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
    if (!showForm) {
      void speak(fetching ? 'দোকানের হিসাব আনা হচ্ছে, একটু অপেক্ষা করুন।' : 'দোকান চালু করুন। প্রথমে দোকানের Google অ্যাকাউন্টে ঢুকুন। ইন্টারনেট না থাকলে পরে ঢুকব চাপুন।');
      return;
    }
    const parts = [
      editing ? 'দোকানের তথ্য।' : 'দোকান চালু করুন।',
      `এক, দোকানের Google অ্যাকাউন্ট। ${email ? `${email}, ঢোকা আছে।` : 'ঢুকুন চাপুন। দোকানের সব ফোনে একই অ্যাকাউন্ট। ইন্টারনেট না থাকলে পরে ঢুকব চাপুন।'}`,
      ...(joined
        ? [`দোকান ${draft.shopName.trim()}, আগের ফোন থেকে আনা। দুই, আপনার নাম।`]
        : [`দুই, দোকানের নাম। ${draft.shopName.trim() || 'লেখা হয়নি।'}`, 'তিন, আপনার নাম।']),
      ` ${draft.deviceName.trim() ? `${draft.deviceName.trim()}, ${draft.role ? ROLE_BN[draft.role] : 'মালিক না কর্মচারী বেছে নিন'}।` : 'লিখুন, না হলে মাইক চেপে বলুন। তারপর মালিক না কর্মচারী।'}`,
      ...(joined ? [] : [`চার, এখন ক্যাশে কত টাকা? ${draft.openingCashPoisha === null ? 'মাইক চেপে বলুন।' : `${formatNumber(draft.openingCashPoisha / 100)} টাকা।`}`]),
      editing ? 'শেষে রাখুন চাপুন।' : 'শেষে শুরু করুন চাপুন।',
    ];
    void speak(parts.join(' '));
  };

  const submit = () => {
    const problems = setupProblems(draft, mode);
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
      // a shop from the cloud keeps its name and opening cash: only this phone's row
      if (joined) await saveDeviceSetup(db, writer(), name, draft.role);
      else await saveSetup(db, writer(), { ...draft, deviceName: name }, businessDate(new Date()));
      markSetupDone();
      setConfirming(false);
      void speak(editing ? 'রাখা হয়েছে।' : 'দোকান চালু হয়েছে।');
      if (editing && nav.canGoBack()) nav.back();
      // a new phone: অ্যাপ শেখা once, then home
      else if (!editing && !isTutorialSeen()) nav.replace('/tutorial');
      else nav.replace('/');
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
          <Pressable accessibilityRole="button" accessibilityLabel="ফিরে যান" onPress={() => nav.back()} style={styles.back}>
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
        <Section n={1} title="দোকানের Google অ্যাকাউন্ট" bad={false}>
          <AccountCard showSync={editing} />
          {waitingSignIn && (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setLater(true);
                void speak('ঠিক আছে, পরে ঢুকবেন। ⚙ থেকে ঢোকা যাবে।');
              }}
              style={({ pressed }) => [styles.later, pressed && styles.pressed]}
            >
              <Txt size={fontSize.label} weight="bold" color={colors.ink2}>
                পরে ঢুকব
              </Txt>
            </Pressable>
          )}
          {fetching && (
            <Txt size={fontSize.captionLg} weight="semibold" color={colors.stock}>
              দোকানের হিসাব আনা হচ্ছে…
            </Txt>
          )}
          {joined && draft.shopName.trim() !== '' && (
            <Txt wrap size={fontSize.body} weight="bold" color={colors.saleDark}>
              {`দোকান: ${draft.shopName.trim()} (আগের ফোন থেকে)`}
            </Txt>
          )}
        </Section>

        {showForm && !joined && (
        <Section n={2} title="দোকানের নাম" bad={bad('shop_name')}>
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
        )}

        {showForm && (
        <Section n={joined ? 2 : 3} title="আপনার নাম" bad={bad('device_name') || bad('role')}>
          <View style={styles.cashRow}>
            <TextInput
              value={draft.deviceName}
              onChangeText={(t) => set({ deviceName: t })}
              onEndEditing={() => set({ deviceName: cleanDeviceName(draft.deviceName) })}
              maxLength={DEVICE_NAME_MAX}
              accessibilityLabel="আপনার নাম"
              placeholder="যেমন: রফিক"
              placeholderTextColor={colors.muted}
              returnKeyType="done"
              style={[styles.input, styles.flex]}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={listeningFor === 'name' ? 'থামুন' : 'নাম বলে দিন'}
              onPress={() => void listenName()}
              style={[styles.round, { backgroundColor: listeningFor === 'name' ? colors.baki : colors.sale }]}
            >
              <Icon name="mic" size={32} color={colors.onColor} />
            </Pressable>
          </View>
          {listeningFor === 'name' ? (
            <Txt size={fontSize.captionLg} weight="semibold" color={colors.baki}>
              শুনছি… যেমন “আমার নাম রফিক”
            </Txt>
          ) : heardName ? (
            <Txt size={fontSize.captionLg} weight="medium" color={colors.muted}>
              শুনেছি: “{heardName}”
            </Txt>
          ) : null}
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
        )}

        {showForm && !joined && (
        <Section n={4} title="এখন ক্যাশে কত টাকা?" bad={bad('opening_cash')}>
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
              accessibilityLabel={listeningFor === 'cash' ? 'থামুন' : 'বলে দিন'}
              onPress={() => void listenCash()}
              style={[styles.round, { backgroundColor: listeningFor === 'cash' ? colors.baki : colors.sale }]}
            >
              <Icon name="mic" size={32} color={colors.onColor} />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="নম্বর চেপে দিন" onPress={() => setPadOpen(true)} style={[styles.round, styles.roundNeutral]}>
              <Icon name="keypad" size={28} color={colors.ink} />
            </Pressable>
          </View>
          {listeningFor === 'cash' ? (
            <Txt size={fontSize.captionLg} weight="semibold" color={colors.baki}>
              শুনছি… যেমন “পাঁচ হাজার টাকা”
            </Txt>
          ) : heard ? (
            <Txt size={fontSize.captionLg} weight="medium" color={colors.muted}>
              শুনেছি: “{heard}”
            </Txt>
          ) : null}
        </Section>
        )}

        {/* settings only: অ্যাপ শেখা again (the first-time tutorial) */}
        {editing && (
          <Pressable
            accessibilityRole="button"
            onPress={() => nav.push({ pathname: '/tutorial', params: { again: '1' } })}
            style={({ pressed }) => [styles.importButton, styles.tutorialButton, pressed && styles.pressed]}
          >
            <Icon name="speaker" size={28} color={colors.sale} />
            <Txt size={fontSize.label} weight="bold" color={colors.saleDark} style={styles.flex}>
              অ্যাপ শেখা
            </Txt>
            <Icon name="arrow" size={24} color={colors.saleDark} />
          </Pressable>
        )}

        {/* settings only (step 8): backup and the voice clips on Drive */}
        {editing && (
          <View style={styles.linkRow}>
            <Pressable
              accessibilityRole="button"
              onPress={() => nav.push('/backup')}
              style={({ pressed }) => [styles.linkButton, pressed && styles.pressed]}
            >
              <Icon name="up" size={26} color={colors.sale} />
              <Txt size={fontSize.label} weight="bold" color={colors.saleDark}>
                ব্যাকআপ
              </Txt>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => nav.push('/drive')}
              style={({ pressed }) => [styles.linkButton, pressed && styles.pressed]}
            >
              <Icon name="play" size={22} color={colors.sale} />
              <Txt size={fontSize.label} weight="bold" color={colors.saleDark}>
                Drive
              </Txt>
            </Pressable>
          </View>
        )}

        {/* settings only: danger zone (সব তথ্য মুছুন) and the hidden debug log (long-press the version) */}
        {editing && (
          <>
            <Pressable
              accessibilityRole="button"
              onPress={() => nav.push('/wipe')}
              style={({ pressed }) => [styles.dangerButton, pressed && styles.pressed]}
            >
              <Icon name="trash" size={26} color={DANGER_INK} />
              <Txt size={fontSize.label} weight="bold" color={DANGER_INK} style={styles.flex}>
                সব তথ্য মুছুন
              </Txt>
              <Icon name="arrow" size={24} color={DANGER_INK} />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="অ্যাপের সংস্করণ" onLongPress={() => nav.push('/debug-log')} delayLongPress={1500} style={styles.versionBox}>
              <Txt size={fontSize.caption} weight="medium" color={colors.muted}>
                {buildLabel()}
              </Txt>
            </Pressable>
          </>
        )}

        {/* settings only: bring in an existing customer list (.txt) */}
        {editing && (
          <Pressable
            accessibilityRole="button"
            onPress={() => nav.push({ pathname: '/import', params: { kind: 'customers' } })}
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

      {showForm && (
      <Pressable accessibilityRole="button" onPress={submit} style={({ pressed }) => [styles.start, pressed && styles.pressed]}>
        <Txt size={fontSize.listAmount} weight="bold" color={colors.onColor}>
          {editing ? 'রাখুন' : 'শুরু করুন'}
        </Txt>
        <Icon name={editing ? 'check' : 'arrow'} size={30} color={colors.onColor} strokeWidth={2.4} />
      </Pressable>
      )}

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
        text={setupReadback(draft, mode)}
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
  linkRow: { flexDirection: 'row', gap: spacing.sm },
  linkButton: {
    flex: 1,
    minHeight: 64,
    borderRadius: radius.card,
    backgroundColor: colors.saleTint,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  dangerButton: {
    minHeight: 64,
    borderRadius: radius.card,
    borderWidth: 2,
    borderColor: DANGER_INK,
    backgroundColor: '#FBE9E7',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  versionBox: { alignItems: 'center', justifyContent: 'center', minHeight: size.minTouch },
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
  tutorialButton: { borderColor: colors.micRing, backgroundColor: colors.saleTint },
  later: { minHeight: 56, borderRadius: radius.icon, backgroundColor: colors.neutralTint, alignItems: 'center', justifyContent: 'center' },
});
