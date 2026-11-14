import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import {
  KIND_BN,
  setBuyPrice,
  setEntryAmount,
  setEntryItem,
  setEntryPerson,
  setSellPrice,
  stepPurchase,
  withEntryCustomer,
  withKind,
  type EntryDraft,
} from '../domain/entry';
import { UNIT_BN, UNIT_BN_LOC, formatQty, formatTaka } from '../lib/bn';
import { colors, fonts, fontSize, productTiles, radius, size, spacing } from '../theme/tokens';
import { CustomerPicker } from './CustomerPicker';
import { Icon, productIcon, type IconName } from './Icon';
import { NumberPadSheet } from './NumberPadSheet';
import { Txt } from './Txt';

interface Props {
  entry: EntryDraft;
  known: readonly string[];
  onChange: (next: EntryDraft) => void;
  /** ✏️ the purchase's product name: type or say another (a new product too). */
  onRenameProduct?: () => void;
}

type PadFor = 'amount' | 'buy' | 'sell' | null;

const toTaka = (p: number | null | undefined) => (p === null || p === undefined ? null : p / 100);

const KIND_LOOK: Record<string, { icon: IconName; ink: string; tint: string }> = {
  baki: { icon: 'book', ink: colors.bakiInk, tint: colors.bakiTint },
  joma: { icon: 'cash', ink: colors.saleDark, tint: colors.saleTint },
  expense: { icon: 'cash', ink: colors.bakiInk, tint: colors.bakiTint },
  owner_withdrawal: { icon: 'cash', ink: colors.stock, tint: colors.stockTint },
  purchase: { icon: 'box', ink: colors.stock, tint: colors.stockTint },
};

/** The confirm card body for বাকি / জমা / খরচ / মালিক নিল / মাল কেনা. Numbers are typed on the big pad. */
export function EntryForm({ entry, known, onChange, onRenameProduct }: Props) {
  const [pad, setPad] = useState<PadFor>(null);
  const ledger = entry.kind === null || entry.kind === 'baki' || entry.kind === 'joma';
  const look = KIND_LOOK[entry.kind ?? 'baki']!;
  const bad = (p: EntryDraft['problems'][number]) => entry.problems.includes(p);
  const l = entry.purchase;
  const unitBn = l ? UNIT_BN[l.unit] : '';

  return (
    <View style={styles.card}>
      {!ledger && (
        <View style={styles.head}>
          <View style={[styles.tile, { backgroundColor: look.tint }]}>
            <Icon name={look.icon} size={30} color={look.ink} />
          </View>
          <Txt size={fontSize.headingLg} weight="bold" color={look.ink}>
            {KIND_BN[entry.kind!]}
          </Txt>
        </View>
      )}

      {ledger && (
        <>
          <View accessibilityRole="radiogroup" accessibilityLabel="বাকি না জমা" style={styles.toggleRow}>
            <KindToggle label="বাকি" icon="book" on={entry.kind === 'baki'} ink={colors.bakiInk} border={colors.baki} tint={colors.bakiTint} onPress={() => onChange(withKind(entry, 'baki'))} />
            <KindToggle label="জমা" icon="cash" on={entry.kind === 'joma'} ink={colors.saleDark} border={colors.sale} tint={colors.saleTint} onPress={() => onChange(withKind(entry, 'joma'))} />
          </View>
          {bad('no_kind') && <Hint text="বাকি না জমা? উপরে বেছে নিন।" />}
          <CustomerPicker
            label={entry.kind === 'joma' ? 'কার জমা?' : 'কার বাকি?'}
            name={entry.customerName}
            ok={entry.customerOk}
            known={known}
            onChange={(n, ok) => onChange(withEntryCustomer(entry, n, ok))}
          />
        </>
      )}

      {entry.kind === 'expense' && (
        <Field label="কিসের খরচ?" value={entry.item} warn={bad('no_item')} placeholder="যেমন: বিদ্যুৎ বিল" onChange={(t) => onChange(setEntryItem(entry, t))} />
      )}
      {entry.kind === 'owner_withdrawal' && (
        <Field label="কে নিল?" value={entry.person} warn={false} placeholder="যেমন: মালিক" onChange={(t) => onChange(setEntryPerson(entry, t))} />
      )}

      {l && (
        <View style={styles.purchase}>
          <View style={styles.head}>
            <View style={[styles.tile, { backgroundColor: (l.productName && productTiles[l.productName]) || colors.neutralTint }]}>
              <Icon name={productIcon(l.productName ?? '')} size={28} color={colors.ink} strokeWidth={1.6} />
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${l.productName ?? 'মালের নাম'}, নাম বদলান`}
              accessibilityState={{ disabled: !onRenameProduct }}
              onPress={onRenameProduct}
              style={styles.nameButton}
            >
              <View style={styles.flex}>
                <Txt size={fontSize.button} weight="bold">
                  {l.productName ?? 'নাম বুঝিনি'}
                </Txt>
                {!l.product && l.productName && (
                  <Txt size={fontSize.caption} weight="bold" color={colors.stock}>
                    নতুন মাল
                  </Txt>
                )}
              </View>
              {onRenameProduct && <Icon name="edit" size={20} color={colors.ink2} strokeWidth={1.8} />}
            </Pressable>
          </View>
          <View style={styles.qtyRow}>
            <Step icon="minus" label="কমান" onPress={() => onChange(stepPurchase(entry, -1))} />
            <View style={[styles.qtyBox, l.unitWarning && styles.warnBox]}>
              <Txt size={fontSize.label} weight="bold" style={styles.center}>
                {l.quantity ? formatQty(l.quantity, l.unit) : `? ${unitBn}`}
              </Txt>
            </View>
            <Step icon="plus" label="বাড়ান" onPress={() => onChange(stepPurchase(entry, 1))} />
          </View>
          {l.unitWarning && l.product && (
            <Hint text={`${l.product.name} সাধারণত ${UNIT_BN_LOC[l.product.unit]} — ঠিক আছে তো?`} />
          )}
          <PriceRow label={`কেনা দাম (প্রতি ${unitBn})`} poisha={l.buyPricePoisha} warn={bad('no_price')} onPress={() => setPad('buy')} />
          <PriceRow label={`বেচা দাম (প্রতি ${unitBn})`} poisha={l.sellPricePoisha} optional onPress={() => setPad('sell')} />
        </View>
      )}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={entry.amountPoisha === null ? 'টাকা চেপে দিন' : `${formatTaka(entry.amountPoisha)}, বদলান`}
        onPress={() => setPad('amount')}
        style={[styles.amount, bad('no_amount') && styles.warnBox]}
      >
        <Txt size={fontSize.body} weight="semibold" color={colors.muted}>
          {l ? 'মোট' : 'টাকা'}
        </Txt>
        <Txt size={fontSize.hero} weight="bold" color={entry.amountPoisha === null ? colors.muted : colors.sale} style={styles.flex}>
          {entry.amountPoisha === null ? '৳ ?' : formatTaka(entry.amountPoisha)}
        </Txt>
        <Icon name="keypad" size={26} color={colors.ink2} />
      </Pressable>

      <NumberPadSheet
        visible={pad !== null}
        title={pad === 'buy' ? `কেনা দাম, প্রতি ${unitBn}` : pad === 'sell' ? `বেচা দাম, প্রতি ${unitBn}` : 'কত টাকা?'}
        prefix="৳"
        initial={toTaka(pad === 'buy' ? l?.buyPricePoisha : pad === 'sell' ? l?.sellPricePoisha : entry.amountPoisha)}
        onClose={() => setPad(null)}
        onDone={(v) => {
          const p = v === null ? null : Math.round(v * 100);
          if (pad === 'buy' && p !== null) onChange(setBuyPrice(entry, p));
          else if (pad === 'sell') onChange(setSellPrice(entry, p || null));
          else if (pad === 'amount') onChange(setEntryAmount(entry, p));
          setPad(null);
        }}
      />
    </View>
  );
}

function KindToggle(props: { label: string; icon: IconName; on: boolean; ink: string; border: string; tint: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: props.on }}
      onPress={props.onPress}
      style={[styles.toggle, props.on ? { borderColor: props.border, backgroundColor: props.tint } : null]}
    >
      <Icon name={props.icon} size={28} color={props.ink} />
      <Txt size={fontSize.label} weight="bold" color={props.ink}>
        {props.label}
      </Txt>
    </Pressable>
  );
}

function Field(props: { label: string; value: string | null; warn: boolean; placeholder: string; onChange: (t: string) => void }) {
  const [text, setText] = useState(props.value ?? '');
  return (
    <View style={styles.fieldRow}>
      <Txt size={fontSize.label} weight="bold">
        {props.label}
      </Txt>
      <TextInput
        value={text}
        onChangeText={(t) => {
          setText(t);
          props.onChange(t);
        }}
        accessibilityLabel={props.label}
        placeholder={props.placeholder}
        placeholderTextColor={colors.muted}
        style={[styles.input, props.warn && styles.warnBox]}
      />
    </View>
  );
}

function PriceRow(props: { label: string; poisha: number | null; warn?: boolean; optional?: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={props.label} onPress={props.onPress} style={[styles.priceRow, props.warn && styles.warnBox]}>
      <Txt size={fontSize.body} weight="semibold" color={colors.ink2} style={styles.flex}>
        {props.label}
      </Txt>
      <Txt size={fontSize.listAmount} weight="bold" color={props.poisha === null ? colors.muted : colors.ink}>
        {props.poisha === null ? (props.optional ? '—' : '৳ ?') : formatTaka(props.poisha)}
      </Txt>
    </Pressable>
  );
}

function Step({ icon, label, onPress }: { icon: 'plus' | 'minus'; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.step, pressed && { opacity: 0.85 }]}>
      <Icon name={icon} size={24} color={colors.ink} strokeWidth={2.6} />
    </Pressable>
  );
}

function Hint({ text }: { text: string }) {
  return (
    <Txt wrap size={fontSize.captionLg} weight="bold" color={colors.bakiInk}>
      {text}
    </Txt>
  );
}

const styles = StyleSheet.create({
  nameButton: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 },
  card: { backgroundColor: colors.surface, borderRadius: radius.section, padding: spacing.lg, gap: spacing.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  tile: { width: size.listTile, height: size.listTile, borderRadius: radius.icon, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  center: { textAlign: 'center' },
  toggleRow: { flexDirection: 'row', gap: spacing.sm },
  toggle: {
    flex: 1,
    height: size.bigAction,
    borderRadius: radius.button,
    borderWidth: 3,
    borderColor: colors.divider,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  fieldRow: { gap: spacing.xs },
  input: {
    height: 56,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: radius.icon,
    paddingHorizontal: spacing.lg,
    paddingVertical: 0,
    fontFamily: fonts.bold,
    fontSize: fontSize.label,
    color: colors.ink,
  },
  purchase: { gap: spacing.sm },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  qtyBox: { flex: 1, height: size.stepper, borderRadius: radius.icon, backgroundColor: colors.bg, justifyContent: 'center', borderWidth: 2, borderColor: 'transparent' },
  step: {
    width: size.stepper,
    height: size.stepper,
    borderRadius: radius.icon,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  priceRow: {
    minHeight: 60,
    borderRadius: radius.icon,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  amount: {
    borderRadius: radius.card,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  warnBox: { borderColor: colors.baki, backgroundColor: colors.bakiTint },
});
