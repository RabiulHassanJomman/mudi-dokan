import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { Icon, productIcon, type IconName } from '../../components/Icon';
import { ScreenHeader } from '../../components/ScreenHeader';
import { Txt } from '../../components/Txt';
import { buildLabel } from '../../lib/buildInfo';
import { cashDay, getSetup, pilotStats, recentEntries, todayTotals, type PilotStats } from '../../db/repo';
import { today as todayDate } from '../../domain/cash';
import { recentLine, type RecentEntry } from '../../domain/recent';
import { getDevice } from '../../device';
import { formatNumber, formatTaka, toBnDigits } from '../../lib/bn';
import { speak } from '../../lib/speak';
import { useClipPlayer } from '../../lib/useClipPlayer';
import { colors, fontSize, productTiles, radius, size, spacing } from '../../theme/tokens';

/** Tile picture and colours per entry type (sale lines keep their product picture). */
function entryLook(e: RecentEntry): { icon: IconName; tile: string; ink: string; border: string } {
  switch (e.kind) {
    case 'sale':
      return {
        icon: e.lines === 1 ? productIcon(e.title) : 'box',
        tile: (e.lines === 1 && productTiles[e.title]) || colors.neutralTint,
        ink: colors.bakiInk,
        border: e.credit ? colors.bakiBorder : 'transparent',
      };
    case 'baki':
      return { icon: 'book', tile: colors.bakiTint, ink: colors.bakiInk, border: colors.bakiBorder };
    case 'joma':
      return { icon: 'cash', tile: colors.saleTint, ink: colors.saleDark, border: 'transparent' };
    case 'expense':
      return { icon: 'cash', tile: colors.bakiTint, ink: colors.bakiInk, border: 'transparent' };
    case 'owner_withdrawal':
      return { icon: 'person', tile: colors.stockTint, ink: colors.stock, border: 'transparent' };
    case 'purchase':
      return { icon: productIcon(e.title), tile: colors.stockTint, ink: colors.stock, border: 'transparent' };
  }
}

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** বিক্রি (home): big mic, today's numbers, last entries. */
export default function SaleScreen() {
  const db = useSQLiteContext();
  const play = useClipPlayer();
  const [shopName, setShopName] = useState<string | null>(null);
  const [today, setToday] = useState({ sales: 0, baki: 0 });
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  const [stats, setStats] = useState<PilotStats | null>(null);
  /** হাতে ক্যাশ = today's expected cash in hand. */
  const [cash, setCash] = useState<number | null>(null);

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        setToday(await todayTotals(db, startOfToday()));
        setCash((await cashDay(db, todayDate())).expectedPoisha);
        setRecent(await recentEntries(db, 3));
        setStats(await pilotStats(db));
        setShopName((await getSetup(db, getDevice().id)).shopName);
      })();
    }, [db]),
  );

  const readScreen = () => {
    const last = recent[0];
    void speak(
      (cash !== null ? `হাতে ক্যাশ ${formatNumber(cash / 100).replace(/,/g, '')} টাকা। ` : '') +
        `আজ বিক্রি ${formatNumber(today.sales / 100)} টাকা। আজ বাকি ${formatNumber(today.baki / 100)} টাকা। ` +
        (last ? `শেষ: ${recentLine(last).words} ` : '') +
        'বিক্রি বলতে মাইক চাপুন। ছবি দেখে বেছে নিতে লিখুন চাপুন।',
    );
  };

  return (
    <SafeAreaView edges={['top']} style={styles.screen}>
      <ScreenHeader
        title={shopName ?? 'আমার দোকান'}
        onListen={readScreen}
        onSettings={() => router.push({ pathname: '/setup', params: { edit: '1' } })}
      />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`হাতে ক্যাশ ${cash !== null ? formatTaka(cash) : ''}, আজকের ক্যাশ দেখুন`}
          onPress={() => router.push('/cash')}
          style={({ pressed }) => [styles.cashCard, pressed && styles.pressed]}
        >
          <View style={styles.cashTile}>
            <Icon name="wallet" size={32} color={colors.onColor} strokeWidth={1.8} />
          </View>
          <View style={styles.flex}>
            <Txt size={17} weight="medium" color={colors.onDarkMuted}>
              হাতে ক্যাশ
            </Txt>
            <Txt size={fontSize.amount} weight="bold" color={colors.onColor}>
              {cash !== null ? formatTaka(cash) : '৳ …'}
            </Txt>
          </View>
          <Icon name="forward" size={26} color={colors.onColor} strokeWidth={2.2} />
        </Pressable>
        <View style={styles.tiles}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`আজ বিক্রি ${formatTaka(today.sales)}, আজকের খাতা দেখুন`}
            onPress={() => router.push({ pathname: '/history', params: { filter: 'sale' } })}
            style={({ pressed }) => [styles.tile, { backgroundColor: colors.sale }, pressed && styles.pressed]}
          >
            <Icon name="cash" size={30} color={colors.onColor} />
            <View style={styles.flex}>
              <Txt numberOfLines={1} size={fontSize.listAmount} weight="bold" color={colors.onColor}>
                {formatTaka(today.sales)}
              </Txt>
              <Txt numberOfLines={1} size={fontSize.captionLg} weight="medium" color={colors.onColor}>
                আজ বিক্রি
              </Txt>
            </View>
          </Pressable>
          <View style={[styles.tile, { backgroundColor: colors.bakiTint }]}>
            <Icon name="book" size={30} color={colors.bakiInk} />
            <View style={styles.flex}>
              <Txt numberOfLines={1} size={fontSize.listAmount} weight="bold" color={colors.bakiInk}>
                {formatTaka(today.baki)}
              </Txt>
              <Txt numberOfLines={1} size={fontSize.captionLg} weight="medium" color={colors.bakiInk}>
                আজ বাকি
              </Txt>
            </View>
          </View>
        </View>

        <View style={styles.micArea}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="বলতে চাপুন"
            onPress={() => router.push({ pathname: '/listening', params: { tab: 'sale' } })}
            style={({ pressed }) => [styles.mic, pressed && { transform: [{ scale: 0.96 }] }]}
          >
            <Icon name="mic" size={84} color={colors.onColor} />
          </Pressable>
          <Txt size={fontSize.prompt} weight="bold">
            চাপুন, বলুন
          </Txt>
          {/* লিখুন = type or choose by picture (Pick) */}
          <Pressable accessibilityRole="button" onPress={() => router.push('/pick')} style={styles.typeButton}>
            <Icon name="keyboard" size={24} color={colors.ink2} />
            <Txt size={17} weight="semibold" color={colors.ink2}>
              লিখুন
            </Txt>
          </Pressable>
        </View>

        {recent.map((r) => {
          const line = recentLine(r);
          const look = entryLook(r);
          return (
            <Pressable
              key={`${r.kind}-${r.id}`}
              accessibilityRole="button"
              accessibilityLabel={`${line.words} শুনুন`}
              onPress={() => void speak(line.words)}
              style={({ pressed }) => [styles.entry, { borderColor: look.border }, pressed && styles.pressed]}
            >
              <View style={[styles.entryTile, { backgroundColor: look.tile }]}>
                <Icon name={look.icon} size={30} color={r.kind === 'sale' || r.kind === 'purchase' ? colors.ink : look.ink} strokeWidth={1.6} />
              </View>
              <View style={styles.flex}>
                <Txt size={21} weight="bold">
                  {line.title}
                </Txt>
                <Txt size={fontSize.bodyLg} weight="medium" color={colors.ink2}>
                  {line.detail}
                </Txt>
              </View>
              <View style={styles.entryRight}>
                <Txt size={fontSize.button} weight="bold">
                  {formatTaka(r.amount_poisha)}
                </Txt>
                {line.badge && line.badge !== line.detail && (
                  <Txt size={fontSize.caption} weight="bold" color={look.ink}>
                    {line.badge}
                  </Txt>
                )}
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${line.title}, রেকর্ড শুনুন`}
                accessibilityState={{ disabled: !r.audio_path }}
                onPress={() => play(r.audio_path)}
                style={[styles.play, !r.audio_path && styles.disabled]}
              >
                <Icon name="play" size={22} color={colors.sale} />
              </Pressable>
            </Pressable>
          );
        })}

        <Pressable accessibilityRole="button" onPress={() => router.push('/pilot-log')} style={styles.logLink}>
          <Icon name="list" size={20} color={colors.muted} />
          <Txt size={fontSize.captionLg} weight="semibold" color={colors.muted}>
            পাইলট লগ
            {stats && stats.total > 0
              ? ` · ${toBnDigits(stats.total)}টি কমান্ড${stats.accuracy !== null ? ` · ${toBnDigits(stats.accuracy)}% ঠিক` : ''}`
              : ''}
          </Txt>
        </Pressable>
        {__DEV__ && (
          <Txt size={fontSize.caption} weight="medium" color={colors.muted} style={styles.build}>
            {buildLabel()}
          </Txt>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  body: { paddingHorizontal: spacing.screen, paddingBottom: spacing.xl, gap: spacing.sm },
  flex: { flex: 1 },
  tiles: { flexDirection: 'row', gap: spacing.sm },
  tile: {
    flex: 1,
    borderRadius: radius.card,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  micArea: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.lg },
  cashCard: {
    backgroundColor: colors.dark,
    borderRadius: radius.button,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.screen,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
  },
  cashTile: {
    width: size.iconButton,
    height: size.iconButton,
    borderRadius: radius.icon,
    backgroundColor: colors.darkTile,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mic: {
    width: size.mic,
    height: size.mic,
    borderRadius: radius.pill,
    borderWidth: size.micRing,
    borderColor: colors.micRing,
    backgroundColor: colors.sale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  typeButton: {
    height: 48,
    paddingHorizontal: 18,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  entry: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  pressed: { opacity: 0.85 },
  entryTile: {
    width: size.listTile,
    height: size.listTile,
    borderRadius: radius.icon,
    alignItems: 'center',
    justifyContent: 'center',
  },
  entryRight: { alignItems: 'flex-end' },
  play: {
    width: size.iconButton,
    height: size.iconButton,
    borderRadius: radius.pill,
    backgroundColor: colors.saleTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.35 },
  build: { textAlign: 'center' },
  logLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xxs,
    minHeight: size.minTouch,
  },
});
