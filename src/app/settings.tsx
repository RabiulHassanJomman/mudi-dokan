import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { AccountCard } from '../components/AccountCard';
import { Icon, type IconName } from '../components/Icon';
import { Txt } from '../components/Txt';
import { deviceEvents, deviceRows } from '../db/devices';
import { getSetup } from '../db/repo';
import { getDevice } from '../device';
import { adminIds } from '../domain/devices';
import { ROLE_BN } from '../domain/setup';
import { buildLabel } from '../lib/buildInfo';
import { toBnDigits } from '../lib/bn';
import { nav } from '../lib/nav';
import { speak, stopSpeaking } from '../lib/speak';
import { useDataVersion, useSyncStatus } from '../sync/app';
import { colors, fontSize, radius, size, spacing } from '../theme/tokens';

const DANGER_INK = '#B3261E';
const DANGER_TINT = '#FBE9E7';

interface Summary {
  shop: string;
  me: string;
  phones: number;
  admin: boolean;
}

/**
 * ⚙ সেটিংস: one list of big rows, grouped. দোকান (account, shop & my info, ফোনগুলো),
 * হিসাব রাখা (backup, Drive, customer import), সাহায্য (অ্যাপ শেখা), then সব তথ্য মুছুন on
 * its own at the bottom. Long-press the version = debug log.
 */
export default function SettingsScreen() {
  const db = useSQLiteContext();
  const version = useDataVersion();
  const status = useSyncStatus();
  const [sum, setSum] = useState<Summary | null>(null);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void (async () => {
        const me = getDevice();
        const s = await getSetup(db, me.id);
        const rows = await deviceRows(db);
        const admins = adminIds(await deviceEvents(db));
        if (!alive) return;
        setSum({
          shop: s.shopName?.trim() || 'নাম নেই',
          me: `${s.deviceName?.trim() || me.name}${s.role ? `, ${ROLE_BN[s.role]}` : ''}`,
          phones: rows.length,
          admin: admins.has(me.id),
        });
      })();
      return () => {
        alive = false;
        stopSpeaking();
      };
    }, [db, version]),
  );

  const phonesLine = sum ? `${toBnDigits(sum.phones)}টা ফোন${sum.admin ? ' · আপনি অ্যাডমিন' : ''}` : '';

  const readScreen = () => {
    const email = status?.email;
    void speak(
      [
        'সেটিংস।',
        email ? `Google অ্যাকাউন্ট ${email}, ঢোকা আছে।` : 'Google অ্যাকাউন্টে ঢোকা নেই।',
        sum ? `দোকান ও আমার তথ্য: ${sum.shop}, ${sum.me}।` : '',
        `ফোনগুলো: ${phonesLine.replace(' · ', ', ')}। এখানে সব ফোন দেখা, অ্যাডমিন বানানো আর লগ আউট করানো যায়।`,
        'তারপর ব্যাকআপ, ভয়েস রেকর্ড, ক্রেতার তালিকা আনুন, অ্যাপ শেখা। সবার নিচে সব তথ্য মুছুন।',
      ].join(' '),
    );
  };

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="ফিরে যান" onPress={() => nav.back()} style={styles.back}>
          <Icon name="back" size={26} color={colors.ink} strokeWidth={2.2} />
        </Pressable>
        <Txt accessibilityRole="header" size={fontSize.headingLg} weight="bold" style={styles.flex}>
          সেটিংস
        </Txt>
        <Pressable accessibilityRole="button" accessibilityLabel="শুনুন" onPress={readScreen} style={styles.listen}>
          <Icon name="speaker" size={26} color={colors.onColor} strokeWidth={2} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <Group title="দোকান">
          <View style={styles.card}>
            <Txt size={fontSize.captionLg} weight="semibold" color={colors.muted}>
              দোকানের Google অ্যাকাউন্ট
            </Txt>
            <AccountCard showSync />
          </View>
          <Row icon="edit" tone="sale" title="দোকান ও আমার তথ্য" sub={sum ? `${sum.shop} · ${sum.me}` : ''} onPress={() => nav.push({ pathname: '/setup', params: { edit: '1' } })} />
          <Row icon="phone" tone="stock" title="ফোনগুলো" sub={phonesLine} onPress={() => nav.push('/devices')} />
        </Group>

        <Group title="হিসাব রাখা">
          <Row icon="up" tone="sale" title="ব্যাকআপ" sub="Google Drive-এ হিসাবের কপি" onPress={() => nav.push('/backup')} />
          <Row icon="play" tone="sale" title="ভয়েস রেকর্ড (Drive)" sub="বলা কথাগুলো Drive-এ" onPress={() => nav.push('/drive')} />
          <Row icon="list" tone="baki" title="ক্রেতার তালিকা আনুন" sub="পুরনো তালিকা ফোনে আনুন" onPress={() => nav.push({ pathname: '/import', params: { kind: 'customers' } })} />
        </Group>

        <Group title="সাহায্য">
          <Row icon="speaker" tone="sale" title="অ্যাপ শেখা" sub="ছবি আর কথায় শিখুন" onPress={() => nav.push({ pathname: '/tutorial', params: { again: '1' } })} />
        </Group>

        <Row icon="trash" tone="danger" title="সব তথ্য মুছুন" sub="সাবধান: ফেরত আনা যাবে না" onPress={() => nav.push('/wipe')} />

        <Pressable accessibilityRole="button" accessibilityLabel="অ্যাপের সংস্করণ" onLongPress={() => nav.push('/debug-log')} delayLongPress={1500} style={styles.versionBox}>
          <Txt size={fontSize.caption} weight="medium" color={colors.muted}>
            {buildLabel()}
          </Txt>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.group}>
      <Txt size={fontSize.captionLg} weight="bold" color={colors.muted} style={styles.groupTitle}>
        {title}
      </Txt>
      {children}
    </View>
  );
}

type Tone = 'sale' | 'stock' | 'baki' | 'danger';
const TONES: Record<Tone, { ink: string; tint: string }> = {
  sale: { ink: colors.sale, tint: colors.saleTint },
  stock: { ink: colors.stock, tint: colors.stockTint },
  baki: { ink: colors.baki, tint: colors.bakiTint },
  danger: { ink: DANGER_INK, tint: DANGER_TINT },
};

function Row({ icon, tone, title, sub, onPress }: { icon: IconName; tone: Tone; title: string; sub: string; onPress: () => void }) {
  const t = TONES[tone];
  const danger = tone === 'danger';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={sub ? `${title}, ${sub}` : title}
      onPress={onPress}
      style={({ pressed }) => [styles.row, danger && styles.rowDanger, pressed && styles.pressed]}
    >
      <View style={[styles.badge, { backgroundColor: danger ? colors.surface : t.tint }]}>
        <Icon name={icon} size={28} color={t.ink} />
      </View>
      <View style={styles.flex}>
        <Txt size={fontSize.label} weight="bold" color={danger ? DANGER_INK : colors.ink}>
          {title}
        </Txt>
        {sub !== '' && (
          <Txt wrap size={fontSize.captionLg} weight="medium" color={danger ? DANGER_INK : colors.muted}>
            {sub}
          </Txt>
        )}
      </View>
      <Icon name="arrow" size={24} color={danger ? DANGER_INK : colors.ink2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: spacing.screen, gap: spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingTop: spacing.xl },
  flex: { flex: 1 },
  back: { width: size.iconButton, height: size.iconButton, borderRadius: radius.icon, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  listen: { width: size.iconButton, height: size.iconButton, borderRadius: radius.pill, backgroundColor: colors.dark, alignItems: 'center', justifyContent: 'center' },
  body: { gap: spacing.lg, paddingBottom: spacing.xl },
  group: { gap: spacing.sm },
  groupTitle: { paddingHorizontal: spacing.xs },
  card: { backgroundColor: colors.surface, borderRadius: radius.card, padding: spacing.lg, gap: spacing.sm },
  row: {
    minHeight: 76,
    borderRadius: radius.card,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  rowDanger: { backgroundColor: DANGER_TINT, borderWidth: 2, borderColor: DANGER_INK },
  badge: { width: 52, height: 52, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  versionBox: { alignItems: 'center', justifyContent: 'center', minHeight: size.minTouch },
  pressed: { opacity: 0.85 },
});
