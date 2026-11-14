import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { File } from 'expo-file-system';
import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { ConfirmSheet } from '../components/ConfirmSheet';
import { Icon } from '../components/Icon';
import { Txt } from '../components/Txt';
import { readyText } from '../components/PendingCard';
import { writer } from '../device';
import { whenBn } from '../drive/words';
import { nav } from '../lib/nav';
import { speak, stopSpeaking } from '../lib/speak';
import { bumpQueue, useQueueVersion } from '../lib/understand';
import { useClipPlayer } from '../lib/useClipPlayer';
import { discardPending, pendingItems, type PendingItem } from '../queue/understand';
import { colors, fontSize, radius, size, spacing } from '../theme/tokens';

const TAB_BN: Record<string, string> = { sale: 'বিক্রি', purchase: 'মাল', ledger: 'বাকি', expense: 'খরচ', stock: 'মাল' };

/**
 * অপেক্ষার হিসাব মিলিয়ে নিন: what was said earlier and Gemini has now understood. Each one
 * opens as the confirm card (হ্যাঁ / না / ✏️) with the time it was said; nothing is saved
 * until হ্যাঁ. The count is read aloud when this opens.
 */
export default function ReviewScreen() {
  const db = useSQLiteContext();
  const play = useClipPlayer();
  const version = useQueueVersion();
  const [items, setItems] = useState<PendingItem[]>([]);
  const [discard, setDiscard] = useState<PendingItem | null>(null);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void (async () => {
        const ready = (await pendingItems(db)).filter((i) => i.state === 'ready');
        if (!alive) return;
        setItems(ready);
        if (ready.length) void speak(`${readyText(ready.length)}। প্রতিটা দেখে হ্যাঁ বা না বলুন।`);
        else nav.replace('/');
      })();
      return () => {
        alive = false;
        stopSpeaking();
      };
    }, [db, version]),
  );

  const open = (i: PendingItem) => {
    stopSpeaking();
    nav.push({ pathname: '/confirm', params: { logId: i.id, tab: i.tab, review: '1' } });
  };

  const yes = async () => {
    if (!discard) return;
    const clip = await discardPending(db, writer(), discard.id);
    setDiscard(null);
    try {
      if (clip && new File(clip).exists) new File(clip).delete();
    } catch {
      // harmless
    }
    bumpQueue();
  };

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.top}>
        <Pressable accessibilityRole="button" accessibilityLabel="ফিরে যান" onPress={() => nav.back()} style={styles.square}>
          <Icon name="back" size={26} color={colors.ink} strokeWidth={2.2} />
        </Pressable>
        <Txt accessibilityRole="header" wrap size={fontSize.heading} weight="bold" style={styles.flex}>
          অপেক্ষার হিসাব মিলিয়ে নিন
        </Txt>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="শুনুন"
          onPress={() => void speak(`${readyText(items.length)}।`)}
          style={styles.listen}
        >
          <Icon name="speaker" size={26} color={colors.onColor} strokeWidth={2} />
        </Pressable>
      </View>

      <FlatList
        data={items}
        keyExtractor={(i) => i.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <Pressable accessibilityRole="button" onPress={() => open(item)} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
            {item.clip ? (
              <Pressable accessibilityRole="button" accessibilityLabel="রেকর্ড শুনুন" onPress={() => play(item.clip)} style={styles.play}>
                <Icon name="play" size={22} color={colors.sale} />
              </Pressable>
            ) : (
              <View style={[styles.play, styles.noClip]} />
            )}
            <View style={styles.flex}>
              <Txt wrap size={fontSize.label} weight="bold">
                {item.transcript || 'কথা'}
              </Txt>
              <Txt size={fontSize.caption} weight="medium" color={colors.muted}>
                {whenBn(item.queuedAt)} · {TAB_BN[item.tab] ?? item.tab}
              </Txt>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="বাদ দিন" onPress={() => setDiscard(item)} style={styles.discard}>
              <Icon name="close" size={22} color={colors.bakiInk} strokeWidth={2.4} />
            </Pressable>
          </Pressable>
        )}
      />

      {items.length > 0 && (
        <Pressable accessibilityRole="button" onPress={() => open(items[0]!)} style={({ pressed }) => [styles.go, pressed && styles.pressed]}>
          <Icon name="check" size={30} color={colors.onColor} strokeWidth={2.6} />
          <Txt size={fontSize.listAmount} weight="bold" color={colors.onColor}>
            মিলিয়ে নিন
          </Txt>
        </Pressable>
      )}
      <ConfirmSheet visible={!!discard} text="এই কথাটা বাদ দেবেন? রেকর্ডও মুছে যাবে।" onYes={() => void yes()} onNo={() => setDiscard(null)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: spacing.screen, paddingTop: spacing.screenTop, paddingBottom: 18, gap: spacing.md },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
  square: { width: size.iconButton, height: size.iconButton, borderRadius: radius.icon, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  listen: { width: size.iconButton, height: size.iconButton, borderRadius: radius.pill, backgroundColor: colors.dark, alignItems: 'center', justifyContent: 'center' },
  list: { gap: spacing.sm, paddingBottom: spacing.sm },
  row: { minHeight: 80, backgroundColor: colors.surface, borderRadius: radius.card, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md },
  play: { width: 52, height: 52, borderRadius: radius.pill, backgroundColor: colors.saleTint, alignItems: 'center', justifyContent: 'center' },
  noClip: { opacity: 0 },
  discard: { width: 52, height: 52, borderRadius: radius.pill, backgroundColor: colors.bakiTint, alignItems: 'center', justifyContent: 'center' },
  go: { height: 80, borderRadius: radius.section, backgroundColor: colors.sale, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  pressed: { opacity: 0.85 },
});
