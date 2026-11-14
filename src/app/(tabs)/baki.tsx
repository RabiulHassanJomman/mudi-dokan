import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { Avatar } from '../../components/Avatar';
import { Icon } from '../../components/Icon';
import { ScreenHeader } from '../../components/ScreenHeader';
import { Txt } from '../../components/Txt';
import { customerBalances, type CustomerBalance } from '../../db/repo';
import { balanceWords as words } from '../../domain/customers';
import { formatNumber, formatTaka } from '../../lib/bn';
import { speak } from '../../lib/speak';
import { colors, fontSize, radius, size, spacing } from '../../theme/tokens';
import { nav } from '../../lib/nav';

const balanceWords = (c: CustomerBalance) => words(c.name, c.balance_poisha);

/**
 * বাকি খাতা (Baki.dc.html): who owes what, most first; total পাবো; tap a name for
 * their হিসাব; "বাকি / জমা বলুন". মহাজন stays hidden until Phase 3.
 */
export default function BakiScreen() {
  const db = useSQLiteContext();
  const [list, setList] = useState<CustomerBalance[]>([]);

  useFocusEffect(
    useCallback(() => {
      void (async () => setList(await customerBalances(db)))();
    }, [db]),
  );

  const total = list.reduce((t, c) => t + Math.max(0, c.balance_poisha), 0);
  const owing = list.filter((c) => c.balance_poisha > 0);

  const readScreen = () =>
    void speak(
      `বাকি খাতা। মোট পাবো ${formatNumber(total / 100)} টাকা। ` +
        (owing.length ? owing.slice(0, 5).map(balanceWords).join(' ') : 'কারো কাছে বাকি নেই।') +
        ' নামে চাপলে শুনবেন আর হিসাব খুলবে। বাকি বা জমা বলতে নিচের বোতাম চাপুন।',
    );

  return (
    <SafeAreaView edges={['top']} style={styles.screen}>
      <ScreenHeader title="বাকি" onListen={readScreen} />
      <View style={styles.totalCard}>
        <Icon name="book" size={36} color={colors.onColor} />
        <Txt size={fontSize.body} weight="semibold" color={colors.onColor} style={styles.flex}>
          মোট পাবো
        </Txt>
        <Txt size={32} weight="bold" color={colors.onColor}>
          {formatTaka(total)}
        </Txt>
      </View>

      <FlatList
        data={list}
        keyExtractor={(c) => c.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Txt wrap size={fontSize.body} weight="medium" color={colors.muted} style={styles.center}>
            এখনো কোনো ক্রেতা নেই। নিচের বোতাম চেপে বলুন, যেমন “করিম ২০০ টাকা বাকি”।
          </Txt>
        }
        renderItem={({ item: c }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${c.name}, ${formatTaka(c.balance_poisha)}, হিসাব দেখুন`}
            onPress={() => {
              // tap = hear it, and open their হিসাব
              void speak(balanceWords(c));
              nav.push({ pathname: '/customer/[id]', params: { id: c.id } });
            }}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <Avatar name={c.name} />
            <View style={styles.flex}>
              <Txt size={21} weight="bold">
                {c.name}
              </Txt>
              <Txt size={fontSize.listAmount} weight="bold" color={c.balance_poisha > 0 ? colors.bakiInk : c.balance_poisha < 0 ? colors.saleDark : colors.muted}>
                {c.balance_poisha < 0 ? `অগ্রিম ${formatTaka(-c.balance_poisha)}` : formatTaka(c.balance_poisha)}
              </Txt>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${c.name} এর হিসাব শুনুন`}
              onPress={() => void speak(balanceWords(c))}
              style={styles.play}
            >
              <Icon name="speaker" size={24} color={colors.sale} strokeWidth={2} />
            </Pressable>
          </Pressable>
        )}
      />

      <View style={styles.bottom}>
        <Pressable
          accessibilityRole="button"
          onPress={() => nav.push({ pathname: '/listening', params: { tab: 'ledger' } })}
          style={({ pressed }) => [styles.say, pressed && styles.pressed]}
        >
          <Icon name="mic" size={32} color={colors.onColor} />
          <Txt size={fontSize.button} weight="bold" color={colors.onColor}>
            বাকি / জমা বলুন
          </Txt>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  center: { textAlign: 'center', padding: spacing.lg },
  totalCard: {
    marginHorizontal: spacing.screen,
    marginBottom: spacing.sm,
    backgroundColor: colors.baki,
    borderRadius: radius.card,
    paddingHorizontal: spacing.screen,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  list: { paddingHorizontal: spacing.screen, gap: spacing.sm, paddingBottom: spacing.md },
  row: {
    backgroundColor: colors.surface,
    borderRadius: radius.button,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  play: {
    width: size.listTile,
    height: size.listTile,
    borderRadius: radius.pill,
    backgroundColor: colors.saleTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottom: { paddingHorizontal: spacing.screen, paddingVertical: spacing.sm },
  say: {
    height: 68,
    borderRadius: radius.button,
    backgroundColor: colors.baki,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  pressed: { opacity: 0.85 },
});
