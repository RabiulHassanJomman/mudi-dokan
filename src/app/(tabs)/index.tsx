import { useCallback, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { Icon, productIcon, type IconName } from '../../components/Icon';
import { ScreenHeader } from '../../components/ScreenHeader';
import { Txt } from '../../components/Txt';
import { buildLabel } from '../../lib/buildInfo';
import { PendingCard } from '../../components/PendingCard';
import { useDeleteEntry } from '../../components/DeleteEntry';
import { TABLE_OF } from '../../db/repo';
import { entryDeleteText } from '../../domain/delete';
import { cashDay, getSetup, recentEntries, todayTotals } from '../../db/repo';
import { today as todayDate } from '../../domain/cash';
import { recentLine, type RecentEntry } from '../../domain/recent';
import { getDevice } from '../../device';
import { dayLabel, formatNumber, formatQty, formatTaka, toBnDigits } from '../../lib/bn';
import { speak } from '../../lib/speak';
import { useClipPlayer } from '../../lib/useClipPlayer';
import { colors, fontSize, productTiles, radius, size, spacing } from '../../theme/tokens';
import { nav } from '../../lib/nav';
import { openVoice } from '../../lib/voice';
import { useDataVersion } from '../../sync/app';

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

const KIND_LABEL: Record<RecentEntry['kind'], string> = {
  sale: 'বিক্রি',
  baki: 'বাকি',
  joma: 'জমা',
  expense: 'খরচ',
  owner_withdrawal: 'মালিক নিল',
  purchase: 'কেনা',
};

/** Label/value rows shown when a recent row is tapped. */
function detailRows(e: RecentEntry): [string, string][] {
  const d = new Date(e.created_at);
  const time = `${toBnDigits(String(d.getHours()).padStart(2, '0'))}:${toBnDigits(String(d.getMinutes()).padStart(2, '0'))}`;
  const rows: [string, string][] = [['ধরন', KIND_LABEL[e.kind]]];
  const nameLabel = e.kind === 'baki' || e.kind === 'joma' ? 'কার' : e.kind === 'owner_withdrawal' ? 'কে' : 'জিনিস';
  rows.push([nameLabel, e.title]);
  if (e.kind === 'sale' && e.lines > 1) rows.push(['কয়টি জিনিস', toBnDigits(e.lines)]);
  if (e.quantity !== null && e.unit) rows.push(['পরিমাণ', formatQty(e.quantity, e.unit)]);
  if (e.kind === 'sale' && e.customer) rows.push(['ক্রেতা', e.customer]);
  rows.push(['টাকা', formatTaka(e.amount_poisha)]);
  if (e.kind === 'sale') rows.push(['কীভাবে', e.credit ? 'বাকিতে' : 'নগদ']);
  rows.push(['সময়', `${dayLabel(e.created_at)}, ${time}`]);
  return rows;
}

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** বিক্রি (home): big mic, today's numbers, last entries. */
export default function SaleScreen() {
  const db = useSQLiteContext();
  /** Rows from another phone came in: reload. */
  const synced = useDataVersion();
  const play = useClipPlayer();
  const [reload, setReload] = useState(0);
  const del = useDeleteEntry(() => setReload((n) => n + 1));
  const [shopName, setShopName] = useState<string | null>(null);
  const [today, setToday] = useState({ sales: 0, baki: 0 });
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  const [detail, setDetail] = useState<RecentEntry | null>(null);
  /** হাতে ক্যাশ = today's expected cash in hand. */
  const [cash, setCash] = useState<number | null>(null);

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        setToday(await todayTotals(db, startOfToday()));
        setCash((await cashDay(db, todayDate())).expectedPoisha);
        setRecent(await recentEntries(db, 3));
        setShopName((await getSetup(db, getDevice().id)).shopName);
      })();
    }, [db, synced, reload]),
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
        onSettings={() => nav.push({ pathname: '/setup', params: { edit: '1' } })}
      />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`হাতে ক্যাশ ${cash !== null ? formatTaka(cash) : ''}, আজকের ক্যাশ দেখুন`}
          onPress={() => nav.push('/cash')}
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
            onPress={() => nav.push({ pathname: '/history', params: { filter: 'sale' } })}
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
            onPress={() => openVoice('sale')}
            style={({ pressed }) => [styles.mic, pressed && { transform: [{ scale: 0.96 }] }]}
          >
            <Icon name="mic" size={84} color={colors.onColor} />
          </Pressable>
          <Txt size={fontSize.prompt} weight="bold">
            চাপুন, বলুন
          </Txt>
          {/* লিখুন = type or choose by picture (Pick) */}
          <Pressable accessibilityRole="button" onPress={() => nav.push('/pick')} style={styles.typeButton}>
            <Icon name="keyboard" size={24} color={colors.ink2} />
            <Txt size={17} weight="semibold" color={colors.ink2}>
              লিখুন
            </Txt>
          </Pressable>
        </View>

        <PendingCard />

        {recent.map((r) => {
          const line = recentLine(r);
          const look = entryLook(r);
          return (
            <Pressable
              key={`${r.kind}-${r.id}`}
              accessibilityRole="button"
              accessibilityLabel={`${line.words} শুনুন`}
              onPress={() => {
                setDetail(r);
                void speak(line.words);
              }}
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
              {r.audio_path ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${line.title}, রেকর্ড শুনুন`}
                  onPress={() => play(r.audio_path)}
                  style={styles.play}
                >
                  <Icon name="play" size={22} color={colors.sale} />
                </Pressable>
              ) : (
                // no clip (typed, or past 90 days): ▶️ hidden, the row keeps its shape
                <View style={[styles.play, styles.noClip]} />
              )}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${line.title}, মুছুন`}
                onPress={() => del.ask({ table: TABLE_OF[r.kind], id: r.id, text: entryDeleteText(r) })}
                style={styles.trash}
              >
                <Icon name="trash" size={22} color={colors.bakiInk} />
              </Pressable>
            </Pressable>
          );
        })}

        {__DEV__ && (
          <Txt size={fontSize.caption} weight="medium" color={colors.muted} style={styles.build}>
            {buildLabel()}
          </Txt>
        )}
      </ScrollView>
      {del.sheet}
      <Modal visible={!!detail} transparent animationType="slide" onRequestClose={() => setDetail(null)}>
        <Pressable style={styles.backdrop} onPress={() => setDetail(null)} accessibilityLabel="বন্ধ করুন">
          <Pressable style={styles.sheet} onPress={() => {}}>
            {detail &&
              detailRows(detail).map(([k, v]) => (
                <View key={k} style={styles.detailRow}>
                  <Txt size={fontSize.bodyLg} weight="medium" color={colors.ink2}>
                    {k}
                  </Txt>
                  <Txt size={fontSize.button} weight="bold" style={styles.detailValue}>
                    {v}
                  </Txt>
                </View>
              ))}
            <View style={styles.sheetButtons}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="আবার শুনুন"
                onPress={() => detail && void speak(recentLine(detail).words)}
                style={[styles.sheetButton, { backgroundColor: colors.saleTint }]}
              >
                <Icon name="play" size={24} color={colors.sale} />
                <Txt size={fontSize.button} weight="bold" color={colors.sale}>
                  শুনুন
                </Txt>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="বন্ধ করুন"
                onPress={() => setDetail(null)}
                style={[styles.sheetButton, { backgroundColor: colors.sale }]}
              >
                <Txt size={fontSize.button} weight="bold" color={colors.onColor}>
                  ঠিক আছে
                </Txt>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
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
  noClip: { opacity: 0 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card, padding: spacing.screen, gap: spacing.sm },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md, minHeight: 44 },
  detailValue: { flexShrink: 1, textAlign: 'right' },
  sheetButtons: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  sheetButton: { flex: 1, height: 56, borderRadius: radius.pill, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
  build: { textAlign: 'center' },
  trash: { width: 44, height: 52, alignItems: 'center', justifyContent: 'center' },
});
