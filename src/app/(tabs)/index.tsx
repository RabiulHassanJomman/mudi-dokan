import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { Icon } from '../../components/Icon';
import { ScreenHeader } from '../../components/ScreenHeader';
import { Txt } from '../../components/Txt';
import { pilotStats, recentBaskets, todayTotals, type PilotStats, type RecentBasket } from '../../db/repo';
import { formatQty, formatTaka, toBnDigits } from '../../lib/bn';
import { useClipPlayer } from '../../lib/useClipPlayer';
import { colors, fonts, fontSize, productTiles, radius, size, spacing } from '../../theme/tokens';

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** বিক্রি (home): big mic, today's numbers, last entries. */
export default function SaleScreen() {
  const db = useSQLiteContext();
  const play = useClipPlayer();
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState('');
  const [today, setToday] = useState({ sales: 0, baki: 0 });
  const [recent, setRecent] = useState<RecentBasket[]>([]);
  const [stats, setStats] = useState<PilotStats | null>(null);

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        setToday(await todayTotals(db, startOfToday()));
        setRecent(await recentBaskets(db, 3));
        setStats(await pilotStats(db));
      })();
    }, [db]),
  );

  const submitTyped = () => {
    const t = text.trim();
    if (!t) return;
    setText('');
    setTyping(false);
    router.push({ pathname: '/confirm', params: { text: t, tab: 'sale' } });
  };

  return (
    <SafeAreaView edges={['top']} style={styles.screen}>
      <ScreenHeader title="আমার দোকান" />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={styles.tiles}>
          <View style={[styles.tile, { backgroundColor: colors.sale }]}>
            <Icon name="cash" size={30} color={colors.onColor} />
            <View style={styles.flex}>
              <Txt numberOfLines={1} size={fontSize.listAmount} weight="bold" color={colors.onColor}>
                {formatTaka(today.sales)}
              </Txt>
              <Txt numberOfLines={1} size={fontSize.captionLg} weight="medium" color={colors.onColor}>
                আজ বিক্রি
              </Txt>
            </View>
          </View>
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
          {typing ? (
            <View style={styles.typeRow}>
              <TextInput
                autoFocus
                value={text}
                onChangeText={setText}
                onSubmitEditing={submitTyped}
                returnKeyType="done"
                accessibilityLabel="লিখে দিন"
                placeholder="যেমন: চাল ২ কেজি"
                placeholderTextColor={colors.muted}
                style={styles.input}
              />
              <Pressable accessibilityRole="button" accessibilityLabel="ঠিক আছে" onPress={submitTyped} style={styles.go}>
                <Icon name="check" size={28} color={colors.onColor} strokeWidth={2.6} />
              </Pressable>
            </View>
          ) : (
            <Pressable accessibilityRole="button" onPress={() => setTyping(true)} style={styles.typeButton}>
              <Icon name="keyboard" size={24} color={colors.ink2} />
              <Txt size={17} weight="semibold" color={colors.ink2}>
                লিখুন
              </Txt>
            </Pressable>
          )}
        </View>

        {recent.map((r) => (
          <View key={r.id} style={[styles.entry, r.credit ? styles.entryCredit : null]}>
            <View style={[styles.entryTile, { backgroundColor: (r.lines === 1 && productTiles[r.products]) || colors.neutralTint }]}>
              <Icon name="box" size={30} color={colors.ink} strokeWidth={1.6} />
            </View>
            <View style={styles.flex}>
              <Txt size={21} weight="bold">
                {r.customer ? `${r.products} · ${r.customer}` : r.products}
              </Txt>
              <Txt size={fontSize.bodyLg} weight="medium" color={colors.ink2}>
                {r.lines === 1 ? formatQty(r.quantity, r.unit) : `${toBnDigits(r.lines)}টি জিনিস`}
              </Txt>
            </View>
            <View style={styles.entryRight}>
              <Txt size={fontSize.button} weight="bold">
                {formatTaka(r.amount_poisha)}
              </Txt>
              {!!r.credit && (
                <Txt size={fontSize.caption} weight="bold" color={colors.bakiInk}>
                  বাকি
                </Txt>
              )}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${r.products} শুনুন`}
              accessibilityState={{ disabled: !r.audio_path }}
              onPress={() => play(r.audio_path)}
              style={[styles.play, !r.audio_path && styles.disabled]}
            >
              <Icon name="play" size={22} color={colors.sale} />
            </Pressable>
          </View>
        ))}

        <Pressable accessibilityRole="button" onPress={() => router.push('/pilot-log')} style={styles.logLink}>
          <Icon name="list" size={20} color={colors.muted} />
          <Txt size={fontSize.captionLg} weight="semibold" color={colors.muted}>
            পাইলট লগ
            {stats && stats.total > 0
              ? ` · ${toBnDigits(stats.total)}টি কমান্ড${stats.accuracy !== null ? ` · ${toBnDigits(stats.accuracy)}% ঠিক` : ''}`
              : ''}
          </Txt>
        </Pressable>
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
  micArea: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl },
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
  typeRow: { flexDirection: 'row', gap: spacing.xs, alignSelf: 'stretch' },
  input: {
    flex: 1,
    height: size.iconButton,
    // Android's default input padding clips tall Bangla vowel signs (ি looks like া)
    paddingVertical: 0,
    textAlignVertical: 'center',
    includeFontPadding: true,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: radius.icon,
    paddingHorizontal: spacing.lg,
    fontFamily: fonts.medium,
    fontSize: fontSize.label,
    color: colors.ink,
    backgroundColor: colors.surface,
  },
  go: {
    width: size.iconButton,
    height: size.iconButton,
    borderRadius: radius.icon,
    backgroundColor: colors.sale,
    alignItems: 'center',
    justifyContent: 'center',
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
  entryCredit: { borderColor: colors.bakiBorder },
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
  logLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xxs,
    minHeight: size.minTouch,
  },
});
