import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { ConfirmSheet } from '../components/ConfirmSheet';
import { Icon } from '../components/Icon';
import { NumberPadSheet } from '../components/NumberPadSheet';
import { Txt } from '../components/Txt';
import { cashDay, saveDayClose, type CashDay } from '../db/repo';
import { NOTES, closeReadback, countedPoisha, gapOf, stepNote, today, type Note, type NoteCounts } from '../domain/cash';
import { writer } from '../device';
import { formatNumber, formatTaka, toBnDigits } from '../lib/bn';
import { speak, stopSpeaking } from '../lib/speak';
import { colors, fontSize, noteChips, radius, size, spacing } from '../theme/tokens';

const CHIP = new Map(noteChips.map(([face, bg, edge]) => [face, { bg, edge }]));
const say = (poisha: number) => toBnDigits(Math.round(poisha) / 100);

/**
 * নোট গুনুন (CashCount.dc.html): ৳১০০০ → ৳১০ rows with − count + (tap the count to type
 * it), থাকার কথা vs গুনে পেলাম, the gap, and দিন শেষ করুন (confirm + TTS) → a day_close
 * entry; the counted cash is tomorrow's opening. Opens from the Cash screen's গুনে মিলান.
 */
export default function CashCountScreen() {
  const db = useSQLiteContext();
  const [day, setDay] = useState<CashDay | null>(null);
  const [counts, setCounts] = useState<NoteCounts>({});
  const [typing, setTyping] = useState<Note | null>(null);
  const [asking, setAsking] = useState(false);
  const [saving, setSaving] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void (async () => {
        const d = await cashDay(db, today());
        if (!alive) return;
        setDay(d);
        // counted again the same day: start from the last count
        if (d.close?.note_counts_json) setCounts(JSON.parse(d.close.note_counts_json) as NoteCounts);
      })();
      return () => {
        alive = false;
        stopSpeaking();
      };
    }, [db]),
  );

  const counted = countedPoisha(counts);
  const expected = day?.expectedPoisha ?? 0;
  const gap = gapOf(counted, expected);
  const anyCounted = Object.keys(counts).length > 0;

  const step = (face: Note, dir: 1 | -1) => {
    const next = stepNote(counts, face, dir);
    setCounts(next);
    void speak(`${toBnDigits(face)} টাকার নোট ${toBnDigits(next[face] ?? 0)}টা`);
  };
  const readScreen = () =>
    void speak(
      `নোট গুনুন। থাকার কথা ${say(expected)} টাকা। গুনে পেলাম ${say(counted)} টাকা। ` +
        (anyCounted ? gap.words : 'প্রতিটা নোটের পাশে যোগ চাপুন, বা সংখ্যায় চেপে লিখুন।') +
        ' শেষে দিন শেষ করুন চাপুন।',
    );

  async function close() {
    if (!day || saving) return;
    setSaving(true);
    try {
      await saveDayClose(db, writer(), day, counts, counted);
      setAsking(false);
      await speak(`দিন শেষ হয়েছে। কাল শুরুর ক্যাশ ${say(counted)} টাকা।`);
      router.back();
    } catch (e) {
      setSaving(false);
      void speak('রাখা গেল না।');
      console.warn('saveDayClose failed', e);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.top}>
        <Pressable accessibilityRole="button" accessibilityLabel="ফিরে যান" onPress={() => router.back()} style={styles.square}>
          <Icon name="back" size={26} color={colors.ink} strokeWidth={2.2} />
        </Pressable>
        <Txt accessibilityRole="header" size={fontSize.heading} weight="bold" style={styles.flex}>
          নোট গুনুন
        </Txt>
        <Pressable accessibilityRole="button" accessibilityLabel="শুনুন" onPress={readScreen} style={styles.listen}>
          <Icon name="speaker" size={26} color={colors.onColor} strokeWidth={2} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.card}>
          {NOTES.map((face) => {
            const c = CHIP.get(face)!;
            const n = counts[face] ?? 0;
            return (
              <View key={face} style={styles.noteRow}>
                <View style={[styles.note, { backgroundColor: c.bg, borderColor: c.edge }]}>
                  <Txt size={fontSize.label} weight="bold">
                    {toBnDigits(face)}
                  </Txt>
                </View>
                <Pressable accessibilityRole="button" accessibilityLabel={`${toBnDigits(face)} টাকার নোট কমান`} onPress={() => step(face, -1)} style={styles.step}>
                  <Icon name="minus" size={22} color={colors.ink} strokeWidth={2.6} />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${toBnDigits(face)} টাকার নোট ${toBnDigits(n)}টা, চেপে লিখুন`}
                  onPress={() => setTyping(face)}
                  style={styles.count}
                >
                  <Txt size={fontSize.listAmount} weight="bold" color={n ? colors.ink : colors.muted}>
                    {toBnDigits(n)}
                  </Txt>
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel={`${toBnDigits(face)} টাকার নোট বাড়ান`} onPress={() => step(face, 1)} style={styles.step}>
                  <Icon name="plus" size={22} color={colors.ink} strokeWidth={2.6} />
                </Pressable>
                <Txt size={fontSize.bodyLg} weight="bold" style={styles.total}>
                  {formatTaka(face * 100 * n)}
                </Txt>
              </View>
            );
          })}
        </View>

        <View style={styles.tiles}>
          <View style={[styles.tile, { backgroundColor: colors.surface }]}>
            <Txt size={fontSize.captionLg} weight="medium" color={colors.muted}>
              থাকার কথা
            </Txt>
            <Txt size={fontSize.heading} weight="bold">
              {day ? formatTaka(expected) : '…'}
            </Txt>
          </View>
          <View style={[styles.tile, { backgroundColor: colors.dark }]}>
            <Txt size={fontSize.captionLg} weight="medium" color={colors.onDarkMuted}>
              গুনে পেলাম
            </Txt>
            <Txt size={fontSize.heading} weight="bold" color={colors.onColor}>
              {formatTaka(counted)}
            </Txt>
          </View>
        </View>

        {anyCounted && (
          <View accessibilityRole="text" style={[styles.status, gap.kind === 'ok' ? styles.statusOk : styles.statusGap]}>
            <View style={[styles.statusSign, { backgroundColor: gap.kind === 'ok' ? colors.sale : colors.baki }]}>
              <Icon name={gap.kind === 'ok' ? 'check' : gap.kind === 'short' ? 'minus' : 'plus'} size={20} color={colors.onColor} strokeWidth={3} />
            </View>
            <Txt size={fontSize.button} weight="bold" color={gap.kind === 'ok' ? colors.saleDark : colors.bakiInk}>
              {gap.text}
            </Txt>
          </View>
        )}
      </ScrollView>

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !day || !anyCounted }}
        onPress={() => (anyCounted ? setAsking(true) : void speak('আগে নোট গুনুন।'))}
        style={({ pressed }) => [styles.done, (!day || !anyCounted) && styles.off, pressed && styles.pressed]}
      >
        <Icon name="check" size={30} color={colors.onColor} strokeWidth={2.6} />
        <Txt size={fontSize.button} weight="bold" color={colors.onColor}>
          দিন শেষ করুন
        </Txt>
      </Pressable>

      <NumberPadSheet
        visible={typing !== null}
        title={typing ? `${toBnDigits(typing)} টাকার নোট কয়টা?` : ''}
        prefix="×"
        maxDigits={4}
        initial={typing ? counts[typing] ?? null : null}
        onClose={() => setTyping(null)}
        onDone={(v) => {
          if (typing) {
            const n = Math.max(0, Math.round(v ?? 0));
            const next = { ...counts };
            if (n) next[typing] = n;
            else delete next[typing];
            setCounts(next);
            void speak(`${toBnDigits(typing)} টাকার নোট ${formatNumber(n, 0)}টা`);
          }
          setTyping(null);
        }}
      />
      <ConfirmSheet visible={asking} text={closeReadback(counted, expected)} busy={saving} onYes={() => void close()} onNo={() => setAsking(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: spacing.screen, paddingTop: spacing.screenTop, paddingBottom: spacing.screen, gap: spacing.sm },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
  square: { width: size.iconButton, height: size.iconButton, borderRadius: radius.icon, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  listen: { width: size.iconButton, height: size.iconButton, borderRadius: radius.pill, backgroundColor: colors.dark, alignItems: 'center', justifyContent: 'center' },
  body: { gap: spacing.sm, paddingBottom: spacing.sm },
  card: { backgroundColor: colors.surface, borderRadius: radius.section, paddingVertical: 6, paddingHorizontal: spacing.md },
  noteRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: 4 },
  note: { width: 76, height: size.iconButton, borderRadius: radius.note, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  step: {
    width: size.iconButton,
    height: size.iconButton,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  count: { width: 48, height: size.iconButton, alignItems: 'center', justifyContent: 'center' },
  total: { flex: 1, textAlign: 'right' },
  tiles: { flexDirection: 'row', gap: spacing.sm },
  tile: { flex: 1, borderRadius: radius.card, paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
  status: { borderRadius: radius.card, paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  statusOk: { backgroundColor: colors.saleTint },
  statusGap: { backgroundColor: colors.bakiTint },
  statusSign: { width: 36, height: 36, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  done: { height: 76, borderRadius: radius.button, backgroundColor: colors.sale, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  off: { opacity: 0.55 },
  pressed: { opacity: 0.85 },
});
