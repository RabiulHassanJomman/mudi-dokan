import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';

import { CustomerPicker } from '../components/CustomerPicker';
import { ProductSuggest } from '../components/ProductSuggest';
import { EntryForm } from '../components/EntryForm';
import { Icon, productIcon, type IconName } from '../components/Icon';
import { Txt } from '../components/Txt';
import {
  basketFromParse,
  canSave,
  chooseProduct,
  diffBaskets,
  otherPriceText,
  priceWarningText,
  readback,
  removeItem,
  setItemPrice,
  setItemTotal,
  stepItem,
  unitWarningText,
  withCredit,
  withCustomer,
  type BasketDraft,
  type ItemDraft,
} from '../domain/basket';
import { classifyAnswer, heardPrefix } from '../domain/confirmWords';
import { balanceWords, suggestCustomers } from '../domain/customers';
import {
  canSaveEntry,
  choosePurchaseProduct,
  diffEntries,
  entryFromParse,
  entryReadback,
  type EntryDraft,
  type LedgerKind,
} from '../domain/entry';
import type { PickProduct } from '../domain/pick';
import { suggestProducts } from '../domain/products';
import { stockView, stockWords } from '../domain/stock';
import {
  addProductAlias,
  createVoiceLog,
  customerBalances,
  customerByName,
  findProduct,
  findProducts,
  getVoiceLog,
  knownNames,
  pickProducts,
  productAliasMap,
  saveBasket,
  saveEntry,
  setOutcome,
  setParsed,
  stockList,
} from '../db/repo';
import { getDevice, writer } from '../device';
import { UNIT_BN, formatNumber, formatQty, formatTaka, parseTakaInput, toBnDigits } from '../lib/bn';
import { speak, stopSpeaking } from '../lib/speak';
import { pickedCommand, pickText, type PickedItem } from '../domain/pick';
import { parseCommand } from '../parser';
import type { Intent, ParseContext, ParsedCommand } from '../parser/types';
import { colors, fonts, fontSize, productTiles, radius, size, spacing } from '../theme/tokens';

type How = 'voice' | 'typed' | 'pick';

/** "চাল কত আছে?" / "করিমের বাকি কত?": the answer, or (name not known) the closest names to choose from. */
interface Answer {
  question: 'stock' | 'balance';
  /** The name as heard. */
  spoken: string | null;
  /** What TTS said; null until a name is chosen. */
  text: string | null;
  choices: string[];
}

type State =
  | { kind: 'loading' }
  | { kind: 'unsupported'; transcript: string; intent: Intent }
  | { kind: 'answer'; transcript: string; answer: Answer }
  | { kind: 'ready'; transcript: string }
  | { kind: 'entry'; transcript: string };

const PARSE_TABS: readonly NonNullable<ParseContext['tab']>[] = ['sale', 'purchase', 'ledger', 'stock', 'expense'];

const INTENT_BN: Record<Intent, string> = {
  sale: 'বিক্রি',
  purchase: 'মাল কেনা',
  baki: 'বাকি',
  joma: 'জমা',
  expense: 'খরচ',
  owner_withdrawal: 'মালিক নিল',
  stock_query: 'স্টক জানা',
  balance_query: 'বাকি জানা',
  profit_query: 'লাভ জানা',
  unknown: 'বুঝিনি',
};

/**
 * নিশ্চিত করুন: a sale basket (one row per item) or any other entry (বাকি, জমা, খরচ,
 * মালিক নিল, মাল কেনা); nothing is saved until হ্যাঁ (button or voice).
 */
export default function ConfirmScreen() {
  const db = useSQLiteContext();
  /**
   * logId = voice (from Listening); text = typed; pick = chosen on ছবি দেখে (JSON PickedItem).
   * customer / kind: from the customer screen (জমা নিন / বাকি দিন), used when not said.
   */
  const params = useLocalSearchParams<{ logId?: string; text?: string; tab?: string; pick?: string; customer?: string; kind?: string }>();
  const tab = params.tab ?? 'sale';
  const defaultKind: LedgerKind | undefined = params.kind === 'baki' || params.kind === 'joma' ? params.kind : undefined;

  const [state, setState] = useState<State>({ kind: 'loading' });
  const [basket, setBasket] = useState<BasketDraft | null>(null);
  const [entry, setEntry] = useState<EntryDraft | null>(null);
  /** Customer names, most owed first (for the picker). */
  const [known, setKnown] = useState<string[]>([]);
  /** Products with aliases, for the closest-name chips. */
  const [catalog, setCatalog] = useState<PickProduct[]>([]);
  /** The parsed sale had a customer: keep the name box on a cash sale too. */
  const [showCustomer, setShowCustomer] = useState(false);
  const how: How = params.pick ? 'pick' : params.logId ? 'voice' : 'typed';
  const [answering, setAnswering] = useState(false);
  const [saving, setSaving] = useState(false);
  /** Experiment: the card shows Gemini's result (gemini mode). */
  const [byGemini, setByGemini] = useState(false);

  const logId = useRef<string | null>(null);
  const first = useRef<BasketDraft | null>(null);
  const latest = useRef<BasketDraft | null>(null);
  const firstEntry = useRef<EntryDraft | null>(null);
  const latestEntry = useRef<EntryDraft | null>(null);
  const decided = useRef(false);
  latest.current = basket;
  latestEntry.current = entry;

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

  /** Read the card aloud; when it can be saved, listen for হ্যাঁ / না. */
  const sayAndListen = useCallback(
    async (text: string, ready: boolean) => {
      stopListening();
      await speak(text);
      if (ready && !decided.current) void listenForAnswer();
    },
    [listenForAnswer, stopListening],
  );
  const readAloud = () => {
    if (state.kind === 'answer') void speak(state.answer.text ?? answerPrompt(state.answer));
    else if (entry) void sayAndListen(entryReadback(entry), canSaveEntry(entry));
    else if (basket) void sayAndListen(readback(basket), canSave(basket));
  };

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
      let parsed;
      const names = await knownNames(db);
      const owed = (await customerBalances(db)).map((c) => c.name);
      setKnown(owed);
      const catalogNow = await pickProducts(db);
      setCatalog(catalogNow);
      if (params.pick) {
        // no speech, no parser: the picked product + number is the command
        const pick = JSON.parse(params.pick) as PickedItem;
        transcript = pickText(pick);
        parsed = pickedCommand(pick);
        logId.current = await createVoiceLog(db, w, { transcript, source: 'typed', contextTab: tab, parsed, via: 'pick' });
      } else {
        /** gemini mode: Gemini's checked result drives the card; Android's rule parse is kept for the log. */
        let fromGemini: ParsedCommand | null = null;
        if (params.logId) {
          logId.current = params.logId;
          const log = await getVoiceLog(db, params.logId);
          transcript = log?.transcript ?? '';
          const g = log?.engine === 'gemini' && log.gemini_json ? (JSON.parse(log.gemini_json) as ParsedCommand) : null;
          // Gemini did not understand but the recognizer heard something: fall back to Android
          if (g && (g.intent !== 'unknown' || !transcript)) {
            fromGemini = g;
            setByGemini(true);
          }
        } else {
          transcript = params.text ?? '';
          // empty = the number-pad fallback (voice failed): nothing to parse, keep it out of the accuracy
          logId.current = await createVoiceLog(db, w, { transcript, source: 'typed', contextTab: tab, ...(transcript ? {} : { via: 'pick' as const }) });
        }
        const rule = parseCommand(transcript, {
          tab: PARSE_TABS.find((t) => t === tab),
          knownProducts: names.products,
          knownCustomers: names.customers,
          productAliases: await productAliasMap(db),
          deviceRole: device.role ?? undefined,
          deviceName: device.name,
        });
        parsed = fromGemini ?? rule;
        await setParsed(
          db,
          w,
          logId.current,
          parsed,
          params.logId ? { by: fromGemini ? 'gemini' : 'android', android: transcript ? rule : null } : {},
        );
        // the card shows what Gemini heard
        if (fromGemini) transcript = fromGemini.raw || transcript;
      }
      if (!alive) return;

      if (parsed.intent === 'stock_query' || parsed.intent === 'balance_query') {
        // a question: answered here, nothing to save
        await setOutcome(db, w, logId.current, 'unsupported');
        decided.current = true;
        const answer =
          parsed.intent === 'stock_query'
            ? await stockAnswer(parsed.product ?? null, catalogNow)
            : await balanceAnswer(parsed.customer ?? null, owed);
        if (!alive) return;
        setState({ kind: 'answer', transcript, answer });
        void speak(answer.text ?? answerPrompt(answer));
        return;
      }

      if (parsed.intent !== 'sale') {
        const products = await findProducts(db, parsed.product ? [parsed.product] : []);
        const e = entryFromParse(parsed, {
          products,
          knownCustomers: names.customers,
          tab: PARSE_TABS.find((t) => t === tab),
          defaultCustomer: params.customer,
          defaultKind,
        });
        if (!alive) return;
        if (e) {
          firstEntry.current = e;
          setEntry(e);
          setState({ kind: 'entry', transcript });
          void sayAndListen(entryReadback(e), canSaveEntry(e));
          return;
        }
        // questions (স্টক, লাভ) and commands nobody understood
        await setOutcome(db, w, logId.current, 'unsupported');
        decided.current = true;
        setState({ kind: 'unsupported', transcript, intent: parsed.intent });
        void speak(parsed.intent === 'unknown' ? 'কিছু বুঝিনি। আবার বলুন।' : 'এই প্রশ্নের উত্তর পরের ধাপে আসবে।');
        return;
      }
      const products = await findProducts(db, (parsed.items ?? []).map((i) => i.product ?? ''));
      const b = basketFromParse(parsed, products, names.customers);
      setShowCustomer(!!b.customerName);
      first.current = b;
      setBasket(b);
      setState({ kind: 'ready', transcript });
      void sayAndListen(readback(b), canSave(b));
    })();
    return () => {
      alive = false;
    };
    // load once per screen
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── questions ──────────────────────────────────────────────────
  async function stockAnswer(spoken: string | null, products: PickProduct[]): Promise<Answer> {
    const found = spoken ? await findProduct(db, spoken) : null;
    if (found) {
      const row = (await stockList(db)).find((r) => r.id === found.id);
      return { question: 'stock', spoken, text: row ? stockWords(stockView(row)) : `${found.name} এর হিসাব নেই।`, choices: [] };
    }
    const choices = spoken ? suggestProducts(spoken, products).map((p) => p.name) : products.slice(0, 6).map((p) => p.name);
    return { question: 'stock', spoken, text: choices.length ? null : `${spoken ?? 'এই মাল'} নামে কোনো মাল নেই।`, choices };
  }

  async function balanceAnswer(spoken: string | null, owed: string[]): Promise<Answer> {
    const c = spoken ? await customerByName(db, spoken) : null;
    if (c) return { question: 'balance', spoken, text: balanceWords(c.name, c.balance_poisha), choices: [] };
    const choices = spoken ? suggestCustomers(spoken, owed, 3) : owed.slice(0, 6);
    return { question: 'balance', spoken, text: choices.length ? null : `${spoken ?? 'এই নামে'} কাউকে চিনি না।`, choices };
  }

  /** A name was chosen on the answer card. A product's heard name becomes its alias. */
  async function chooseAnswer(name: string) {
    if (state.kind !== 'answer') return;
    const a = state.answer;
    let answer: Answer;
    if (a.question === 'stock') {
      const p = catalog.find((x) => x.name === name);
      if (p && a.spoken && a.spoken !== p.name) await addProductAlias(db, writer(), a.spoken, p.id);
      answer = await stockAnswer(name, catalog);
    } else {
      answer = await balanceAnswer(name, known);
    }
    setState({ ...state, answer });
    void speak(answer.text ?? answerPrompt(answer));
  }

  /** A sale line or purchase whose name matched none: the user chose a known product. */
  async function chooseLineProduct(key: string | null, name: string) {
    const p = await findProduct(db, name);
    if (!p) return;
    stopListening();
    if (key === null) {
      const e = latestEntry.current;
      if (e) setEntry(choosePurchaseProduct(e, p));
    } else {
      const b = latest.current;
      if (b) setBasket(chooseProduct(b, key, p));
    }
  }

  const productChoices = (spoken: string | null) => (spoken ? suggestProducts(spoken, catalog).map((p) => p.name) : []);

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
    const e = latestEntry.current;
    if (e) return saveTheEntry(e);
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

  async function saveTheEntry(e: EntryDraft) {
    if (!logId.current || decided.current || saving) return;
    stopListening();
    if (!canSaveEntry(e)) {
      void speak(entryReadback(e));
      return;
    }
    setSaving(true);
    decided.current = true;
    try {
      await saveEntry(db, writer(), e, logId.current, firstEntry.current ? diffEntries(firstEntry.current, e) : []);
      void speak('রাখা হয়েছে।');
      leave();
    } catch (err) {
      decided.current = false;
      setSaving(false);
      void speak('রাখা গেল না।');
      console.warn('saveEntry failed', err);
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
  const editEntry = (next: EntryDraft) => {
    stopListening();
    setEntry(next);
  };
  const ready = entry ? canSaveEntry(entry) : basket ? canSave(basket) : false;

  const again = () => {
    decided.current = true;
    if (logId.current) void setOutcome(db, writer(), logId.current, 'cancelled');
    router.replace({
      pathname: '/listening',
      params: { tab, ...(params.customer ? { customer: params.customer } : {}), ...(defaultKind ? { kind: defaultKind } : {}) },
    });
  };

  /** Voice did not work out: choose by picture instead. */
  const pickInstead = () => {
    decided.current = true;
    if (logId.current) void setOutcome(db, writer(), logId.current, 'cancelled');
    router.replace('/pick');
  };

  // ── render ─────────────────────────────────────────────────────
  const decideBar = (
    <>
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
          accessibilityState={{ disabled: !ready || saving }}
          onPress={() => void onYes()}
          style={({ pressed }) => [styles.yes, (!ready || saving) && styles.disabled, pressed && styles.pressed]}
        >
          <Icon name="check" size={40} color={colors.onColor} strokeWidth={2.8} />
          <Txt size={fontSize.button} weight="bold" color={colors.onColor}>
            {saving ? 'রাখছি…' : 'হ্যাঁ'}
          </Txt>
        </Pressable>
      </View>
    </>
  );

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.top}>
        <Pressable accessibilityRole="button" accessibilityLabel="ফিরে যান" onPress={() => void onNo()} style={styles.back}>
          <Icon name="back" size={26} color={colors.ink} strokeWidth={2.2} />
        </Pressable>
        {(basket || entry || state.kind === 'answer') && (
          <Pressable
            accessibilityRole="button"
            onPress={readAloud}
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
        <Unsupported transcript={state.transcript} how={how} intent={state.intent} onAgain={again} onClose={leave} />
      )}

      {state.kind === 'answer' && (
        <ScrollView contentContainerStyle={styles.body}>
          <Heard text={state.transcript} how={how} gemini={byGemini} />
          <View style={styles.card}>
            {state.answer.text !== null ? (
              <Txt wrap size={fontSize.headingLg} weight="bold" style={styles.center}>
                {state.answer.text}
              </Txt>
            ) : (
              <Txt wrap size={fontSize.label} weight="bold" style={styles.center}>
                {answerPrompt(state.answer)}
              </Txt>
            )}
          </View>
          {state.answer.choices.length > 0 &&
            (state.answer.question === 'stock' ? (
              <ProductSuggest
                spoken={state.answer.spoken ?? ''}
                choices={state.answer.choices}
                question="চেপে বেছে নিন:"
                onChoose={(n) => void chooseAnswer(n)}
              />
            ) : (
              <View style={styles.chips}>
                {state.answer.choices.map((n) => (
                  <Pressable
                    key={n}
                    accessibilityRole="button"
                    onPress={() => void chooseAnswer(n)}
                    style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
                  >
                    <Txt size={fontSize.label} weight="bold">
                      {n}
                    </Txt>
                  </Pressable>
                ))}
              </View>
            ))}
          <BigButton label="আবার বলুন" icon="mic" bg={colors.sale} ink={colors.onColor} onPress={again} />
          <BigButton label="বন্ধ" icon="close" bg={colors.surface} ink={colors.ink} onPress={leave} />
        </ScrollView>
      )}

      {state.kind === 'ready' && basket && (
        <>
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <Heard text={state.transcript} how={how} gemini={byGemini} />
            {basket.items.length === 0 ? (
              <View style={styles.card}>
                <Txt wrap size={fontSize.headingLg} weight="bold" style={styles.center}>
                  কিছু বুঝিনি
                </Txt>
                <BigButton label="আবার বলুন" icon="mic" bg={colors.sale} ink={colors.onColor} onPress={again} />
                <BigButton label="ছবি দেখে বেছে নিন" icon="image" bg={colors.stockTint} ink={colors.stock} onPress={pickInstead} />
              </View>
            ) : (
              basket.items.map((it) => (
                <View key={it.key} style={styles.lineBox}>
                  <ItemRow
                    item={it}
                    onStep={(dir) => edit(stepItem(basket, it.key, dir))}
                    onPrice={(p) =>
                      edit(it.priceMode === 'unit' ? setItemPrice(basket, it.key, p) : setItemTotal(basket, it.key, p))
                    }
                    onRemove={() => edit(removeItem(basket, it.key))}
                  />
                  {!it.product && it.productName && (
                    <ProductSuggest
                      spoken={it.productName}
                      choices={productChoices(it.productName)}
                      onChoose={(n) => void chooseLineProduct(it.key, n)}
                    />
                  )}
                </View>
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
            {(basket.credit || showCustomer) && (
              <CustomerPicker
                label={basket.credit ? 'কার বাকি?' : 'ক্রেতা'}
                name={basket.customerName}
                ok={basket.customerOk}
                known={known}
                onChange={(n, ok) => edit(withCustomer(basket, n, ok))}
              />
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

          {decideBar}
        </>
      )}

      {state.kind === 'entry' && entry && (
        <>
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            {!!state.transcript && <Heard text={state.transcript} how={how} gemini={byGemini} />}
            {entry.purchase && !entry.purchase.product && entry.purchase.productName && (
              <ProductSuggest
                spoken={entry.purchase.productName}
                choices={productChoices(entry.purchase.productName)}
                onChoose={(n) => void chooseLineProduct(null, n)}
              />
            )}
            <EntryForm entry={entry} known={known} onChange={editEntry} />
          </ScrollView>
          {decideBar}
        </>
      )}
    </SafeAreaView>
  );
}

/** "শুনেছি" (voice), "লিখেছি" (typed), "বেছে নিয়েছি" (ছবি দেখে). */
function Heard({ text, how, gemini }: { text: string; how: How; gemini?: boolean }) {
  return (
    <Txt wrap size={fontSize.captionLg} weight="medium" color={colors.muted} style={styles.center}>
      {heardPrefix(how)}
      {gemini ? ' (Gemini)' : ''}: “{text}”
    </Txt>
  );
}

/** The answer card when the name is not known yet. */
function answerPrompt(a: Answer): string {
  if (a.question === 'stock') return a.spoken ? `${a.spoken} নামে মাল চিনি না। কোন মাল?` : 'কোন মালের কথা? নিচে বেছে নিন।';
  return a.spoken ? `${a.spoken} নামে কাউকে চিনি না। কে?` : 'কার বাকি? নিচে বেছে নিন।';
}

/**
 * One basket line: name, line total, ✕ / − qty + / price box.
 * The price box edits what was spoken (line total, or per-unit price for "করে/প্রতি");
 * the other value is shown small underneath.
 */
function ItemRow(props: {
  item: ItemDraft;
  onStep: (dir: 1 | -1) => void;
  /** Line total or unit price, by item.priceMode. */
  onPrice: (poisha: number) => void;
  onRemove: () => void;
}) {
  const { item } = props;
  const editsTotal = item.priceMode === 'total';
  const value = editsTotal ? item.amountPoisha : item.pricePoisha;
  const [priceText, setPriceText] = useState(value !== null ? formatPriceInput(value) : '');
  // ± changes a line total: show the new one unless it is what the user is typing
  useEffect(() => {
    if (value !== null && parseTakaInput(priceText) !== value) setPriceText(formatPriceInput(value));
    // only when the value changes from outside
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const tile = (item.productName && productTiles[item.productName]) || colors.neutralTint;
  const unitBn = UNIT_BN[item.unit];
  const other = otherPriceText(item);
  const priceWarn = priceWarningText(item);
  const unitWarn = unitWarningText(item);

  return (
    <View style={[styles.row, item.problems.length > 0 && styles.rowProblem]}>
      <View style={styles.rowTop}>
        <View style={[styles.rowTile, { backgroundColor: tile }]}>
          <Icon name={productIcon(item.productName ?? '')} size={26} color={colors.ink} strokeWidth={1.6} />
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
        <View style={[styles.qtyBox, item.unitWarning && styles.warnBox]}>
          <Txt size={fontSize.label} weight="bold" style={styles.center}>
            {item.quantity ? formatQty(item.quantity, item.unit) : `? ${unitBn}`}
          </Txt>
        </View>
        <StepButton icon="plus" label="বাড়ান" onPress={() => props.onStep(1)} />
        <View style={styles.flex} />
        <View style={styles.priceCol}>
          <View style={styles.priceRow}>
            <Txt size={fontSize.body} weight="bold" color={colors.ink2}>
              {editsTotal ? 'মোট ৳' : '৳'}
            </Txt>
            <TextInput
              value={priceText}
              onChangeText={(t) => {
                setPriceText(toBnDigits(t));
                const v = parseTakaInput(t);
                if (v) props.onPrice(v);
              }}
              keyboardType="numeric"
              accessibilityLabel={editsTotal ? `${item.productName ?? ''} মোট দাম` : `${item.productName ?? ''} প্রতি ${unitBn} দাম`}
              placeholder="দাম"
              placeholderTextColor={colors.muted}
              style={[styles.input, styles.priceInput, item.priceWarning && styles.warnBox]}
            />
            {!editsTotal && (
              <Txt size={fontSize.captionLg} weight="medium" color={colors.muted}>
                /{unitBn}
              </Txt>
            )}
          </View>
          {other && (
            <Txt size={fontSize.caption} weight="semibold" color={colors.muted}>
              {other}
            </Txt>
          )}
        </View>
      </View>

      {unitWarn && (
        <Txt wrap size={fontSize.captionLg} weight="bold" color={colors.bakiInk}>
          {unitWarn}
        </Txt>
      )}
      {priceWarn && (
        <Txt wrap size={fontSize.captionLg} weight="bold" color={colors.bakiInk}>
          {priceWarn}
        </Txt>
      )}
    </View>
  );
}

/** 6000 poisha → "৬০", 13333 → "১৩৩.৩৩" (typed ASCII digits are turned Bangla as they come). */
const formatPriceInput = (p: number) => toBnDigits(Math.round(p) / 100);

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

function BigButton(props: { label: string; icon: IconName; bg: string; ink: string; onPress: () => void }) {
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

function Unsupported(props: { transcript: string; how: How; intent: Intent; onAgain: () => void; onClose: () => void }) {
  return (
    <View style={styles.body}>
      <Heard text={props.transcript} how={props.how} />
      <View style={styles.card}>
        <Txt wrap size={fontSize.headingLg} weight="bold" style={styles.center}>
          {props.intent === 'unknown' ? 'কিছু বুঝিনি' : `${INTENT_BN[props.intent]}: পরের ধাপে আসছে`}
        </Txt>
        <Txt wrap size={fontSize.body} weight="medium" color={colors.muted} style={styles.center}>
          {props.intent === 'unknown'
            ? 'বিক্রি, বাকি, জমা, খরচ বা মাল কেনা — আবার বলুন।'
            : 'লাভের প্রশ্নের উত্তর পরের ধাপে আসবে।'}
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
  lineBox: { gap: spacing.xxs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, justifyContent: 'center' },
  chip: {
    minHeight: 56,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    justifyContent: 'center',
  },
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
  qtyBox: {
    minWidth: 80,
    height: size.minTouch + 4,
    paddingHorizontal: 4,
    borderRadius: radius.sm,
    borderWidth: 3,
    borderColor: 'transparent',
    justifyContent: 'center',
  },
  priceCol: { alignItems: 'flex-end', gap: 2 },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xxs },
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
  warnBox: { borderColor: colors.baki, borderWidth: 3, backgroundColor: colors.bakiTint },
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
