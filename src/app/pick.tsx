import { useCallback, useMemo, useState } from 'react';
import { Keyboard, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { Icon, productIcon } from '../components/Icon';
import { NumberPad } from '../components/NumberPad';
import { Txt } from '../components/Txt';
import { knownNames, pickProducts } from '../db/repo';
import { padDisplay, padPress, padValue, type PadKey } from '../domain/numpad';
import {
  filterProducts,
  halfAllowed,
  pickModeLabel,
  pickText,
  pickUnits,
  type PickMode,
  type PickProduct,
  type PickedItem,
} from '../domain/pick';
import { UNIT_BN, formatNumber } from '../lib/bn';
import { speak, stopSpeaking } from '../lib/speak';
import { parseCommand } from '../parser';
import { colors, fonts, fontSize, productTiles, radius, size, spacing } from '../theme/tokens';

/** A product picked from the grid, or a new name typed in the search box. */
type Chosen = { name: string; product: PickProduct | null };

const HINT = 'ছবি দেখে মাল বেছে নিন। তারপর নম্বর চাপুন, তারপর ঠিক আছে।';

/**
 * ছবি দেখে বেছে নিন / লিখুন (Pick.dc.html): product grid with search, big number pad
 * with ½, unit chips (কেজি / গ্রাম / টাকার…). Opens from "লিখুন" and when voice fails.
 * ঠিক আছে goes to the same confirm card as voice; a whole typed command does too.
 */
export default function PickScreen() {
  const db = useSQLiteContext();
  const [products, setProducts] = useState<PickProduct[]>([]);
  const [names, setNames] = useState<{ products: string[]; customers: string[] }>({ products: [], customers: [] });
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [mode, setMode] = useState<PickMode>('kg');
  const [num, setNum] = useState('');

  // reload on focus: a sale saved from the confirm card can add a product
  useFocusEffect(
    useCallback(() => {
      void (async () => {
        setProducts(await pickProducts(db));
        setNames(await knownNames(db));
      })();
      return () => {
        stopSpeaking();
      };
    }, [db]),
  );

  const shown = useMemo(() => filterProducts(products, query), [products, query]);
  const q = query.trim();
  const offerNew = q.length > 0 && !products.some((p) => p.name === q || p.aliases.includes(q));
  const units = pickUnits(chosen?.product?.unit ?? null);

  const choose = (c: Chosen) => {
    Keyboard.dismiss();
    setChosen(c);
    const next = pickUnits(c.product?.unit ?? null)[0]!;
    setMode(next);
    if (!halfAllowed(next)) setNum((n) => n.replace(/\.5$/, ''));
    const price = c.product?.sellPricePoisha;
    void speak(
      c.product
        ? price
          ? `${c.name}, ${UNIT_BN[c.product.unit]} ${formatNumber(price / 100)} টাকা`
          : c.name
        : `${c.name}, নতুন মাল`,
    );
  };

  const changeMode = (m: PickMode) => {
    setMode(m);
    if (!halfAllowed(m)) setNum((n) => n.replace(/\.5$/, ''));
    void speak(pickModeLabel(m));
  };

  const onKey = (k: PadKey) => setNum((n) => padPress(n, k, { allowHalf: halfAllowed(mode), maxDigits: mode === 'taka' ? 6 : 5 }));

  const value = padValue(num);
  const pick: PickedItem | null = chosen && value ? { product: chosen.name, value, mode } : null;

  const readScreen = useCallback(() => {
    void speak(pick ? `${pickText(pick)}। ঠিক থাকলে ঠিক আছে চাপুন।` : chosen ? `${chosen.name}। এবার নম্বর চাপুন।` : HINT);
  }, [pick, chosen]);

  const done = () => {
    if (!chosen) return void speak('আগে মাল বেছে নিন।');
    if (!value) return void speak('কতটুকু, নম্বর চাপুন।');
    router.replace({ pathname: '/confirm', params: { pick: JSON.stringify(pick), tab: 'sale' } });
  };

  /** Keyboard ✓: a whole command ("চাল ২ কেজি") goes to the confirm card; a name just searches. */
  const submitTyped = () => {
    if (!q) return;
    const p = parseCommand(q, { tab: 'sale', knownProducts: names.products, knownCustomers: names.customers });
    const isCommand = p.intent !== 'sale' || (p.items ?? []).some((i) => i.quantity || i.total !== undefined);
    if (isCommand) router.replace({ pathname: '/confirm', params: { text: q, tab: 'sale' } });
    else if (shown.length === 1) choose({ name: shown[0]!.name, product: shown[0]! });
    else Keyboard.dismiss();
  };

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.top}>
        <Pressable accessibilityRole="button" accessibilityLabel="ফিরে যান" onPress={() => router.back()} style={styles.back}>
          <Icon name="back" size={26} color={colors.ink} strokeWidth={2.2} />
        </Pressable>
        <TextInput
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={submitTyped}
          returnKeyType="done"
          accessibilityLabel="লিখে দিন বা খুঁজুন"
          placeholder="লিখে দিন…"
          placeholderTextColor={colors.muted}
          style={styles.input}
        />
        <Pressable accessibilityRole="button" accessibilityLabel="শুনুন" onPress={readScreen} style={styles.listen}>
          <Icon name="speaker" size={26} color={colors.onColor} strokeWidth={2} />
        </Pressable>
      </View>

      <ScrollView style={styles.gridBox} contentContainerStyle={styles.grid} keyboardShouldPersistTaps="handled">
        {shown.map((p) => (
          <Tile key={p.id} name={p.name} on={chosen?.name === p.name} onPress={() => choose({ name: p.name, product: p })} />
        ))}
        {offerNew && <Tile name={q} isNew on={chosen?.name === q && !chosen.product} onPress={() => choose({ name: q, product: null })} />}
        {!products.length && !q && (
          <Txt wrap size={fontSize.body} weight="medium" color={colors.muted} style={styles.empty}>
            এখনো কোনো মাল নেই। উপরে নাম লিখুন, তারপর বেছে নিন।
          </Txt>
        )}
      </ScrollView>

      <View style={styles.qtyRow}>
        <Txt size={fontSize.amount} weight="bold" color={num ? colors.ink : colors.muted} style={styles.flex}>
          {mode === 'taka' ? `৳ ${padDisplay(num) || '০'}` : padDisplay(num) || '০'}
        </Txt>
        <View accessibilityRole="radiogroup" accessibilityLabel="একক" style={styles.units}>
          {units.map((m) => (
            <Pressable
              key={m}
              accessibilityRole="radio"
              accessibilityState={{ checked: mode === m }}
              onPress={() => changeMode(m)}
              style={[styles.unit, mode === m && styles.unitOn]}
            >
              <Txt size={fontSize.body} weight={mode === m ? 'bold' : 'semibold'} color={mode === m ? colors.saleDark : colors.ink2}>
                {pickModeLabel(m)}
              </Txt>
            </Pressable>
          ))}
        </View>
      </View>

      <NumberPad onKey={onKey} allowHalf={halfAllowed(mode)} keyHeight={56} />

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !pick }}
        onPress={done}
        style={({ pressed }) => [styles.ok, !pick && styles.okOff, pressed && styles.pressed]}
      >
        <Icon name="check" size={30} color={colors.onColor} strokeWidth={2.6} />
        <Txt size={fontSize.button} weight="bold" color={colors.onColor}>
          {pick ? pickText(pick) : 'ঠিক আছে'}
        </Txt>
      </Pressable>
    </SafeAreaView>
  );
}

function Tile({ name, on, isNew, onPress }: { name: string; on: boolean; isNew?: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: on }}
      accessibilityLabel={isNew ? `${name}, নতুন মাল` : name}
      onPress={onPress}
      style={[styles.tile, isNew && styles.tileNew, on && styles.tileOn]}
    >
      <View style={[styles.pic, { backgroundColor: isNew ? colors.neutralTint : productTiles[name] ?? colors.neutralTint }]}>
        <Icon name={isNew ? 'plus' : productIcon(name)} size={30} color={colors.ink} strokeWidth={isNew ? 2.4 : 1.6} />
      </View>
      <Txt size={fontSize.body} weight="bold">
        {name}
      </Txt>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: spacing.screen, paddingTop: spacing.screenTop, paddingBottom: spacing.screen, gap: spacing.sm },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  back: {
    width: size.iconButton,
    height: size.iconButton,
    borderRadius: radius.icon,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listen: {
    width: size.iconButton,
    height: size.iconButton,
    borderRadius: radius.pill,
    backgroundColor: colors.dark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    flex: 1,
    minWidth: 0,
    height: size.iconButton,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: radius.icon,
    paddingHorizontal: spacing.lg,
    paddingVertical: 0,
    backgroundColor: colors.surface,
    fontFamily: fonts.semibold,
    fontSize: fontSize.label,
    color: colors.ink,
  },
  flex: { flex: 1 },
  gridBox: { flex: 1, minHeight: 100 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  tile: {
    width: '31.9%',
    height: 92,
    borderRadius: radius.card,
    borderWidth: 3,
    borderColor: 'transparent',
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  tileNew: { borderStyle: 'dashed', borderColor: colors.border },
  tileOn: { borderStyle: 'solid', borderColor: colors.sale },
  pic: { width: 48, height: 48, borderRadius: radius.icon, alignItems: 'center', justifyContent: 'center' },
  empty: { padding: spacing.lg, textAlign: 'center', width: '100%' },
  qtyRow: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  units: { flexDirection: 'row', gap: spacing.xxs },
  unit: {
    height: 48,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 3,
    borderColor: colors.divider,
    backgroundColor: colors.surface,
    justifyContent: 'center',
  },
  unitOn: { borderColor: colors.sale, backgroundColor: colors.saleTint },
  ok: {
    height: 72,
    borderRadius: radius.button,
    backgroundColor: colors.sale,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  okOff: { opacity: 0.55 },
  pressed: { opacity: 0.85 },
});
