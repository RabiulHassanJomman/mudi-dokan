import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { Icon, productIcon, type IconName } from '../components/Icon';
import { Txt } from '../components/Txt';
import { historyRows } from '../db/repo';
import { addDays, dayStart, today } from '../domain/cash';
import { HISTORY_FILTERS, buildHistory, historyLine, historyWords, matchesFilter, type HistoryFilter, type HistoryItem } from '../domain/history';
import { dayLabel, formatTaka } from '../lib/bn';
import { speak, stopSpeaking } from '../lib/speak';
import { useClipPlayer } from '../lib/useClipPlayer';
import { colors, fontSize, productTiles, radius, size, spacing } from '../theme/tokens';

const FILTER_LOOK: Record<HistoryFilter, { bg: string; ink: string }> = {
  all: { bg: colors.neutralTint, ink: colors.ink2 },
  sale: { bg: colors.saleTint, ink: colors.saleDark },
  baki: { bg: colors.bakiTint, ink: colors.bakiInk },
  expense: { bg: colors.neutralTint, ink: colors.ink2 },
};

function look(i: HistoryItem): { icon: IconName; tile: string; ink: string } {
  switch (i.kind) {
    case 'sale':
      return {
        icon: i.lines === 1 ? productIcon(i.title) : 'box',
        tile: (i.lines === 1 && productTiles[i.title]) || colors.neutralTint,
        ink: i.credit ? colors.bakiInk : colors.ink,
      };
    case 'baki':
      return { icon: 'book', tile: colors.bakiTint, ink: colors.bakiInk };
    case 'joma':
      return { icon: 'book', tile: colors.saleTint, ink: colors.saleDark };
    case 'expense':
      return { icon: 'up', tile: colors.neutralTint, ink: colors.bakiInk };
    case 'owner_withdrawal':
      return { icon: 'person', tile: colors.stockTint, ink: colors.stock };
    case 'purchase':
      return { icon: productIcon(i.title), tile: colors.stockTint, ink: colors.stock };
  }
}

const isOut = (i: HistoryItem) => i.kind === 'expense' || i.kind === 'owner_withdrawal' || i.kind === 'purchase';

/**
 * আজকের খাতা (History.dc.html): every entry of a day, ▶️ its clip, ✏️ fix it (a correction,
 * never an edit). Filters সব / বিক্রি / বাকি / খরচ; ◀ ▶ for past days. Opens from the Cash
 * screen and the home "আজ বিক্রি" tile (filter বিক্রি).
 */
export default function HistoryScreen() {
  const db = useSQLiteContext();
  const play = useClipPlayer();
  const params = useLocalSearchParams<{ filter?: string; date?: string }>();
  const [date, setDate] = useState(params.date ?? today());
  const [filter, setFilter] = useState<HistoryFilter>(HISTORY_FILTERS.some((f) => f.key === params.filter) ? (params.filter as HistoryFilter) : 'all');
  const [items, setItems] = useState<HistoryItem[]>([]);
  const isToday = date === today();
  const title = isToday ? 'আজকের খাতা' : `${dayLabel(dayStart(date))}-এর খাতা`;

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void (async () => {
        const rows = await historyRows(db, dayStart(date), dayStart(addDays(date, 1)));
        if (alive) setItems(buildHistory(rows));
      })();
      return () => {
        alive = false;
        stopSpeaking();
      };
    }, [db, date]),
  );

  const shown = items.filter((i) => matchesFilter(i, filter));
  const goDay = (n: number) => {
    const next = addDays(date, n);
    if (next > today()) return;
    setDate(next);
    void speak(next === today() ? 'আজ' : dayLabel(dayStart(next)));
  };
  const fix = (i: HistoryItem) => {
    stopSpeaking();
    router.push({ pathname: '/confirm', params: { fix: `${i.table}:${i.id}` } });
  };

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.top}>
        <Pressable accessibilityRole="button" accessibilityLabel="ফিরে যান" onPress={() => router.back()} style={styles.square}>
          <Icon name="back" size={26} color={colors.ink} strokeWidth={2.2} />
        </Pressable>
        <Txt accessibilityRole="header" size={fontSize.heading} weight="bold" style={styles.flex}>
          {title}
        </Txt>
        <Pressable accessibilityRole="button" accessibilityLabel="খাতা শুনুন" onPress={() => void speak(historyWords(shown, title))} style={styles.listen}>
          <Icon name="speaker" size={26} color={colors.onColor} strokeWidth={2} />
        </Pressable>
      </View>

      <View style={styles.dayRow}>
        <Pressable accessibilityRole="button" accessibilityLabel="আগের দিন" onPress={() => goDay(-1)} style={styles.dayButton}>
          <Icon name="back" size={26} color={colors.ink} strokeWidth={2.4} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="আজকে ফিরুন" onPress={() => setDate(today())} style={styles.dayLabel}>
          <Txt size={fontSize.label} weight="bold">
            {dayLabel(dayStart(date))}
          </Txt>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="পরের দিন"
          accessibilityState={{ disabled: isToday }}
          onPress={() => goDay(1)}
          style={[styles.dayButton, isToday && styles.disabled]}
        >
          <Icon name="forward" size={26} color={colors.ink} strokeWidth={2.4} />
        </Pressable>
      </View>

      <View accessibilityRole="radiogroup" accessibilityLabel="কোনগুলো দেখবেন" style={styles.filters}>
        {HISTORY_FILTERS.map((f) => {
          const on = filter === f.key;
          const l = FILTER_LOOK[f.key];
          return (
            <Pressable
              key={f.key}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              onPress={() => setFilter(f.key)}
              style={[styles.filter, { backgroundColor: on ? colors.dark : l.bg, borderColor: on ? colors.dark : l.bg }]}
            >
              <Txt size={fontSize.body} weight="bold" color={on ? colors.onColor : l.ink}>
                {f.label}
              </Txt>
            </Pressable>
          );
        })}
      </View>

      <ScrollView contentContainerStyle={styles.list}>
        {!shown.length && (
          <Txt wrap size={fontSize.body} weight="medium" color={colors.muted} style={styles.empty}>
            এই দিনে কোনো লেখা নেই।
          </Txt>
        )}
        {shown.map((i) => {
          const line = historyLine(i);
          const lk = look(i);
          return (
            <Pressable
              key={`${i.table}-${i.id}`}
              accessibilityRole="button"
              accessibilityLabel={`${line.words} শুনুন`}
              onPress={() => void speak(line.words)}
              style={({ pressed }) => [styles.row, i.fixed && styles.rowFixed, i.voided && styles.rowVoided, pressed && styles.pressed]}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${line.title}, রেকর্ড শুনুন`}
                accessibilityState={{ disabled: !i.audio_path }}
                onPress={() => play(i.audio_path)}
                style={[styles.play, !i.audio_path && styles.disabled]}
              >
                <Icon name="play" size={22} color={colors.sale} />
              </Pressable>
              <View style={[styles.tile, { backgroundColor: lk.tile }]}>
                <Icon name={lk.icon} size={26} color={i.kind === 'sale' || i.kind === 'purchase' ? colors.ink : lk.ink} strokeWidth={1.6} />
              </View>
              <View style={styles.flex}>
                <Txt size={fontSize.bodyLg} weight="bold" style={i.voided && styles.struck}>
                  {line.title}
                </Txt>
                {line.old && line.now ? (
                  <Txt size={fontSize.caption} weight="medium" color={colors.muted}>
                    <Txt size={fontSize.caption} weight="medium" color={colors.muted} style={styles.struck}>
                      {line.old}
                    </Txt>
                    {` → ${line.now}`}
                  </Txt>
                ) : (
                  <Txt size={fontSize.captionLg} weight="medium" color={colors.ink2}>
                    {i.voided ? 'বাতিল করা' : line.detail}
                  </Txt>
                )}
              </View>
              <Txt size={fontSize.label} weight="bold" color={i.voided ? colors.muted : lk.ink} style={i.voided && styles.struck}>
                {`${isOut(i) ? '− ' : ''}${formatTaka(i.amount_poisha)}`}
              </Txt>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${line.title} ঠিক করুন`}
                accessibilityState={{ disabled: i.voided }}
                onPress={() => !i.voided && fix(i)}
                style={[styles.edit, i.voided && styles.disabled]}
              >
                <Icon name="edit" size={22} color={colors.ink} strokeWidth={1.8} />
              </Pressable>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={styles.legend}>
        <View style={styles.legendBox} />
        <Txt size={fontSize.captionLg} weight="medium" color={colors.ink2}>
          নীল দাগ = শুনে ঠিক করা হয়েছে
        </Txt>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: spacing.screen, paddingTop: spacing.screenTop, paddingBottom: spacing.screen, gap: spacing.sm },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
  square: { width: size.iconButton, height: size.iconButton, borderRadius: radius.icon, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  listen: { width: size.iconButton, height: size.iconButton, borderRadius: radius.pill, backgroundColor: colors.dark, alignItems: 'center', justifyContent: 'center' },
  dayRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  dayButton: { width: 64, height: size.iconButton, borderRadius: radius.icon, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  dayLabel: { flex: 1, height: size.iconButton, borderRadius: radius.icon, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  filters: { flexDirection: 'row', gap: spacing.xxs },
  filter: { flex: 1, height: size.iconButton, borderRadius: radius.icon, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  list: { gap: spacing.xs, paddingBottom: spacing.md },
  empty: { textAlign: 'center', padding: spacing.xl },
  row: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderWidth: 3,
    borderColor: 'transparent',
  },
  rowFixed: { borderColor: colors.stock },
  rowVoided: { backgroundColor: colors.neutralTint },
  struck: { textDecorationLine: 'line-through' },
  play: { width: size.iconButton, height: size.iconButton, borderRadius: radius.pill, backgroundColor: colors.saleTint, alignItems: 'center', justifyContent: 'center' },
  tile: { width: 44, height: 44, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  edit: { width: size.iconButton, height: size.iconButton, borderRadius: radius.sm, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  legend: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: 4 },
  legendBox: { width: 18, height: 18, borderRadius: 6, borderWidth: 3, borderColor: colors.stock },
  disabled: { opacity: 0.35 },
  pressed: { opacity: 0.85 },
});
