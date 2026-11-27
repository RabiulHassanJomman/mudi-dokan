import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { Icon, productIcon } from '../../components/Icon';
import { ScreenHeader } from '../../components/ScreenHeader';
import { Txt } from '../../components/Txt';
import { stockList } from '../../db/repo';
import { usePartyDelete } from '../../components/DeleteEntry';
import { stockQtyText, stockScreenWords, stockView, stockWords, type StockView } from '../../domain/stock';
import { formatNumber } from '../../lib/bn';
import { speak, stopSpeaking } from '../../lib/speak';
import { colors, fontSize, productTiles, radius, spacing } from '../../theme/tokens';
import { nav } from '../../lib/nav';
import { openVoice } from '../../lib/voice';
import { useDataVersion } from '../../sync/app';

/**
 * মাল (Stock.dc.html): every product with its stock (kena − becha, never stored) and
 * selling price; low stock = orange border + ! badge. Tap a card = TTS. "নতুন মাল বলুন"
 * opens the বলুন screen on the purchase tab.
 */
export default function StockScreen() {
  const db = useSQLiteContext();
  /** Rows from another phone came in: reload. */
  const synced = useDataVersion();
  const [list, setList] = useState<StockView[]>([]);
  const [reload, setReload] = useState(0);
  const del = usePartyDelete('product', () => setReload((n) => n + 1));

  useFocusEffect(
    useCallback(() => {
      void (async () => setList((await stockList(db)).map(stockView)))();
      return () => stopSpeaking();
    }, [db, synced, reload]),
  );

  return (
    <SafeAreaView edges={['top']} style={styles.screen}>
      <ScreenHeader title="মাল" onListen={() => void speak(stockScreenWords(list))} />
      <FlatList
        data={list}
        keyExtractor={(v) => v.id}
        numColumns={2}
        columnWrapperStyle={styles.cols}
        contentContainerStyle={styles.grid}
        ListEmptyComponent={
          <Txt wrap size={fontSize.body} weight="medium" color={colors.muted} style={styles.empty}>
            এখনো কোনো মাল নেই। নিচের বোতাম চেপে বলুন, যেমন “নতুন চাল ৫০ কেজি কেনা ৫৫ বেচা ৬০”।
          </Txt>
        }
        renderItem={({ item: v }) => <StockCard v={v} onDelete={() => void del.ask(v.id, v.name)} />}
      />
      <View style={styles.bottom}>
        <Pressable
          accessibilityRole="button"
          onPress={() => openVoice('purchase')}
          style={({ pressed }) => [styles.say, pressed && styles.pressed]}
        >
          <Icon name="mic" size={32} color={colors.onColor} />
          <Txt size={fontSize.button} weight="bold" color={colors.onColor}>
            নতুন মাল বলুন
          </Txt>
        </Pressable>
      </View>
      {del.sheet}
    </SafeAreaView>
  );
}

function StockCard({ v, onDelete }: { v: StockView; onDelete: () => void }) {
  const words = stockWords(v);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${words} শুনুন`}
      onPress={() => void speak(words)}
      style={({ pressed }) => [styles.card, v.low && styles.cardLow, pressed && styles.pressed]}
    >
      <Pressable accessibilityRole="button" accessibilityLabel={`${v.name} মুছুন`} onPress={onDelete} style={styles.trash}>
        <Icon name="trash" size={20} color={colors.muted} />
      </Pressable>
      {v.low && (
        <View style={styles.badge}>
          <Icon name="alert" size={18} color={colors.onColor} strokeWidth={2.4} />
        </View>
      )}
      <View style={[styles.tile, { backgroundColor: productTiles[v.name] ?? colors.neutralTint }]}>
        <Icon name={productIcon(v.name)} size={40} color={colors.ink} strokeWidth={1.5} />
      </View>
      <Txt size={fontSize.label} weight="bold">
        {v.name}
      </Txt>
      {v.stock === null && !v.spentPoisha ? (
        <Txt size={fontSize.caption} weight="semibold" color={colors.muted}>
          {stockQtyText(v)}
        </Txt>
      ) : (
        <Txt size={v.stock === null ? fontSize.label : 26} weight="bold" color={v.low ? colors.lowStockQty : colors.ink}>
          {stockQtyText(v)}
        </Txt>
      )}
      {(v.costPricePoisha !== null || v.sellPricePoisha !== null) && (
        <Txt size={fontSize.caption} weight="medium" color={colors.muted}>
          {[
            v.costPricePoisha !== null && `কেনা ${formatNumber(v.costPricePoisha / 100)}`,
            v.sellPricePoisha !== null && `বেচা ${formatNumber(v.sellPricePoisha / 100)}`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Txt>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  grid: { paddingHorizontal: spacing.screen, gap: 10, paddingBottom: spacing.md },
  cols: { justifyContent: 'space-between' },
  empty: { textAlign: 'center', padding: spacing.lg },
  // half the row minus the gap, so a lone last card stays half width
  card: {
    width: '48.6%',
    backgroundColor: colors.surface,
    borderRadius: radius.button,
    borderWidth: 3,
    borderColor: 'transparent',
    padding: 12,
    alignItems: 'center',
    gap: 4,
  },
  cardLow: { borderColor: colors.baki },
  badge: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.baki,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trash: { position: 'absolute', top: 4, left: 4, width: 44, height: 44, alignItems: 'center', justifyContent: 'center', zIndex: 1 },
  tile: { width: 64, height: 64, borderRadius: radius.card, alignItems: 'center', justifyContent: 'center' },
  bottom: { paddingHorizontal: spacing.screen, paddingVertical: 10 },
  say: {
    height: 68,
    borderRadius: radius.button,
    backgroundColor: colors.stock,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  pressed: { opacity: 0.85 },
});
