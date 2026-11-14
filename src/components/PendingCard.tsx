import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { File } from 'expo-file-system';
import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { discardPending, pendingItems, type PendingItem } from '../queue/understand';
import { writer } from '../device';
import { whenBn } from '../drive/words';
import { formatNumber } from '../lib/bn';
import { nav } from '../lib/nav';
import { speak } from '../lib/speak';
import { bumpQueue, useQueueVersion } from '../lib/understand';
import { useClipPlayer } from '../lib/useClipPlayer';
import { colors, fontSize, radius, spacing } from '../theme/tokens';
import { ConfirmSheet } from './ConfirmSheet';
import { Icon } from './Icon';
import { Txt } from './Txt';

export const waitingText = (n: number) => `${formatNumber(n)}টা কথা অপেক্ষায় · ইন্টারনেট এলে বুঝে নেব`;
export const readyText = (n: number) => `${formatNumber(n)}টা হিসাব মিলিয়ে নিন`;

/**
 * Home: what was said while Gemini couldn't answer. "৩টা কথা অপেক্ষায়" with each clip (▶️, ✕ to
 * throw it away), and the answers ready for হ্যাঁ/না ("২টা হিসাব মিলিয়ে নিন" → review).
 */
export function PendingCard() {
  const db = useSQLiteContext();
  const play = useClipPlayer();
  const version = useQueueVersion();
  const [items, setItems] = useState<PendingItem[]>([]);
  const [discard, setDiscard] = useState<PendingItem | null>(null);
  const spokenReady = useRef<number | null>(null);

  const load = useCallback(async () => setItems(await pendingItems(db)), [db]);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load, version]),
  );

  const waiting = items.filter((i) => i.state === 'waiting');
  const unclear = items.filter((i) => i.state === 'unclear');
  const ready = items.filter((i) => i.state === 'ready');

  // Gemini finished some while the home screen is up: say how many wait for a check
  useEffect(() => {
    const was = spokenReady.current;
    spokenReady.current = ready.length;
    if (was !== null && ready.length > was) void speak(`${readyText(ready.length)}।`);
  }, [ready.length]);

  const yes = async () => {
    if (!discard) return;
    const clip = await discardPending(db, writer(), discard.id);
    setDiscard(null);
    try {
      if (clip) {
        const f = new File(clip);
        if (f.exists) f.delete();
      }
    } catch {
      // the row is gone; a stray file is harmless
    }
    bumpQueue();
    void load();
  };

  if (!items.length) return null;
  const listed = [...waiting, ...unclear];

  return (
    <View style={styles.wrap}>
      {ready.length > 0 && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${readyText(ready.length)}`}
          onPress={() => nav.push('/review')}
          style={({ pressed }) => [styles.ready, pressed && styles.pressed]}
        >
          <Icon name="check" size={30} color={colors.onColor} strokeWidth={2.6} />
          <Txt size={fontSize.label} weight="bold" color={colors.onColor} style={styles.flex}>
            {readyText(ready.length)}
          </Txt>
          <Icon name="arrow" size={26} color={colors.onColor} />
        </Pressable>
      )}
      {listed.length > 0 && (
        <View style={styles.card}>
          {waiting.length > 0 && (
            <Pressable accessibilityRole="button" onPress={() => void speak(`${waitingText(waiting.length)}।`)} style={styles.head}>
              <Icon name="alert" size={22} color={colors.bakiInk} strokeWidth={2.6} />
              <Txt wrap size={fontSize.body} weight="bold" color={colors.bakiInk} style={styles.flex}>
                {waitingText(waiting.length)}
              </Txt>
            </Pressable>
          )}
          {listed.map((i) => (
            <View key={i.id} style={styles.row}>
              {i.clip ? (
                <Pressable accessibilityRole="button" accessibilityLabel="রেকর্ড শুনুন" onPress={() => play(i.clip)} style={styles.play}>
                  <Icon name="play" size={22} color={colors.sale} />
                </Pressable>
              ) : (
                <View style={[styles.play, styles.noClip]} />
              )}
              <View style={styles.flex}>
                <Txt size={fontSize.bodyLg} weight="bold">
                  {whenBn(i.queuedAt)}
                </Txt>
                <Txt size={fontSize.caption} weight="medium" color={i.state === 'unclear' ? colors.bakiInk : colors.muted}>
                  {i.state === 'unclear' ? 'বুঝতে পারিনি' : 'অপেক্ষায়'}
                </Txt>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="বাদ দিন" onPress={() => setDiscard(i)} style={styles.discard}>
                <Icon name="close" size={22} color={colors.bakiInk} strokeWidth={2.4} />
              </Pressable>
            </View>
          ))}
        </View>
      )}
      <ConfirmSheet visible={!!discard} text="এই কথাটা বাদ দেবেন? রেকর্ডও মুছে যাবে।" onYes={() => void yes()} onNo={() => setDiscard(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  flex: { flex: 1 },
  ready: {
    minHeight: 72,
    borderRadius: radius.card,
    backgroundColor: colors.sale,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  card: { backgroundColor: colors.bakiTint, borderRadius: radius.card, borderWidth: 2, borderColor: colors.bakiBorder, padding: spacing.md, gap: spacing.xs },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 56 },
  play: { width: 52, height: 52, borderRadius: radius.pill, backgroundColor: colors.saleTint, alignItems: 'center', justifyContent: 'center' },
  noClip: { opacity: 0 },
  discard: { width: 52, height: 52, borderRadius: radius.pill, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.85 },
});
