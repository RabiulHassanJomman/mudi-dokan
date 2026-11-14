import { useCallback, useState } from 'react';
import { FlatList, Linking, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { Avatar } from '../../components/Avatar';
import { Icon } from '../../components/Icon';
import { PhoneSheet } from '../../components/PhoneSheet';
import { Txt } from '../../components/Txt';
import { customerHistory, getCustomer, setCustomerPhone, type CustomerBalance, type LedgerLine } from '../../db/repo';
import { writer } from '../../device';
import { balanceWords } from '../../domain/customers';
import { dayLabel, formatNumber, formatTaka, toBnDigits } from '../../lib/bn';
import { speak } from '../../lib/speak';
import { useClipPlayer } from '../../lib/useClipPlayer';
import { colors, fontSize, radius, size, spacing } from '../../theme/tokens';
import { nav } from '../../lib/nav';
import { useDataVersion } from '../../sync/app';

const what = (l: LedgerLine) => (l.kind === 'joma' ? 'জমা দিল' : l.products ?? 'বাকি');

/**
 * ক্রেতার হিসাব (Customer.dc.html): balance, জমা নিন / বাকি দিন (voice, with this
 * customer pre-filled), call, and every বাকি/জমা newest first with its clip.
 */
export default function CustomerScreen() {
  const db = useSQLiteContext();
  /** Rows from another phone came in: reload. */
  const synced = useDataVersion();
  const play = useClipPlayer();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [c, setC] = useState<CustomerBalance | null>(null);
  const [rows, setRows] = useState<LedgerLine[]>([]);
  const [phoneOpen, setPhoneOpen] = useState(false);

  const load = useCallback(async () => {
    setC(await getCustomer(db, id));
    setRows(await customerHistory(db, id));
  }, [db, id]);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load, synced]),
  );

  if (!c) return <SafeAreaView style={styles.screen} />;
  const owed = c.balance_poisha;

  const readScreen = () =>
    void speak(
      `${c.name}।${c.note ? ` ${c.note}।` : ''} ${owed > 0 ? `পাবো ${formatNumber(owed / 100)} টাকা।` : owed < 0 ? `অগ্রিম ${formatNumber(-owed / 100)} টাকা।` : 'কোনো বাকি নেই।'} ` +
        rows
          .slice(0, 3)
          .map((r) => `${dayLabel(r.created_at)}, ${what(r)}, ${formatNumber(r.amount_poisha / 100)} টাকা।`)
          .join(' '),
    );

  const say = (kind: 'joma' | 'baki') =>
    nav.push({ pathname: '/listening', params: { tab: 'ledger', customer: c.name, kind } });

  const call = () => {
    if (c.phone) void Linking.openURL(`tel:${c.phone}`);
    else {
      void speak(`${c.name} এর ফোন নম্বর দিন।`);
      setPhoneOpen(true);
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.top}>
        <Pressable accessibilityRole="button" accessibilityLabel="ফিরে যান" onPress={() => nav.back()} style={styles.back}>
          <Icon name="back" size={26} color={colors.ink} strokeWidth={2.2} />
        </Pressable>
        <View style={styles.flex} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={c.phone ? `${c.name}কে ফোন করুন` : 'ফোন নম্বর দিন'}
          onPress={call}
          onLongPress={() => setPhoneOpen(true)}
          style={[styles.round, { backgroundColor: colors.saleTint }]}
        >
          <Icon name="phone" size={24} color={colors.saleDark} strokeWidth={2} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="হিসাব শুনুন" onPress={readScreen} style={[styles.round, { backgroundColor: colors.dark }]}>
          <Icon name="speaker" size={26} color={colors.onColor} strokeWidth={2} />
        </Pressable>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${balanceWords(c.name, owed)} শুনুন`}
        onPress={() => void speak(balanceWords(c.name, owed))}
        style={({ pressed }) => [styles.hero, pressed && styles.pressed]}
      >
        <Avatar name={c.name} size={72} />
        <View style={styles.flex}>
          <Txt accessibilityRole="header" size={fontSize.headingLg} weight="bold">
            {c.name}
          </Txt>
          {!!c.note && (
            <Txt wrap size={fontSize.caption} weight="medium" color={colors.muted}>
              {c.note}
            </Txt>
          )}
          <Txt size={fontSize.captionLg} weight="medium" color={colors.muted}>
            {owed < 0 ? 'অগ্রিম' : 'পাবো'}
            {c.phone ? ` · ${toBnDigits(c.phone)}` : ''}
          </Txt>
          <Txt size={38} weight="bold" color={owed < 0 ? colors.saleDark : colors.bakiInk}>
            {formatTaka(Math.abs(owed))}
          </Txt>
        </View>
      </Pressable>

      <View style={styles.actions}>
        <Pressable accessibilityRole="button" onPress={() => say('joma')} style={({ pressed }) => [styles.action, { backgroundColor: colors.sale }, pressed && styles.pressed]}>
          <Icon name="cash" size={32} color={colors.onColor} />
          <Txt size={fontSize.label} weight="bold" color={colors.onColor}>
            জমা নিন
          </Txt>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => say('baki')} style={({ pressed }) => [styles.action, { backgroundColor: colors.baki }, pressed && styles.pressed]}>
          <Icon name="book" size={32} color={colors.onColor} />
          <Txt size={fontSize.label} weight="bold" color={colors.onColor}>
            বাকি দিন
          </Txt>
        </Pressable>
      </View>

      <Txt size={fontSize.label} weight="bold" style={styles.h2}>
        হিসাব
      </Txt>
      <FlatList
        data={rows}
        keyExtractor={(r) => r.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Txt size={fontSize.body} weight="medium" color={colors.muted} style={styles.center}>
            এখনো কিছু নেই
          </Txt>
        }
        renderItem={({ item: r }) => {
          const baki = r.kind === 'baki';
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${dayLabel(r.created_at)}, ${what(r)}, ${formatTaka(r.amount_poisha)}, শুনুন`}
              onPress={() => void speak(`${dayLabel(r.created_at)}, ${what(r)}, ${formatNumber(r.amount_poisha / 100)} টাকা।`)}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            >
              <View style={[styles.sign, { backgroundColor: baki ? colors.baki : colors.sale }]}>
                <Icon name={baki ? 'plus' : 'minus'} size={20} color={colors.onColor} strokeWidth={3} />
              </View>
              <View style={styles.flex}>
                <Txt size={fontSize.body} weight="bold" numberOfLines={1}>
                  {what(r)}
                </Txt>
                <Txt size={fontSize.caption} weight="medium" color={colors.muted}>
                  {dayLabel(r.created_at)}
                </Txt>
              </View>
              <Txt size={fontSize.label} weight="bold" color={baki ? colors.bakiInk : colors.saleDark}>
                {formatTaka(r.amount_poisha)}
              </Txt>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${what(r)} শুনুন`}
                accessibilityState={{ disabled: !r.audio_path }}
                onPress={() => (r.audio_path ? play(r.audio_path) : void speak(`${what(r)}, ${formatNumber(r.amount_poisha / 100)} টাকা`))}
                style={[styles.play, !r.audio_path && styles.dim]}
              >
                <Icon name="play" size={20} color={colors.sale} />
              </Pressable>
            </Pressable>
          );
        }}
      />

      <PhoneSheet
        visible={phoneOpen}
        title={`${c.name} এর ফোন নম্বর`}
        initial={c.phone}
        onClose={() => setPhoneOpen(false)}
        onDone={(phone) => {
          setPhoneOpen(false);
          void (async () => {
            await setCustomerPhone(db, writer(), c.id, phone);
            await load();
          })();
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: spacing.screen, paddingTop: spacing.screenTop, gap: spacing.md },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
  center: { textAlign: 'center', padding: spacing.lg },
  back: {
    width: size.iconButton,
    height: size.iconButton,
    borderRadius: radius.icon,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  round: { width: size.iconButton, height: size.iconButton, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  hero: { backgroundColor: colors.surface, borderRadius: radius.hero, padding: spacing.screen, flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  actions: { flexDirection: 'row', gap: spacing.sm },
  action: { flex: 1, height: size.bigAction, borderRadius: radius.button, alignItems: 'center', justifyContent: 'center', gap: 2 },
  h2: { marginHorizontal: 4 },
  list: { gap: spacing.xs, paddingBottom: spacing.xl },
  row: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  sign: { width: 40, height: 40, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  play: { width: 48, height: 48, borderRadius: radius.pill, backgroundColor: colors.saleTint, alignItems: 'center', justifyContent: 'center' },
  dim: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
});
