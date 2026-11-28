import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { Icon, type IconName } from '../components/Icon';
import { Txt } from '../components/Txt';
import { cashDay, historyRows, type CashDay } from '../db/repo';
import { addDays, cashRows, cashWords, dayStart, gapOf, today } from '../domain/cash';
import { buildHistory, historyLine, matchesFilter, type HistoryItem } from '../domain/history';
import { formatTaka } from '../lib/bn';
import { speak, stopSpeaking } from '../lib/speak';
import { useClipPlayer } from '../lib/useClipPlayer';
import { colors, fontSize, radius, size, spacing } from '../theme/tokens';
import { nav } from '../lib/nav';
import { openVoice } from '../lib/voice';
import { useDataVersion } from '../sync/app';

const ROW_LOOK: Record<string, { icon: IconName; tile: string; ink: string }> = {
  opening: { icon: 'wallet', tile: colors.neutralTint, ink: colors.ink },
  cashSales: { icon: 'cart', tile: colors.saleTint, ink: colors.saleDark },
  joma: { icon: 'book', tile: colors.saleTint, ink: colors.saleDark },
  expenses: { icon: 'up', tile: colors.bakiTint, ink: colors.bakiInk },
  cashPurchases: { icon: 'box', tile: colors.bakiTint, ink: colors.bakiInk },
  withdrawals: { icon: 'person', tile: colors.bakiTint, ink: colors.bakiInk },
};

/**
 * আজকের ক্যাশ (Cash.dc.html): গতকালের ক্যাশ + নগদ বিক্রি + বাকি জমা − খরচ − নগদ কেনা −
 * মালিক নিল = হাতে থাকার কথা. Today's cash-out list with ▶️, খরচ বলুন / গুনে মিলান, and
 * আজকের খাতা. Opens from the home "হাতে ক্যাশ" card.
 */
export default function CashScreen() {
  const db = useSQLiteContext();
  /** Rows from another phone came in: reload. */
  const synced = useDataVersion();
  const clip = useClipPlayer();
  const [day, setDay] = useState<CashDay | null>(null);
  const [outs, setOuts] = useState<HistoryItem[]>([]);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void (async () => {
        const d = today();
        const c = await cashDay(db, d);
        const h = buildHistory(await historyRows(db, dayStart(d), dayStart(addDays(d, 1))));
        if (!alive) return;
        setDay(c);
        setOuts(h.filter((i) => !i.voided && matchesFilter(i, 'expense')));
      })();
      return () => {
        alive = false;
        stopSpeaking();
      };
    }, [db, synced]),
  );

  const rows = day ? cashRows(day.openingPoisha, day.source, day.flows) : [];
  const gap = day?.close ? gapOf(day.close.counted_cash_poisha, day.expectedPoisha) : null;
  const readScreen = () => {
    if (!day) return;
    let s = cashWords(day.openingPoisha, day.source, day.flows);
    if (day.close) s += ` দিন শেষ করা হয়েছে, গুনে পেলাম ${formatTaka(day.close.counted_cash_poisha).replace('৳ ', '')} টাকা।`;
    if (day.closedOnTwoPhones) s += ' দুইটা ফোন থেকে দিন শেষ করা হয়েছে।';
    void speak(`${s} খরচ বলতে বা নোট গুনে মিলাতে নিচের বোতাম চাপুন।`);
  };
  const go = (to: () => void) => {
    stopSpeaking();
    to();
  };

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.top}>
        <Pressable accessibilityRole="button" accessibilityLabel="ফিরে যান" onPress={() => nav.back()} style={styles.square}>
          <Icon name="back" size={26} color={colors.ink} strokeWidth={2.2} />
        </Pressable>
        <Txt accessibilityRole="header" size={fontSize.heading} weight="bold" style={styles.flex}>
          আজকের ক্যাশ
        </Txt>
        <Pressable accessibilityRole="button" accessibilityLabel="হিসাব শুনুন" onPress={readScreen} style={styles.listen}>
          <Icon name="speaker" size={26} color={colors.onColor} strokeWidth={2} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.card}>
          {rows.map((r, k) => {
            const l = ROW_LOOK[r.key]!;
            return (
              <Pressable
                key={r.key}
                accessibilityRole="button"
                accessibilityLabel={`${r.label} ${formatTaka(r.poisha)}`}
                onPress={() => void speak(`${r.label} ${formatTaka(r.poisha).replace('৳ ', '')} টাকা।`)}
                style={[styles.hisabRow, k < rows.length - 1 && styles.divider]}
              >
                <View style={[styles.sign, { backgroundColor: r.key === 'opening' ? colors.dark : r.sign > 0 ? colors.sale : colors.baki }]}>
                  <Icon name={r.sign > 0 ? 'plus' : 'minus'} size={20} color={colors.onColor} strokeWidth={3} />
                </View>
                <View style={[styles.tile, { backgroundColor: l.tile }]}>
                  <Icon name={l.icon} size={26} color={l.ink} strokeWidth={1.8} />
                </View>
                <Txt size={fontSize.body} weight="semibold" style={styles.flex}>
                  {r.label}
                </Txt>
                <Txt size={fontSize.button} weight="bold" color={l.ink}>
                  {formatTaka(r.poisha)}
                </Txt>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.expected}>
          <View style={[styles.sign, { backgroundColor: colors.surface }]}>
            <Icon name="equals" size={20} color={colors.dark} strokeWidth={3} />
          </View>
          <Txt size={fontSize.body} weight="semibold" color={colors.onDarkMuted} style={styles.flex}>
            হাতে থাকার কথা
          </Txt>
          <Txt size={fontSize.amount} weight="bold" color={colors.onColor}>
            {day ? formatTaka(day.expectedPoisha) : '…'}
          </Txt>
        </View>

        {day?.close && gap && (
          <View style={[styles.closed, gap.kind !== 'ok' && styles.closedGap]}>
            <Icon name="check" size={24} color={gap.kind === 'ok' ? colors.saleDark : colors.bakiInk} strokeWidth={2.6} />
            <Txt wrap size={fontSize.body} weight="bold" color={gap.kind === 'ok' ? colors.saleDark : colors.bakiInk} style={styles.flex}>
              {`দিন শেষ: গুনে পেলাম ${formatTaka(day.close.counted_cash_poisha)} · ${gap.text}`}
            </Txt>
          </View>
        )}
        {day?.closedOnTwoPhones && (
          <View style={[styles.closed, styles.closedGap]}>
            <Icon name="alert" size={24} color={colors.bakiInk} strokeWidth={2.6} />
            <Txt wrap size={fontSize.body} weight="bold" color={colors.bakiInk} style={styles.flex}>
              দুইটা ফোন থেকে দিন শেষ করা হয়েছে। শেষেরটা দেখানো হচ্ছে।
            </Txt>
          </View>
        )}

        <View style={styles.card}>
          <Txt size={fontSize.body} weight="bold" color={colors.bakiInk} style={styles.cardTitle}>
            আজকের খরচ
          </Txt>
          {!outs.length && (
            <Txt size={fontSize.body} weight="medium" color={colors.muted} style={styles.cardTitle}>
              এখনো কোনো খরচ নেই।
            </Txt>
          )}
          {outs.map((i) => {
            const line = historyLine(i);
            const what = i.kind === 'purchase' ? `মাল কেনা: ${i.title}` : i.kind === 'owner_withdrawal' ? `মালিক নিল: ${i.title}` : i.title;
            return (
              <Pressable
                key={`${i.table}-${i.id}`}
                accessibilityRole="button"
                accessibilityLabel={`${line.words} শুনুন`}
                onPress={() => void speak(line.words)}
                style={styles.outRow}
              >
                <Txt size={fontSize.body} weight="medium" style={styles.flex}>
                  {what}
                </Txt>
                <Txt size={fontSize.body} weight="bold">
                  {formatTaka(i.amount_poisha)}
                </Txt>
                {i.audio_path ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${what}, রেকর্ড শুনুন`}
                    onPress={() => clip.toggle(i.audio_path)}
                    style={styles.play}
                  >
                    <Icon name={clip.icon(i.audio_path)} size={20} color={colors.sale} />
                  </Pressable>
                ) : (
                  // no clip (typed, Android < 13, or past 30 days): ▶️ hidden, the row keeps its shape
                  <View style={[styles.play, styles.noClip]} />
                )}
              </Pressable>
            );
          })}
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={() => go(() => nav.push('/history'))}
          style={({ pressed }) => [styles.historyLink, pressed && styles.pressed]}
        >
          <Icon name="list" size={26} color={colors.stock} />
          <Txt size={fontSize.label} weight="bold" color={colors.stock} style={styles.flex}>
            আজকের খাতা
          </Txt>
          <Icon name="forward" size={24} color={colors.stock} strokeWidth={2.4} />
        </Pressable>
      </ScrollView>

      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          onPress={() => go(() => openVoice('expense'))}
          style={({ pressed }) => [styles.action, { backgroundColor: colors.baki }, pressed && styles.pressed]}
        >
          <Icon name="mic" size={30} color={colors.onColor} />
          <Txt size={fontSize.bodyLg} weight="bold" color={colors.onColor}>
            খরচ বলুন
          </Txt>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => go(() => nav.push('/cash-count'))}
          style={({ pressed }) => [styles.action, { backgroundColor: colors.sale }, pressed && styles.pressed]}
        >
          <Icon name="check" size={30} color={colors.onColor} strokeWidth={2.4} />
          <Txt size={fontSize.bodyLg} weight="bold" color={colors.onColor}>
            গুনে মিলান
          </Txt>
        </Pressable>
      </View>
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
  card: { backgroundColor: colors.surface, borderRadius: radius.section, paddingVertical: 6, paddingHorizontal: spacing.lg },
  cardTitle: { paddingTop: spacing.xs, paddingBottom: 4 },
  hisabRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, minHeight: size.iconButton },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.dividerSoft },
  sign: { width: 36, height: 36, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  tile: { width: 44, height: 44, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  expected: {
    backgroundColor: colors.dark,
    borderRadius: radius.section,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.screen,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  closed: { backgroundColor: colors.saleTint, borderRadius: radius.card, padding: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  closedGap: { backgroundColor: colors.bakiTint },
  outRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: size.iconButton },
  play: { width: size.iconButton, height: size.iconButton, borderRadius: radius.pill, backgroundColor: colors.saleTint, alignItems: 'center', justifyContent: 'center' },
  historyLink: {
    height: 64,
    borderRadius: radius.button,
    backgroundColor: colors.stockTint,
    paddingHorizontal: spacing.screen,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  actions: { flexDirection: 'row', gap: spacing.sm },
  action: { flex: 1, height: size.bigAction, borderRadius: radius.button, alignItems: 'center', justifyContent: 'center', gap: 2 },
  disabled: { opacity: 0.35 },
  noClip: { opacity: 0 },
  pressed: { opacity: 0.85 },
});
