import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { AccountCard } from '../components/AccountCard';
import { ConfirmSheet } from '../components/ConfirmSheet';
import { Icon } from '../components/Icon';
import { Txt } from '../components/Txt';
import { formatNumber } from '../lib/bn';
import { nav } from '../lib/nav';
import { speak, stopSpeaking } from '../lib/speak';
import { mergePairs, startSync, useDataVersion, useSyncStatus } from '../sync/app';
import { DAILY_WRITE_BUDGET } from '../sync/tables';
import { PHASE_BN, agoBn, syncWords } from '../sync/words';
import { colors, fontSize, radius, size, spacing } from '../theme/tokens';

/**
 * ⚙ › সিঙ্ক: account, last sync, how many rows wait to go up, today's writes against the
 * free limit, "এখন সিঙ্ক করুন", and the "এই দুইটা কি একই?" list if there is one.
 */
export default function SyncScreen() {
  const db = useSQLiteContext();
  const status = useSyncStatus();
  const version = useDataVersion();
  const [dupes, setDupes] = useState(0);
  const [busy, setBusy] = useState(false);
  const [askResume, setAskResume] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void mergePairs(db).then((p) => alive && setDupes(p.length));
      return () => {
        alive = false;
        stopSpeaking();
      };
    }, [db, version]),
  );

  const now = async () => {
    setBusy(true);
    try {
      const c = await startSync();
      await c.syncNow();
      void speak(PHASE_BN[c.current.phase]);
    } finally {
      setBusy(false);
    }
  };

  const stats = status?.stats;
  const rows: [string, string][] = [
    ['অবস্থা', status ? PHASE_BN[status.phase] : '…'],
    ['শেষ সিঙ্ক', agoBn(stats?.lastSyncAt ?? null)],
    ['পাঠানো বাকি', formatNumber(stats?.pending ?? 0)],
    ['আজ পাঠানো', `${formatNumber(stats?.writesToday ?? 0)} / ${formatNumber(DAILY_WRITE_BUDGET)}`],
    ['আজ আনা', formatNumber(stats?.readsToday ?? 0)],
  ];
  if (stats?.waiting) rows.push(['অপেক্ষায়', formatNumber(stats.waiting)]);

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.top}>
        <Pressable accessibilityRole="button" accessibilityLabel="ফিরে যান" onPress={() => nav.back()} style={styles.square}>
          <Icon name="back" size={26} color={colors.ink} strokeWidth={2.2} />
        </Pressable>
        <Txt accessibilityRole="header" size={fontSize.headingLg} weight="bold" style={styles.flex}>
          সিঙ্ক
        </Txt>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="শুনুন"
          onPress={() => status && void speak(syncWords(status) + (dupes ? ` ${formatNumber(dupes)}টা নাম দুইবার আছে।` : ''))}
          style={styles.listen}
        >
          <Icon name="speaker" size={26} color={colors.onColor} strokeWidth={2} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.card}>
          <AccountCard />
        </View>

        <View style={styles.card}>
          {rows.map(([k, v], i) => (
            <View key={k} style={[styles.row, i < rows.length - 1 && styles.divider]}>
              <Txt size={fontSize.body} weight="semibold" color={colors.muted} style={styles.flex}>
                {k}
              </Txt>
              <Txt size={fontSize.bodyLg} weight="bold">
                {v}
              </Txt>
            </View>
          ))}
          {status?.phase === 'error' && status.lastError && (
            <Txt wrap size={fontSize.caption} weight="medium" color={colors.bakiInk}>
              {status.lastError}
            </Txt>
          )}
        </View>

        {status?.phase === 'wiped' && (
          <View style={styles.wiped}>
            <Txt wrap size={fontSize.label} weight="bold" color={colors.bakiInk}>
              দোকানের সব তথ্য মোছা হয়েছে। এই ফোনের তথ্য ফোনেই আছে, কিছু পাঠানো হচ্ছে না।
            </Txt>
            <Pressable
              accessibilityRole="button"
              onPress={() => void startSync().then((c) => c.acceptWipe())}
              style={({ pressed }) => [styles.wipedButton, { backgroundColor: colors.baki }, pressed && styles.pressed]}
            >
              <Txt size={fontSize.label} weight="bold" color={colors.onColor}>
                এই ফোনেও মুছুন
              </Txt>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => setAskResume(true)}
              style={({ pressed }) => [styles.wipedButton, { backgroundColor: colors.stock }, pressed && styles.pressed]}
            >
              <Txt size={fontSize.label} weight="bold" color={colors.onColor}>
                এই ফোনের তথ্য আবার পাঠান
              </Txt>
            </Pressable>
          </View>
        )}

        {dupes > 0 && (
          <Pressable
            accessibilityRole="button"
            onPress={() => nav.push('/merge')}
            style={({ pressed }) => [styles.dupes, pressed && styles.pressed]}
          >
            <Icon name="alert" size={28} color={colors.bakiInk} strokeWidth={2.6} />
            <Txt wrap size={fontSize.label} weight="bold" color={colors.bakiInk} style={styles.flex}>
              {`${formatNumber(dupes)}টা নাম দুইবার আছে — এই দুইটা কি একই?`}
            </Txt>
            <Icon name="arrow" size={24} color={colors.bakiInk} />
          </Pressable>
        )}
      </ScrollView>

      <ConfirmSheet
        visible={askResume}
        text="এই ফোনের সব হিসাব আবার দোকানের Google অ্যাকাউন্টে পাঠাবেন? অন্য ফোনেও যাবে।"
        onYes={() => {
          setAskResume(false);
          void startSync().then((c) => c.resumeUpload());
        }}
        onNo={() => setAskResume(false)}
      />

      <Pressable
        accessibilityRole="button"
        disabled={busy || !status?.email}
        onPress={() => void now()}
        style={({ pressed }) => [styles.now, (!status?.email || busy) && styles.disabled, pressed && styles.pressed]}
      >
        {busy ? <ActivityIndicator color={colors.onColor} /> : <Icon name="undo" size={28} color={colors.onColor} strokeWidth={2.4} />}
        <Txt size={fontSize.listAmount} weight="bold" color={colors.onColor}>
          এখন সিঙ্ক করুন
        </Txt>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: spacing.screen, paddingTop: spacing.screenTop, paddingBottom: 18, gap: spacing.md },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
  square: { width: size.iconButton, height: size.iconButton, borderRadius: radius.icon, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  listen: { width: size.iconButton, height: size.iconButton, borderRadius: radius.pill, backgroundColor: colors.dark, alignItems: 'center', justifyContent: 'center' },
  body: { gap: spacing.md, paddingBottom: spacing.sm },
  card: { backgroundColor: colors.surface, borderRadius: radius.section, padding: spacing.lg, gap: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 52, gap: spacing.sm },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.dividerSoft },
  wiped: { backgroundColor: colors.bakiTint, borderRadius: radius.card, borderWidth: 2, borderColor: colors.bakiBorder, padding: spacing.lg, gap: spacing.sm },
  wipedButton: { minHeight: 64, borderRadius: radius.card, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg },
  dupes: {
    minHeight: 72,
    borderRadius: radius.card,
    borderWidth: 2,
    borderColor: colors.bakiBorder,
    backgroundColor: colors.bakiTint,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
  },
  now: {
    height: 80,
    borderRadius: radius.section,
    backgroundColor: colors.stock,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
});
