import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';

import { ConfirmSheet } from '../components/ConfirmSheet';
import { CustomerPicker } from '../components/CustomerPicker';
import { NameSheet } from '../components/NameSheet';
import { ProductSuggest } from '../components/ProductSuggest';
import { EntryForm } from '../components/EntryForm';
import { Avatar } from '../components/Avatar';
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
  renameItem,
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
import { nextReady, queuedAtOf } from '../queue/understand';
import { balanceWords, customerAliasToLearn, historyWords, owedList, resolveCustomerAlias, suggestCustomers, totalBakiWords } from '../domain/customers';
import {
  canSaveEntry,
  choosePurchaseProduct,
  diffEntries,
  entryFromFixed,
  entryFromParse,
  entryReadback,
  fixedAsParsed,
  renamePurchaseProduct,
  type EntryDraft,
  type LedgerKind,
} from '../domain/entry';
import { addDays, dayStart, daySummaryWords, profitOf, profitWords, today } from '../domain/cash';
import { basketFromStored, entryFromStored, type StoredEntry } from '../domain/fix';
import { filterProducts, type PickProduct } from '../domain/pick';
import { recentLine, type RecentEntry } from '../domain/recent';
import { suggestProducts } from '../domain/products';
import { allStockList, allStockWords, stockQtyText, stockView, stockWords, type StockView } from '../domain/stock';
import {
  addCustomerAlias,
  addProductAlias,
  customerAliasMap,
  createVoiceLog,
  customerBalances,
  customerByName,
  findProduct,
  findProducts,
  getVoiceLog,
  goodsSaleForFix,
  knownNames,
  ownerNames,
  pickProducts,
  productAliasMap,
  saveBasket,
  saveEntry,
  setOutcome,
  setParsed,
  stockList,
  customerHistory,
  basketForFix,
  cashDay,
  entryForFix,
  isFixTable,
  profitInput,
  recentEntries,
  saveBasketFix,
  saveEntryFix,
  TABLE_OF,
  voidEntry,
} from '../db/repo';
import { getDevice, writer } from '../device';
import { UNIT_BN, formatNumber, formatQty, formatTaka, parseTakaInput, toBnDigits } from '../lib/bn';
import { speak, stopSpeaking } from '../lib/speak';
import { pickedCommand, pickText, type PickedItem } from '../domain/pick';
import { parseCommand } from '../parser';
import { readKeyboardText } from '../domain/keyboard';
import { voiceMode } from '../lib/engine';
import { voiceTarget } from '../lib/voice';
import type { Intent, ParseContext, ParsedCommand } from '../parser/types';
import { colors, fonts, fontSize, productTiles, radius, size, spacing } from '../theme/tokens';
import { nav } from '../lib/nav';

type How = 'voice' | 'typed' | 'pick';

/** "চাল কত আছে?" / "করিমের বাকি কত?": the answer, or (name not known) the closest names to choose from. */
interface Answer {
  question: 'stock' | 'balance' | 'history' | 'total_baki' | 'all_stock' | 'profit' | 'day';
  /** The name as heard. */
  spoken: string | null;
  /** What TTS said; null until a name is chosen. */
  text: string | null;
  choices: string[];
  /** The customer the balance is for: "সব দেখুন" opens their screen. */
  customerId?: string;
  /** Summary questions: every customer who owes (largest first) / every product (low first). */
  owed?: { id: string; name: string; balance_poisha: number }[];
  stock?: StockView[];
  /** লাভ / আজকের হিসাব: buttons to আজকের ক্যাশ and আজকের খাতা. */
  links?: boolean;
}

type State =
  | { kind: 'loading' }
  | { kind: 'unsupported'; transcript: string; intent: Intent }
  | { kind: 'answer'; transcript: string; answer: Answer }
  | { kind: 'ready'; transcript: string }
  | { kind: 'entry'; transcript: string }
  /** "ভুল হয়েছে": the last entry, to cancel after হ্যাঁ (null = nothing to cancel). */
  | { kind: 'undo'; transcript: string; target: RecentEntry | null };

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
  total_baki_query: 'মোট বাকি জানা',
  customer_history_query: 'হিসাব দেখা',
  all_stock_query: 'সব মাল জানা',
  profit_query: 'লাভ জানা',
  day_summary_query: 'আজকের হিসাব',
  undo: 'শেষটা বাতিল',
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
  const params = useLocalSearchParams<{ logId?: string; text?: string; tab?: string; pick?: string; customer?: string; kind?: string; fix?: string; review?: string }>();
  /** From "অপেক্ষার হিসাব মিলিয়ে নিন": after হ্যাঁ/না the next waiting one opens; backing out keeps it waiting. */
  const review = params.review === '1';
  /** ✏️ from History: "sales:<basket id>" or "<table>:<row id>" — the card edits a saved entry. */
  const fixing = !!params.fix;
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
  const how: How = params.pick || params.text === '' ? 'pick' : params.logId ? 'voice' : 'typed';
  const [answering, setAnswering] = useState(false);
  const [saving, setSaving] = useState(false);
  /** Experiment: the card shows Gemini's result (gemini mode). */
  const [byGemini, setByGemini] = useState(false);
  /** The product name sheet: a basket line's key, or null for the purchase. */
  const [renaming, setRenaming] = useState<{ key: string | null; name: string } | null>(null);
  /** ✏️ fix: "এটা বাতিল করবো?" */
  const [askVoid, setAskVoid] = useState(false);
  /** ✏️ fix: what is being fixed. */
  const fixRef = useRef<{ table: string; id: string; stored: StoredEntry | null } | null>(null);
  /** "ভুল হয়েছে": the entry to cancel. */
  const undoRef = useRef<RecentEntry | null>(null);
  /** Android mode (Ridmik keyboard): no spoken হ্যাঁ / না. */
  const buttonsOnly = voiceMode() === 'android';
  /** The হ্যাঁ/না listener is on (other mics on the card — names — must not answer it). */
  const answeringRef = useRef(false);

  const logId = useRef<string | null>(null);
  const first = useRef<BasketDraft | null>(null);
  const latest = useRef<BasketDraft | null>(null);
  const firstEntry = useRef<EntryDraft | null>(null);
  const latestEntry = useRef<EntryDraft | null>(null);
  const decided = useRef(false);
  /** When it was said, if that was before now (the queue): the saved entry's time. */
  const entryAt = useRef<number | null>(null);
  /** For learning customer aliases: the heard customer, the shop's customers and aliases at load. */
  const heardCustomer = useRef<string | null>(null);
  const customersBefore = useRef<string[]>([]);
  const custAliases = useRef<Record<string, string>>({});
  latest.current = basket;
  latestEntry.current = entry;

  // ── voice হ্যাঁ / না ───────────────────────────────────────────
  const listenForAnswer = useCallback(async () => {
    // Android mode: হ্যাঁ / না by the buttons only (the phone's recognizer may be weak or missing)
    if (buttonsOnly) return;
    const perm = await ExpoSpeechRecognitionModule.getPermissionsAsync();
    if (!perm.granted || decided.current) return;
    setAnswering(true);
    answeringRef.current = true;
    ExpoSpeechRecognitionModule.start({ lang: 'bn-BD', interimResults: false, maxAlternatives: 3, continuous: false });
  }, []);

  const stopListening = useCallback(() => {
    if (!answeringRef.current) return;
    answeringRef.current = false;
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
    else if (state.kind === 'undo') void sayAndListen(undoWords(state.target), !!state.target);
    else if (fixing && entry) void speak(`ঠিক করুন। ${entryReadback(entry).replace(/ ঠিক আছে\?$/, '')} বদলে হ্যাঁ চাপুন।`);
    else if (fixing && basket) void speak(`ঠিক করুন। ${readback(basket).replace(/ ঠিক আছে\?$/, '')} বদলে হ্যাঁ চাপুন।`);
    else if (entry) void sayAndListen(entryReadback(entry), canSaveEntry(entry));
    else if (basket) void sayAndListen(readback(basket), canSave(basket));
  };

  useSpeechRecognitionEvent('result', (e) => {
    if (!e.isFinal || !answeringRef.current) return;
    answeringRef.current = false;
    const answers = e.results.map((r) => classifyAnswer(r.transcript));
    if (answers.includes('no')) void onNo();
    else if (answers.includes('yes')) void onYes();
  });
  useSpeechRecognitionEvent('end', () => {
    answeringRef.current = false;
    setAnswering(false);
  });

  // ── load: log row → parse → products → basket ──────────────────
  useEffect(() => {
    let alive = true;
    (async () => {
      const w = writer();
      const device = getDevice();
      let transcript = '';
      let parsed;
      const names = await knownNames(db);
      const aliasesNow = await customerAliasMap(db);
      customersBefore.current = names.customers;
      custAliases.current = aliasesNow;
      const owed = (await customerBalances(db)).map((c) => c.name);
      setKnown(owed);
      const catalogNow = await pickProducts(db);
      setCatalog(catalogNow);
      if (params.fix) {
        await loadFix(params.fix, names.customers);
        return;
      }
      if (params.pick) {
        // no speech, no parser: the picked product + number is the command
        const pick = JSON.parse(params.pick) as PickedItem;
        transcript = pickText(pick);
        parsed = pickedCommand(pick);
        logId.current = await createVoiceLog(db, w, { transcript, source: 'typed', contextTab: tab, parsed, via: 'pick' });
      } else {
        /**
         * A voice command: Gemini's checked answer (stored on the log) is the card; heard by the
         * phone (Android parsing): the fixed formats. Typed text: the rule parser.
         */
        let fromGemini: ParsedCommand | null = null;
        let heardByPhone = false;
        if (params.logId) {
          logId.current = params.logId;
          const log = await getVoiceLog(db, params.logId);
          fromGemini = log?.gemini_json ? (JSON.parse(log.gemini_json) as ParsedCommand) : null;
          transcript = fromGemini?.raw ?? log?.gemini_transcript ?? log?.transcript ?? '';
          setByGemini(!!fromGemini);
          heardByPhone = log?.engine === 'android' && !fromGemini;
          // said earlier (waited in the queue): the entry keeps that time
          entryAt.current = await queuedAtOf(db, params.logId);
        } else {
          transcript = params.text ?? '';
          // empty = the number-pad fallback (voice failed): nothing to parse
          logId.current = await createVoiceLog(db, w, { transcript, source: 'typed', contextTab: tab, ...(transcript ? {} : { via: 'pick' as const }) });
        }
        if (heardByPhone) {
          // from a customer screen the name need not be said
          const cmd = readKeyboardText(transcript, {
            knownProducts: names.products,
            knownCustomers: [...names.customers, ...Object.keys(aliasesNow)],
            productAliases: await productAliasMap(db),
          }, { customer: params.customer }, aliasesNow);
          await setParsed(db, w, logId.current!, fixedAsParsed(cmd), { by: 'android' });
          heardCustomer.current = cmd.customer ?? null;
          const products = await findProducts(db, cmd.goods);
          const e = entryFromFixed(cmd, { products, knownCustomers: names.customers });
          if (!alive) return;
          if (e) return showEntry(transcript, e);
          await setOutcome(db, w, logId.current!, 'unsupported');
          decided.current = true;
          setState({ kind: 'unsupported', transcript, intent: 'unknown' });
          void speak('কিছু বুঝিনি। আবার বলুন।');
          return;
        }
        const rule = fromGemini ? null : parseCommand(transcript, {
          tab: PARSE_TABS.find((t) => t === tab),
          knownProducts: names.products,
          // learned spellings help split "কোরিম চাল ২ কেজি"; resolved to the customer below
          knownCustomers: [...names.customers, ...Object.keys(aliasesNow)],
          productAliases: await productAliasMap(db),
          deviceRole: device.role ?? undefined,
          deviceName: device.name,
          // "রফিক ৫০০ নিল" = owner withdrawal when রফিক's phone is মালিক; "মালিক" is built in
          ownerNames: await ownerNames(db),
        });
        parsed = (fromGemini ?? rule)!;
        // a learned spelling → the customer (Gemini also gets the aliases, this catches the rest)
        if (parsed.customer) parsed = { ...parsed, customer: resolveCustomerAlias(parsed.customer, aliasesNow) };
        await setParsed(db, w, logId.current, parsed, params.logId ? { by: 'gemini' } : {});
      }
      heardCustomer.current = parsed.customer ?? null;
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
      if (parsed.intent === 'customer_history_query') {
        // a known customer: read the short history, open their screen; else closest names
        await setOutcome(db, w, logId.current, 'unsupported');
        decided.current = true;
        const c = parsed.customer ? await customerByName(db, parsed.customer) : null;
        if (!alive) return;
        if (c) {
          await openHistory(c);
          return;
        }
        const answer = unknownCustomer('history', parsed.customer ?? null, owed);
        setState({ kind: 'answer', transcript, answer });
        void speak(answer.text ?? answerPrompt(answer));
        return;
      }
      if (parsed.intent === 'profit_query' || parsed.intent === 'day_summary_query') {
        // "আজ লাভ কত?" / "আজকের হিসাব": TTS answer, buttons to the Cash and History screens
        await setOutcome(db, w, logId.current, 'unsupported');
        decided.current = true;
        const d = today();
        let text: string;
        if (parsed.intent === 'profit_query') {
          text = profitWords(profitOf(await profitInput(db, dayStart(d), dayStart(addDays(d, 1)))));
        } else {
          const c = await cashDay(db, d);
          text = daySummaryWords(c.flows, c.expectedPoisha);
        }
        if (!alive) return;
        const answer: Answer = { question: parsed.intent === 'profit_query' ? 'profit' : 'day', spoken: null, text, choices: [], links: true };
        setState({ kind: 'answer', transcript, answer });
        void speak(text);
        return;
      }
      if (parsed.intent === 'undo') {
        // "ভুল হয়েছে": show the last entry; হ্যাঁ cancels it with a correction
        const [target] = await recentEntries(db, 1);
        if (!alive) return;
        undoRef.current = target ?? null;
        setState({ kind: 'undo', transcript, target: target ?? null });
        if (!target) {
          await setOutcome(db, w, logId.current, 'unsupported');
          decided.current = true;
        }
        void sayAndListen(undoWords(target ?? null), !!target);
        return;
      }
      if (parsed.intent === 'total_baki_query' || parsed.intent === 'all_stock_query') {
        // summary question: a list to tap, TTS says only the totals; nothing to save
        await setOutcome(db, w, logId.current, 'unsupported');
        decided.current = true;
        let answer: Answer;
        if (parsed.intent === 'total_baki_query') {
          const rows = await customerBalances(db);
          answer = { question: 'total_baki', spoken: null, text: totalBakiWords(rows), choices: [], owed: owedList(rows) };
        } else {
          const list = (await stockList(db)).map(stockView);
          answer = { question: 'all_stock', spoken: null, text: allStockWords(list), choices: [], stock: allStockList(list) };
        }
        if (!alive) return;
        setState({ kind: 'answer', transcript, answer });
        void speak(answer.text!);
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
        if (e) return showEntry(transcript, e);
        // commands nobody understood
        await setOutcome(db, w, logId.current, 'unsupported');
        decided.current = true;
        setState({ kind: 'unsupported', transcript, intent: parsed.intent });
        void speak('কিছু বুঝিনি। আবার বলুন।');
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

  /** A new বাকি / জমা / খরচ / কেনা / নগদ goods card: read it, then listen for হ্যাঁ / না. */
  function showEntry(transcript: string, e: EntryDraft) {
    firstEntry.current = e;
    setEntry(e);
    setState({ kind: 'entry', transcript });
    void sayAndListen(entryReadback(e), canSaveEntry(e));
  }

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
    if (c) return { question: 'balance', spoken, text: balanceWords(c.name, c.balance_poisha), choices: [], customerId: c.id };
    return unknownCustomer('balance', spoken, owed);
  }

  /** Name not known (or not said): the closest names as buttons. */
  function unknownCustomer(question: 'balance' | 'history', spoken: string | null, owed: string[]): Answer {
    const choices = spoken ? suggestCustomers(spoken, owed, 3) : owed.slice(0, 6);
    return { question, spoken, text: choices.length ? null : `${spoken ?? 'এই নামে'} কাউকে চিনি না।`, choices };
  }

  /** "করিমের হিসাব দেখাও": say balance + last 3, then the customer screen (full history, ▶️). */
  async function openHistory(c: { id: string; name: string; balance_poisha: number }) {
    keepSpeaking.current = true; // leaving this screen must not cut the TTS
    void speak(historyWords(c.name, c.balance_poisha, await customerHistory(db, c.id)));
    nav.replace({ pathname: '/customer/[id]', params: { id: c.id } });
  }

  /** ✏️: the saved entry → the same card (basket or entry form); nothing is logged. */
  async function loadFix(fix: string, customers: string[]) {
    const [table, id] = fix.split(':') as [string, string];
    fixRef.current = { table, id, stored: null };
    decided.current = false;
    // a নগদ goods sale is fixed on the entry card (goods and total), other sales as baskets
    const goods = table === 'sales' ? await goodsSaleForFix(db, id) : null;
    if (table === 'sales' && !goods) {
      const lines = await basketForFix(db, id);
      if (!lines.length) return void setState({ kind: 'unsupported', transcript: '', intent: 'unknown' });
      const b = basketFromStored(lines, customers);
      first.current = b;
      setBasket(b);
      setShowCustomer(!!b.customerName);
      setState({ kind: 'ready', transcript: '' });
      void speak(`ঠিক করুন। ${readback(b).replace(/ ঠিক আছে\?$/, '')} বদলে হ্যাঁ চাপুন।`);
      return;
    }
    const stored = goods ?? (isFixTable(table) ? await entryForFix(db, table, id) : null);
    if (!stored) return void setState({ kind: 'unsupported', transcript: '', intent: 'unknown' });
    fixRef.current.stored = stored;
    const e = entryFromStored(stored);
    firstEntry.current = e;
    setEntry(e);
    setState({ kind: 'entry', transcript: '' });
    void speak(`ঠিক করুন। ${entryReadback(e).replace(/ ঠিক আছে\?$/, '')} বদলে হ্যাঁ চাপুন।`);
  }

  /** ✏️ হ্যাঁ: correction rows (never an edit). */
  async function saveFix() {
    const f = fixRef.current;
    if (!f || decided.current || saving) return;
    const b = latest.current;
    const e = latestEntry.current;
    if ((b && !canSave(b)) || (e && !canSaveEntry(e))) return void speak(b ? readback(b) : entryReadback(e!));
    stopListening();
    setSaving(true);
    decided.current = true;
    try {
      const changed = b ? await saveBasketFix(db, writer(), f.id, b) : await saveEntryFix(db, writer(), f.stored!, e!);
      void speak(changed ? 'ঠিক করা হয়েছে।' : 'কিছু বদলায়নি।');
      leave();
    } catch (err) {
      decided.current = false;
      setSaving(false);
      void speak('রাখা গেল না।');
      console.warn('saveFix failed', err);
    }
  }

  /** ✏️ এটা বাতিল করুন / "ভুল হয়েছে" হ্যাঁ: a voided correction. */
  async function cancelEntry(table: Parameters<typeof voidEntry>[2], id: string): Promise<boolean> {
    try {
      const ids = await voidEntry(db, writer(), table, id);
      if (logId.current) await setOutcome(db, writer(), logId.current, 'saved', { entryTable: table, entryId: ids[0], intent: 'undo', final: { undo: table, id } });
      return true;
    } catch (err) {
      console.warn('voidEntry failed', err);
      void speak('বাতিল করা গেল না।');
      return false;
    }
  }

  async function confirmUndo() {
    const t = undoRef.current;
    if (!t || decided.current || saving) return;
    stopListening();
    setSaving(true);
    decided.current = true;
    if (await cancelEntry(TABLE_OF[t.kind], t.id)) {
      void speak('বাতিল করা হয়েছে।');
      leave();
    } else {
      decided.current = false;
      setSaving(false);
    }
  }

  async function voidFixed() {
    const f = fixRef.current;
    if (!f || saving) return;
    setSaving(true);
    decided.current = true;
    if (await cancelEntry(f.table as Parameters<typeof voidEntry>[2], f.id)) {
      setAskVoid(false);
      void speak('বাতিল করা হয়েছে।');
      leave();
    } else {
      decided.current = false;
      setSaving(false);
    }
  }

  /** A product name typed or said on the card (the name sheet). */
  async function renameLine(key: string | null, name: string) {
    setRenaming(null);
    const known = await findProduct(db, name);
    if (key === null) {
      const e = latestEntry.current;
      if (e) setEntry(renamePurchaseProduct(e, name, known));
    } else {
      const b = latest.current;
      if (b) setBasket(renameItem(b, key, name, known));
    }
    void speak(known ? known.name : `${name}, নতুন মাল`);
  }
  const nameSuggestions = (t: string) => {
    const close = suggestProducts(t, catalog).map((p) => p.name);
    return [...new Set([...close, ...filterProducts(catalog, t).map((p) => p.name)])];
  };
  const openRename = (key: string | null, name: string | null) => {
    stopListening();
    setRenaming({ key, name: name ?? '' });
  };

  /** A name was chosen on the answer card. A product's heard name becomes its alias. */
  async function chooseAnswer(name: string) {
    if (state.kind !== 'answer') return;
    const a = state.answer;
    let answer: Answer;
    if (a.question === 'stock') {
      const p = catalog.find((x) => x.name === name);
      if (p && a.spoken && a.spoken !== p.name) await addProductAlias(db, writer(), a.spoken, p.id);
      answer = await stockAnswer(name, catalog);
    } else if (a.question === 'history') {
      await learnCustomerAlias(a.spoken, name);
      const c = await customerByName(db, name);
      if (c) return openHistory(c);
      return;
    } else {
      await learnCustomerAlias(a.spoken, name);
      answer = await balanceAnswer(name, known);
    }
    setState({ ...state, answer });
    void speak(answer.text ?? answerPrompt(answer));
  }

  /** The heard customer name was corrected to, or picked as, an existing customer: remember the spelling. */
  async function learnCustomerAlias(heard: string | null, chosen: string | null) {
    const alias = customerAliasToLearn(heard, chosen, customersBefore.current, custAliases.current);
    if (!alias || !chosen) return;
    try {
      if (await addCustomerAlias(db, writer(), alias, chosen)) custAliases.current = { ...custAliases.current, [alias]: chosen };
    } catch (e) {
      console.warn('addCustomerAlias failed', e);
    }
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
  const keepSpeaking = useRef(false);
  useEffect(
    () => () => {
      if (!keepSpeaking.current) stopSpeaking();
      ExpoSpeechRecognitionModule.abort();
      // backing out of a waiting one keeps it waiting; every other card counts as না
      if (!decided.current && logId.current && !review) void setOutcome(db, writer(), logId.current, 'cancelled');
    },
    [db, review],
  );

  // ── actions ────────────────────────────────────────────────────
  const leave = () => {
    if (review) {
      // the next waiting answer, else back home
      void nextReady(db).then((n) => {
        if (n) nav.replace({ pathname: '/confirm', params: { logId: n.id, tab: n.tab, review: '1' } });
        else nav.replace('/');
      });
      return;
    }
    if (nav.canGoBack()) nav.back();
    else nav.replace('/');
  };

  async function onYes() {
    if (fixRef.current) return saveFix();
    if (undoRef.current) return confirmUndo();
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
      await saveBasket(db, writer(), b, logId.current, first.current ? diffBaskets(first.current, b) : [], entryAt.current);
      await learnCustomerAlias(heardCustomer.current, b.customerName);
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
      await saveEntry(db, writer(), e, logId.current, firstEntry.current ? diffEntries(firstEntry.current, e) : [], entryAt.current);
      await learnCustomerAlias(heardCustomer.current, e.customerName);
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
    if (fixRef.current) {
      // leaving a fix changes nothing
      decided.current = true;
      stopListening();
      void speak('কিছু বদলায়নি।');
      return leave();
    }
    if (decided.current || !logId.current) return leave();
    stopListening();
    decided.current = true;
    await setOutcome(db, writer(), logId.current, 'cancelled');
    void speak(undoRef.current ? 'ঠিক আছে, কিছু বাতিল হয়নি।' : 'বাতিল।');
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
  const ready = state.kind === 'undo' ? !!state.target : entry ? canSaveEntry(entry) : basket ? canSave(basket) : false;

  const again = () => {
    decided.current = true;
    if (logId.current) void setOutcome(db, writer(), logId.current, 'cancelled');
    const t = tab === 'purchase' || tab === 'ledger' || tab === 'expense' ? tab : 'sale';
    nav.replace(voiceTarget(t, { ...(params.customer ? { customer: params.customer } : {}), ...(defaultKind ? { kind: defaultKind } : {}) }));
  };

  /** Voice did not work out: choose by picture instead. */
  const pickInstead = () => {
    decided.current = true;
    if (logId.current) void setOutcome(db, writer(), logId.current, 'cancelled');
    nav.replace({ pathname: '/pick', params: { tab: tab === 'purchase' ? 'purchase' : 'sale' } });
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
        {fixing && (
          <Txt size={fontSize.label} weight="bold" color={colors.stock} style={styles.flex}>
            {'  ঠিক করুন'}
          </Txt>
        )}
        {(basket || entry || state.kind === 'answer' || state.kind === 'undo') && (
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
          {state.answer.customerId && (
            <BigButton
              label="সব দেখুন"
              icon="list"
              bg={colors.bakiTint}
              ink={colors.bakiInk}
              onPress={() => {
                stopSpeaking();
                nav.push({ pathname: '/customer/[id]', params: { id: state.answer.customerId! } });
              }}
            />
          )}
          {state.answer.owed?.map((c) => (
            <Pressable
              key={c.id}
              accessibilityRole="button"
              accessibilityLabel={`${c.name}, ${formatTaka(c.balance_poisha)}, হিসাব দেখুন`}
              onPress={() => {
                stopSpeaking();
                nav.push({ pathname: '/customer/[id]', params: { id: c.id } });
              }}
              style={({ pressed }) => [styles.listRow, pressed && styles.pressed]}
            >
              <Avatar name={c.name} size={44} />
              <Txt size={fontSize.label} weight="bold" style={styles.listName}>
                {c.name}
              </Txt>
              <Txt size={fontSize.label} weight="bold" color={colors.bakiInk}>
                {formatTaka(c.balance_poisha)}
              </Txt>
            </Pressable>
          ))}
          {state.answer.stock?.map((v) => (
            <Pressable
              key={v.id}
              accessibilityRole="button"
              accessibilityLabel={`${stockWords(v)} শুনুন`}
              onPress={() => void speak(stockWords(v))}
              style={({ pressed }) => [styles.listRow, v.low && styles.listRowLow, pressed && styles.pressed]}
            >
              {v.low ? (
                <View style={styles.lowBadge}>
                  <Icon name="alert" size={18} color={colors.onColor} strokeWidth={2.4} />
                </View>
              ) : (
                <Icon name={productIcon(v.name)} size={30} color={colors.ink} strokeWidth={1.5} />
              )}
              <View style={styles.listName}>
                <Txt size={fontSize.label} weight="bold">
                  {v.name}
                </Txt>
                {v.sellPricePoisha !== null && (
                  <Txt size={fontSize.caption} weight="medium" color={colors.muted}>
                    {`${formatTaka(v.sellPricePoisha)} / ${UNIT_BN[v.unit]}`}
                  </Txt>
                )}
              </View>
              <Txt size={fontSize.label} weight="bold" color={v.low ? colors.lowStockQty : v.stock === null && !v.spentPoisha ? colors.muted : colors.ink}>
                {stockQtyText(v)}
              </Txt>
            </Pressable>
          ))}
          {state.answer.links && (
            <View style={styles.toggleRow}>
              <BigButton
                label="আজকের ক্যাশ"
                icon="wallet"
                bg={colors.dark}
                ink={colors.onColor}
                onPress={() => {
                  stopSpeaking();
                  nav.replace('/cash');
                }}
              />
              <BigButton
                label="আজকের খাতা"
                icon="list"
                bg={colors.stockTint}
                ink={colors.stock}
                onPress={() => {
                  stopSpeaking();
                  nav.replace('/history');
                }}
              />
            </View>
          )}
          <BigButton label="আবার বলুন" icon="mic" bg={colors.sale} ink={colors.onColor} onPress={again} />
          <BigButton label="বন্ধ" icon="close" bg={colors.surface} ink={colors.ink} onPress={leave} />
        </ScrollView>
      )}

      {state.kind === 'undo' && (
        <>
          <ScrollView contentContainerStyle={styles.body}>
            <Heard text={state.transcript} how={how} gemini={byGemini} />
            {state.target ? (
              <>
                <Txt wrap size={fontSize.headingLg} weight="bold" style={styles.center}>
                  শেষ লেখাটা বাতিল করবো?
                </Txt>
                <UndoCard target={state.target} />
                <Txt wrap size={fontSize.body} weight="medium" color={colors.muted} style={styles.center}>
                  মুছে যাবে না — বাতিল লেখা থাকবে, হিসাবে ধরা হবে না।
                </Txt>
              </>
            ) : (
              <View style={styles.card}>
                <Txt wrap size={fontSize.headingLg} weight="bold" style={styles.center}>
                  বাতিল করার মতো কিছু নেই
                </Txt>
                <BigButton label="বন্ধ" icon="close" bg={colors.surface} ink={colors.ink} onPress={leave} />
              </View>
            )}
          </ScrollView>
          {state.target && decideBar}
        </>
      )}

      {state.kind === 'ready' && basket && (
        <>
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            {fixing ? <FixBanner /> : <Heard text={state.transcript} how={how} gemini={byGemini} />}
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
                    onRename={() => openRename(it.key, it.productName)}
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
            {fixing && <VoidButton onPress={() => setAskVoid(true)} />}
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
            {fixing ? <FixBanner /> : !!state.transcript && <Heard text={state.transcript} how={how} gemini={byGemini} />}
            {entry.purchase && !entry.purchase.product && entry.purchase.productName && (
              <ProductSuggest
                spoken={entry.purchase.productName}
                choices={productChoices(entry.purchase.productName)}
                onChoose={(n) => void chooseLineProduct(null, n)}
              />
            )}
            <EntryForm entry={entry} known={known} onChange={editEntry} onRenameProduct={() => openRename(null, entry.purchase?.productName ?? null)} />
            {fixing && <VoidButton onPress={() => setAskVoid(true)} />}
          </ScrollView>
          {decideBar}
        </>
      )}

      <NameSheet
        visible={renaming !== null}
        title="মালের নাম — লিখুন বা বলুন"
        initial={renaming?.name ?? ''}
        suggest={nameSuggestions}
        onDone={(n) => void renameLine(renaming?.key ?? null, n)}
        onClose={() => setRenaming(null)}
      />
      <ConfirmSheet
        visible={askVoid}
        text="এই লেখাটা বাতিল করবো? মুছে যাবে না, হিসাবে ধরা হবে না। ঠিক আছে?"
        busy={saving}
        onYes={() => void voidFixed()}
        onNo={() => setAskVoid(false)}
      />
    </SafeAreaView>
  );
}

/** What TTS says for "ভুল হয়েছে". */
const undoWords = (t: RecentEntry | null) =>
  t ? `শেষ লেখা: ${recentLine(t).words} এটা বাতিল করবো? হ্যাঁ বা না বলুন।` : 'বাতিল করার মতো কিছু নেই।';

function UndoCard({ target }: { target: RecentEntry }) {
  const line = recentLine(target);
  return (
    <View style={[styles.row, styles.undoCard]}>
      <View style={styles.rowTop}>
        <View style={[styles.rowTile, { backgroundColor: colors.bakiTint }]}>
          <Icon name="undo" size={26} color={colors.bakiInk} strokeWidth={2} />
        </View>
        <View style={styles.flex}>
          <Txt size={fontSize.button} weight="bold">
            {line.title}
          </Txt>
          <Txt size={fontSize.body} weight="medium" color={colors.ink2}>
            {line.detail}
          </Txt>
        </View>
        <Txt size={fontSize.listAmount} weight="bold" color={colors.bakiInk}>
          {formatTaka(target.amount_poisha)}
        </Txt>
      </View>
    </View>
  );
}

function FixBanner() {
  return (
    <View style={styles.fixBanner}>
      <Icon name="edit" size={24} color={colors.stock} strokeWidth={2} />
      <Txt wrap size={fontSize.body} weight="bold" color={colors.stock} style={styles.flex}>
        আগের লেখা ঠিক করছেন। বদলে হ্যাঁ চাপুন — আগেরটা মুছবে না, পাশে কাটা দাগে থাকবে।
      </Txt>
    </View>
  );
}

function VoidButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.voidButton, pressed && styles.pressed]}
    >
      <Icon name="undo" size={26} color={colors.bakiInk} strokeWidth={2} />
      <Txt size={fontSize.label} weight="bold" color={colors.bakiInk}>
        এটা বাতিল করুন
      </Txt>
    </Pressable>
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
  if (a.question === 'history') return a.spoken ? `${a.spoken} নামে কাউকে চিনি না। কে?` : 'কার হিসাব? নিচে বেছে নিন।';
  return a.spoken ? `${a.spoken} নামে কাউকে চিনি না। কে?` : 'কার বাকি? নিচে বেছে নিন।';
}

/**
 * One basket line: name, line total, ✕ / − qty + / price box.
 * The price box edits what was spoken (line total, or per-unit price for "করে/প্রতি");
 * the other value is shown small underneath.
 */
function ItemRow(props: {
  item: ItemDraft;
  /** ✏️ the name: type or say another (a new product too). */
  onRename: () => void;
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
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${item.productName ?? 'মালের নাম'}, নাম বদলান`}
          onPress={props.onRename}
          style={({ pressed }) => [styles.flex, styles.nameButton, pressed && styles.pressed]}
        >
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
          <Icon name="edit" size={20} color={colors.ink2} strokeWidth={1.8} />
        </Pressable>
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
          {props.intent === 'unknown' ? 'কিছু বুঝিনি' : `${INTENT_BN[props.intent]}: বুঝিনি`}
        </Txt>
        <Txt wrap size={fontSize.body} weight="medium" color={colors.muted} style={styles.center}>
          বিক্রি, বাকি, জমা, খরচ বা মাল কেনা — আবার বলুন।
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
  // summary lists (মোট বাকি / সব মাল): one tappable row each, ≥ 52 px
  listRow: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: colors.surface,
    borderRadius: radius.button,
    borderWidth: 3,
    borderColor: 'transparent',
  },
  listRowLow: { borderColor: colors.baki },
  nameButton: { flexDirection: 'row', alignItems: 'center', gap: spacing.xxs, minHeight: size.minTouch },
  undoCard: { borderColor: colors.bakiBorder, padding: spacing.md },
  fixBanner: { backgroundColor: colors.stockTint, borderRadius: radius.card, padding: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  voidButton: {
    height: 64,
    borderRadius: radius.button,
    borderWidth: 2,
    borderColor: colors.bakiBorder,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  listName: { flex: 1 },
  lowBadge: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.baki,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
