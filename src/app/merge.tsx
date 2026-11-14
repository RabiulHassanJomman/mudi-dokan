import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { ConfirmSheet } from '../components/ConfirmSheet';
import { Icon } from '../components/Icon';
import { Txt } from '../components/Txt';
import { dismissMerge, mergeRecords } from '../db/repo';
import { writer } from '../device';
import { mergeQuestion, type MergeItem, type MergePair } from '../domain/merge';
import { UNIT_BN, formatNumber } from '../lib/bn';
import { nav } from '../lib/nav';
import { speak, stopSpeaking } from '../lib/speak';
import { mergePairs, useDataVersion } from '../sync/app';
import { colors, fontSize, radius, size, spacing } from '../theme/tokens';
import type { Unit } from '../parser/types';

const KIND_BN = { product: 'মাল', customer: 'ক্রেতা' } as const;

/**
 * "এই দুইটা কি একই?" — after two phones' data met (first sync), products/customers that
 * sound the same. হ্যাঁ = merge (the duplicate's entries are re-pointed by corrections, its
 * name becomes an alias; nothing deleted). না = keep both, don't ask again.
 */
export default function MergeScreen() {
  const db = useSQLiteContext();
  const version = useDataVersion();
  const [pairs, setPairs] = useState<MergePair[] | null>(null);
  const [asking, setAsking] = useState<MergePair | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => setPairs(await mergePairs(db)), [db]);

  useFocusEffect(
    useCallback(() => {
      void load();
      return () => stopSpeaking();
    }, [load, version]),
  );

  // ask about the first one right away
  useEffect(() => {
    if (pairs?.length && !asking) setAsking(pairs[0]!);
    if (pairs && !pairs.length) void speak('একই নাম দুইবার আর নেই।');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairs]);

  const answer = async (same: boolean) => {
    if (!asking) return;
    setBusy(true);
    try {
      if (same) {
        await mergeRecords(db, writer(), asking.kind, asking.keep.id, asking.dup.id);
        void speak('এক করা হয়েছে।');
      } else {
        await dismissMerge(db, asking.key);
        void speak('আলাদা রাখা হলো।');
      }
    } catch (e) {
      console.warn('merge failed', e);
      void speak('করা গেল না।');
    } finally {
      setBusy(false);
      setAsking(null);
      await load();
    }
  };

  const readAll = () => {
    if (!pairs?.length) return void speak('একই নাম দুইবার নেই।');
    void speak(`${formatNumber(pairs.length)}টা। ${pairs.map(mergeQuestion).join(' ')}`);
  };

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.top}>
        <Pressable accessibilityRole="button" accessibilityLabel="ফিরে যান" onPress={() => nav.back()} style={styles.square}>
          <Icon name="back" size={26} color={colors.ink} strokeWidth={2.2} />
        </Pressable>
        <Txt accessibilityRole="header" size={fontSize.headingLg} weight="bold" style={styles.flex}>
          এই দুইটা কি একই?
        </Txt>
        <Pressable accessibilityRole="button" accessibilityLabel="শুনুন" onPress={readAll} style={styles.listen}>
          <Icon name="speaker" size={26} color={colors.onColor} strokeWidth={2} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {pairs?.length === 0 && (
          <Txt wrap size={fontSize.label} weight="semibold" color={colors.muted}>
            একই নাম দুইবার নেই। সব ঠিক আছে।
          </Txt>
        )}
        {pairs?.map((p) => (
          <Pressable
            key={p.key}
            accessibilityRole="button"
            accessibilityLabel={mergeQuestion(p)}
            onPress={() => setAsking(p)}
            style={({ pressed }) => [styles.pair, pressed && styles.pressed]}
          >
            <Txt size={fontSize.captionLg} weight="bold" color={colors.muted}>
              {KIND_BN[p.kind]}
            </Txt>
            <View style={styles.sides}>
              <Side item={p.keep} kind={p.kind} />
              <Txt size={fontSize.heading} weight="bold" color={colors.muted}>
                =?
              </Txt>
              <Side item={p.dup} kind={p.kind} />
            </View>
          </Pressable>
        ))}
      </ScrollView>

      {pairs && pairs.length === 0 && (
        <Pressable accessibilityRole="button" onPress={() => nav.back()} style={({ pressed }) => [styles.done, pressed && styles.pressed]}>
          <Icon name="check" size={30} color={colors.onColor} strokeWidth={2.4} />
          <Txt size={fontSize.listAmount} weight="bold" color={colors.onColor}>
            ঠিক আছে
          </Txt>
        </Pressable>
      )}

      <ConfirmSheet
        visible={!!asking}
        busy={busy}
        text={asking ? `${mergeQuestion(asking)} হ্যাঁ বললে এক করা হবে, না বললে আলাদা থাকবে।` : ''}
        onYes={() => void answer(true)}
        onNo={() => void answer(false)}
      />
    </SafeAreaView>
  );
}

function Side({ item, kind }: { item: MergeItem; kind: MergePair['kind'] }) {
  const detail = kind === 'product' ? (item.detail ? UNIT_BN[item.detail as Unit] : null) : item.detail;
  return (
    <View style={styles.side}>
      <Txt size={fontSize.button} weight="bold">
        {item.name}
      </Txt>
      {detail ? (
        <Txt size={fontSize.captionLg} weight="medium" color={colors.muted}>
          {detail}
        </Txt>
      ) : null}
      <Txt size={fontSize.captionLg} weight="medium" color={colors.muted}>
        {`${formatNumber(item.uses)}টা হিসাব`}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: spacing.screen, paddingTop: spacing.screenTop, paddingBottom: 18, gap: spacing.md },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
  square: { width: size.iconButton, height: size.iconButton, borderRadius: radius.icon, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  listen: { width: size.iconButton, height: size.iconButton, borderRadius: radius.pill, backgroundColor: colors.dark, alignItems: 'center', justifyContent: 'center' },
  body: { gap: spacing.md, paddingBottom: spacing.sm },
  pair: { backgroundColor: colors.surface, borderRadius: radius.section, padding: spacing.lg, gap: spacing.xs, borderWidth: 2, borderColor: colors.bakiBorder },
  sides: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  side: { flex: 1, minHeight: 72, borderRadius: radius.card, backgroundColor: colors.neutralTint, padding: spacing.md, gap: 2 },
  done: {
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
