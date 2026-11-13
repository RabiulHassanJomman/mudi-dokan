import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';

import { Icon } from '../components/Icon';
import { Txt } from '../components/Txt';
import {
  basketFromParse,
  canSave,
  diffBaskets,
  readback,
  removeItem,
  setItemPrice,
  stepItem,
  withCredit,
  withCustomer,
  type BasketDraft,
  type ItemDraft,
} from '../domain/basket';
import { classifyAnswer } from '../domain/confirmWords';
import { createVoiceLog, findProducts, getVoiceLog, knownNames, saveBasket, setOutcome, setParsed } from '../db/repo';
import { getDevice, writer } from '../device';
import { UNIT_BN, formatNumber, formatQty, formatTaka, parseTakaInput } from '../lib/bn';
import { speak, stopSpeaking } from '../lib/speak';
import { parseCommand } from '../parser';
import type { Intent } from '../parser/types';
import { colors, fonts, fontSize, productTiles, radius, size, spacing } from '../theme/tokens';

type State =
  | { kind: 'loading' }
  | { kind: 'unsupported'; transcript: string; intent: Intent }
  | { kind: 'ready'; transcript: string };

const INTENT_BN: Record<Intent, string> = {
  sale: 'বিক্রি',
  purchase: 'মাল কেনা',
  baki: 'বাকি',
  joma: 'জমা',
  expense: 'খরচ',
  owner_withdrawal: 'মালিক নিল',
  stock_query: 'স্টক জানা',
  profit_query: 'লাভ জানা',
  unknown: 'বুঝিনি',
};

/** নিশ্চিত করুন: one row per item; nothing is saved until হ্যাঁ (button or voice). */
export default function ConfirmScreen() {
  const db = useSQLiteContext();
  const params = useLocalSearchParams<{ logId?: string; text?: string; tab?: string }>();
  const tab = params.tab ?? 'sale';

  const [state, setState] = useState<State>({ kind: 'loading' });
  const [basket, setBasket] = useState<BasketDraft | null>(null);
  const [answering, setAnswering] = useState(false);
  const [saving, setSaving] = useState(false);

  const logId = useRef<string | null>(null);
  const first = useRef<BasketDraft | null>(null);
  const latest = useRef<BasketDraft | null>(null);
  const decided = useRef(false);
  latest.current = basket;

  // ── voice হ্যাঁ / না ───────────────────────────────────────────
  const listenForAnswer = useCallback(async () => {
    const perm = await ExpoSpeechRecognitionModule.getPermissionsAsync();
    if (!perm.granted || decided.current) return;
    setAnswering(true);
    ExpoSpeechRecognitionModule.start({ lang: 'bn-BD', interimResults: false, maxAlternatives: 3, continuous: false });
  }, []);

  const stopListening = useCallback(() => {
    setAnswering(false);
    ExpoSpeechRecognitionModule.abort();
  }, []);

  const sayAndListen = useCallback(
    async (b: BasketDraft) => {
      stopListening();
      await speak(readback(b));
      if (canSave(b) && !decided.current) void listenForAnswer();
    },
    [listenForAnswer, stopListening],
  );

  useSpeechRecognitionEvent('result', (e) => {
    if (!e.isFinal) return;
    const answers = e.results.map((r) => classifyAnswer(r.transcript));
    if (answers.includes('no')) void onNo();
    else if (answers.includes('yes')) void onYes();
  });
  useSpeechRecognitionEvent('end', () => setAnswering(false));

  // ── load: log row → parse → products → basket ──────────────────
  useEffect(() => {
    let alive = true;
    (async () => {
      const w = writer();
      const device = getDevice();
      let transcript = '';
      if (params.logId) {
        logId.current = params.logId;
        transcript = (await getVoiceLog(db, params.logId))?.transcript ?? '';
      } else {
        transcript = params.text ?? '';
        logId.current = await createVoiceLog(db, w, { transcript, source: 'typed', contextTab: tab });
      }
      const names = await knownNames(db);
      const parsed = parseCommand(transcript, {
        tab: tab === 'sale' ? 'sale' : undefined,
        knownProducts: names.products,
        knownCustomers: names.customers,
        deviceRole: device.role ?? undefined,
        deviceName: device.name,
      });
      await setParsed(db, w, logId.current, parsed);
      if (!alive) return;

      if (parsed.intent !== 'sale') {
        await setOutcome(db, w, logId.current, 'unsupported');
        decided.current = true;
        setState({ kind: 'unsupported', transcript, intent: parsed.intent });
        void speak('এখন শুধু বিক্রি রাখা যায়।');
        return;
      }
      const products = await findProducts(db, (parsed.items ?? []).map((i) => i.product ?? ''));
      const b = basketFromParse(parsed, products);
      first.current = b;
      setBasket(b);
      setState({ kind: 'ready', transcript });
      void sayAndListen(b);
    })();
    return () => {
      alive = false;
    };
    // load once per screen
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // leaving without a decision counts as না
  useEffect(
    () => () => {
      stopSpeaking();
      ExpoSpeechRecognitionModule.abort();
      if (!decided.current && logId.current) void setOutcome(db, writer(), logId.current, 'cancelled');
    },
    [db],
  );

  // ── actions ────────────────────────────────────────────────────
  const leave = () => (router.canGoBack() ? router.back() : router.replace('/'));

  async function onYes() {
    const b = latest.current;
    if (!b || !logId.current || decided.current || saving) return;
    stopListening();
    if (!canSave(b)) {
      void speak(readback(b));
      return;
    }
    setSaving(true);
    decided.current = true;
    try {
      await saveBasket(db, writer(), b, logId.current, first.current ? diffBaskets(first.current, b) : []);
      void speak('রাখা হয়েছে।');
      leave();
    } catch (e) {
      decided.current = false;
      setSaving(false);
      void speak('রাখা গেল না।');
      console.warn('saveBasket failed', e);
    }
  }

  async function onNo() {
    if (decided.current || !logId.current) return;
    stopListening();
    decided.current = true;
    await setOutcome(db, writer(), logId.current, 'cancelled');
    void speak('বাতিল।');
    leave();
  }

  const edit = (next: BasketDraft) => {
    stopListening();
    setBasket(next);
  };

  const again = () => {
    decided.current = true;
    if (logId.current) void setOutcome(db, writer(), logId.current, 'cancelled');
    router.replace({ pathname: '/listening', params: { tab } });
  };

  // ── render ─────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.top}>
        <Pressable accessibilityRole="button" accessibilityLabel="ফিরে যান" onPress={() => void onNo()} style={styles.back}>
          <Icon name="back" size={26} color={colors.ink} strokeWidth={2.2} />
        </Pressable>
        {basket && (
          <Pressable
            accessibilityRole="button"
            onPress={() => void sayAndListen(basket)}
            style={({ pressed }) => [styles.listen, pressed && styles.pressed]}
          >
            <Icon name="speaker" size={26} color={colors.onColor} strokeWidth={2} />
            <Txt size={fontSize.body} weight="semibold" color={colors.onColor}>
              আবার শুনুন
            </Txt>
          </Pressable>
        )}
      </View>

      {state.kind === 'loading' && (
        <Txt size={fontSize.label} weight="bold" style={styles.center}>
          বুঝছি…
        </Txt>
      )}

      {state.kind === 'unsupported' && (
        <Unsupported transcript={state.transcript} intent={state.intent} onAgain={again} onClose={leave} />
      )}

      {state.kind === 'ready' && basket && (
        <>
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <Heard text={state.transcript} />
            {basket.items.length === 0 ? (
              <View style={styles.card}>
                <Txt wrap size={fontSize.headingLg} weight="bold" style={styles.center}>
                  কিছু বুঝিনি
                </Txt>
                <BigButton label="আবার বলুন" icon="mic" bg={colors.sale} ink={colors.onColor} onPress={again} />
              </View>
            ) : (
              basket.items.map((it) => (
                <ItemRow
                  key={it.key}
                  item={it}
                  onStep={(dir) => edit(stepItem(basket, it.key, dir))}
                  onPrice={(p) => edit(setItemPrice(basket, it.key, p))}
                  onRemove={() => edit(removeItem(basket, it.key))}
                />
              ))
            )}

            <View accessibilityRole="radiogroup" accessibilityLabel="নগদ না বাকি" style={styles.toggleRow}>
              <Toggle
                label="নগদ"
                icon="cash"
                active={!basket.credit}
                activeBorder={colors.sale}
                activeBg={colors.saleTint}
                ink={colors.saleDark}
                onPress={() => edit(withCredit(basket, false))}
              />
              <Toggle
                label="বাকি"
                icon="book"
                active={basket.credit}
                activeBorder={colors.baki}
                activeBg={colors.bakiTint}
                ink={colors.bakiInk}
                onPress={() => edit(withCredit(basket, true))}
              />
            </View>
            {basket.credit && (
              <CustomerInput initial={basket.customerName ?? ''} onChange={(t) => edit(withCustomer(basket, t))} />
            )}
          </ScrollView>

          <View style={styles.totalBar}>
            <Txt size={fontSize.body} weight="semibold" color={colors.onDarkMuted} style={styles.flex}>
              মোট{basket.items.length > 1 ? ` (${formatNumber(basket.items.length)}টি)` : ''}
            </Txt>
            <Txt size={fontSize.amount} weight="bold" color={colors.onColor}>
              {basket.totalPoisha !== null ? formatTaka(basket.totalPoisha) : '৳ ?'}
            </Txt>
          </View>

          {answering && (
            <Txt size={fontSize.body} weight="bold" color={colors.saleDark} style={styles.center}>
              বলুন: হ্যাঁ / না
            </Txt>
          )}
          <View style={styles.decide}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="না"
              onPress={() => void onNo()}
              style={({ pressed }) => [styles.no, pressed && styles.pressed]}
            >
              <Icon name="close" size={36} color={colors.ink} strokeWidth={2.6} />
              <Txt size={fontSize.button} weight="bold">
                না
              </Txt>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="হ্যাঁ"
              accessibilityState={{ disabled: !canSave(basket) || saving }}
              onPress={() => void onYes()}
              style={({ pressed }) => [styles.yes, (!canSave(basket) || saving) && styles.disabled, pressed && styles.pressed]}
            >
              <Icon name="check" size={40} color={colors.onColor} strokeWidth={2.8} />
              <Txt size={fontSize.button} weight="bold" color={colors.onColor}>
                {saving ? 'রাখছি…' : 'হ্যাঁ'}
              </Txt>
            </Pressable>
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

function Heard({ text }: { text: string }) {
  return (
    <Txt wrap size={fontSize.captionLg} weight="medium" color={colors.muted} style={styles.center}>
      শুনেছি: “{text}”
    </Txt>
  );
}

/** One basket line: name, line total, ✕ / − qty + / editable unit price. */
function ItemRow(props: {
  item: ItemDraft;
  onStep: (dir: 1 | -1) => void;
  onPrice: (pricePoisha: number) => void;
  onRemove: () => void;
}) {
  const { item } = props;
  const [priceText, setPriceText] = useState(item.pricePoisha !== null ? formatPriceInput(item.pricePoisha) : '');
  const tile = (item.productName && productTiles[item.productName]) || colors.neutralTint;
  const unitBn = UNIT_BN[item.unit];
  const stored = item.product?.sellPricePoisha ?? null;

  return (
    <View style={[styles.row, item.problems.length > 0 && styles.rowProblem]}>
      <View style={styles.rowTop}>
        <View style={[styles.rowTile, { backgroundColor: tile }]}>
          <Icon name="box" size={26} color={colors.ink} strokeWidth={1.6} />
        </View>
        <View style={styles.flex}>
          <Txt size={fontSize.button} weight="bold">
            {item.productName ?? 'নাম বুঝিনি'}
          </Txt>
          {!item.product && item.productName && (
            <Txt size={fontSize.caption} weight="bold" color={colors.stock}>
              নতুন মাল
            </Txt>
          )}
        </View>
        <Txt size={fontSize.listAmount} weight="bold" color={colors.sale}>
          {item.amountPoisha !== null ? formatTaka(item.amountPoisha) : '৳ ?'}
        </Txt>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${item.productName ?? 'এটা'} বাদ দিন`}
          onPress={props.onRemove}
          style={({ pressed }) => [styles.remove, pressed && styles.pressed]}
        >
          <Icon name="close" size={22} color={colors.ink2} strokeWidth={2.4} />
        </Pressable>
      </View>

      <View style={styles.rowBottom}>
        <StepButton icon="minus" label="কমান" onPress={() => props.onStep(-1)} />
        <Txt size={fontSize.label} weight="bold" style={styles.qty}>
          {item.quantity ? formatQty(item.quantity, item.unit) : `? ${unitBn}`}
        </Txt>
        <StepButton icon="plus" label="বাড়ান" onPress={() => props.onStep(1)} />
        <View style={styles.flex} />
        <Txt size={fontSize.body} weight="bold" color={colors.ink2}>
          ৳
        </Txt>
        <TextInput
          value={priceText}
          onChangeText={(t) => {
            setPriceText(t);
            const v = parseTakaInput(t);
            if (v) props.onPrice(v);
          }}
          keyboardType="numeric"
          accessibilityLabel={`${item.productName ?? ''} প্রতি ${unitBn} দাম`}
          placeholder="দাম"
          placeholderTextColor={colors.muted}
          style={[styles.input, styles.priceInput, item.priceWarning && styles.priceWarn]}
        />
        <Txt size={fontSize.captionLg} weight="medium" color={colors.muted}>
          /{unitBn}
        </Txt>
      </View>

      {item.priceWarning && stored !== null && (
        <Txt wrap size={fontSize.captionLg} weight="bold" color={colors.bakiInk}>
          সাধারণত {formatTaka(stored)}/{unitBn} — দাম ঠিক আছে তো?
        </Txt>
      )}
      {item.problems.includes('unit_mismatch') && (
        <Txt wrap size={fontSize.captionLg} weight="bold" color={colors.bakiInk}>
          {item.productName} {unitBn}-এ বিক্রি হয়। পরিমাণ ঠিক করুন।
        </Txt>
      )}
    </View>
  );
}

/** 6000 poisha → "60", 13333 → "133.33" (ASCII so the numeric keyboard can edit it). */
const formatPriceInput = (p: number) => String(Math.round(p) / 100);

function CustomerInput({ initial, onChange }: { initial: string; onChange: (t: string) => void }) {
  const [text, setText] = useState(initial);
  return (
    <View style={styles.inputRow}>
      <Txt size={fontSize.label} weight="bold" color={colors.bakiInk}>
        কার বাকি?
      </Txt>
      <TextInput
        value={text}
        onChangeText={(t) => {
          setText(t);
          onChange(t);
        }}
        accessibilityLabel="ক্রেতার নাম"
        placeholder="নাম"
        placeholderTextColor={colors.muted}
        style={[styles.input, styles.flex]}
      />
    </View>
  );
}

function StepButton({ icon, label, onPress }: { icon: 'plus' | 'minus'; label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.step, pressed && styles.pressed]}
    >
      <Icon name={icon} size={24} color={colors.ink} strokeWidth={2.6} />
    </Pressable>
  );
}

function Toggle(props: {
  label: string;
  icon: 'cash' | 'book';
  active: boolean;
  activeBorder: string;
  activeBg: string;
  ink: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: props.active }}
      onPress={props.onPress}
      style={[
        styles.toggle,
        props.active
          ? { borderColor: props.activeBorder, backgroundColor: props.activeBg }
          : { borderColor: colors.divider, backgroundColor: colors.surface },
      ]}
    >
      <Icon name={props.icon} size={30} color={props.ink} />
      <Txt size={fontSize.label} weight="bold" color={props.ink}>
        {props.label}
      </Txt>
    </Pressable>
  );
}

function BigButton(props: { label: string; icon: 'mic' | 'close'; bg: string; ink: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={props.onPress}
      style={({ pressed }) => [styles.bigButton, { backgroundColor: props.bg }, pressed && styles.pressed]}
    >
      <Icon name={props.icon} size={30} color={props.ink} />
      <Txt size={fontSize.button} weight="bold" color={props.ink}>
        {props.label}
      </Txt>
    </Pressable>
  );
}

function Unsupported(props: { transcript: string; intent: Intent; onAgain: () => void; onClose: () => void }) {
  return (
    <View style={styles.body}>
      <Heard text={props.transcript} />
      <View style={styles.card}>
        <Txt wrap size={fontSize.headingLg} weight="bold" style={styles.center}>
          এখন শুধু বিক্রি রাখা যায়
        </Txt>
        <Txt wrap size={fontSize.body} weight="medium" color={colors.muted} style={styles.center}>
          এটা মনে হলো: {INTENT_BN[props.intent]}। এই কাজ পরের ধাপে আসবে।
        </Txt>
      </View>
      <BigButton label="আবার বলুন" icon="mic" bg={colors.sale} ink={colors.onColor} onPress={props.onAgain} />
      <BigButton label="বন্ধ" icon="close" bg={colors.surface} ink={colors.ink} onPress={props.onClose} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, padding: spacing.screen, paddingBottom: 18, gap: spacing.md },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  back: {
    width: size.iconButton,
    height: size.iconButton,
    borderRadius: radius.icon,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listen: {
    height: size.iconButton,
    paddingHorizontal: 16,
    borderRadius: radius.pill,
    backgroundColor: colors.dark,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  body: { gap: spacing.sm, paddingBottom: spacing.md },
  center: { textAlign: 'center' },
  flex: { flex: 1 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.hero,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.screen,
    alignItems: 'center',
    gap: spacing.md,
  },
  row: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: spacing.sm,
    gap: spacing.xs,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  rowProblem: { borderColor: colors.bakiBorder },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowTile: { width: 44, height: 44, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  remove: {
    width: size.minTouch,
    height: size.minTouch,
    borderRadius: radius.sm,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBottom: { flexDirection: 'row', alignItems: 'center', gap: spacing.xxs },
  step: {
    width: size.minTouch + 4,
    height: size.minTouch + 4,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qty: { minWidth: 76, textAlign: 'center' },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  input: {
    height: size.minTouch + 4,
    // Android's default input padding clips tall Bangla vowel signs (ি looks like া)
    paddingVertical: 0,
    textAlignVertical: 'center',
    includeFontPadding: true,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    fontFamily: fonts.bold,
    fontSize: fontSize.label,
    color: colors.ink,
    backgroundColor: colors.surface,
  },
  priceInput: { width: 76, textAlign: 'center' },
  priceWarn: { borderColor: colors.baki, borderWidth: 3, backgroundColor: colors.bakiTint },
  toggleRow: { flexDirection: 'row', gap: spacing.sm },
  toggle: {
    flex: 1,
    height: 76,
    borderRadius: radius.button,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  totalBar: {
    backgroundColor: colors.dark,
    borderRadius: radius.card,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.screen,
    flexDirection: 'row',
    alignItems: 'center',
  },
  decide: { flexDirection: 'row', gap: spacing.md },
  no: {
    flex: 1,
    height: size.bigAction,
    borderRadius: radius.section,
    borderWidth: 3,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  yes: {
    flex: 1.6,
    height: size.bigAction,
    borderRadius: radius.section,
    backgroundColor: colors.sale,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  bigButton: {
    height: 72,
    borderRadius: radius.button,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    alignSelf: 'stretch',
  },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.85 },
});
