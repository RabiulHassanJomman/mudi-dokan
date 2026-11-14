/**
 * Pilot log entry (the app's "শেয়ার" export) → eval fixture with source "pilot".
 * Pure; the CLI is scripts/eval-import.ts.
 *
 * The expected result is what the shopkeeper confirmed: the parse as shown on the
 * confirm card, with their edits applied. A field the user did not touch keeps the
 * parser's value (it was accepted as is), so a spoken "৫০০ গ্রাম" stays 500 g even
 * though the app saved 0.5 kg. A field they edited takes the saved value.
 *
 * Non-sale commands (not saved by the app yet) and unsure sales come in as status
 * "review": expected is a draft and the eval does not score them until labelled.
 */
import type { Intent, ParsedCommand, Unit } from '../src/parser/types';
import type { Expected, ExpectedItem, Fixture, Seed, Tab } from './eval-types';

/** One saved line, as basketSummary() writes it to voice_logs.final_json. */
export interface SavedItem {
  product: string;
  new_product?: boolean;
  quantity: number;
  unit: Unit;
  price_poisha: number;
  amount_poisha: number;
  price_mode?: 'total' | 'unit';
}
export interface SavedBasket {
  credit: boolean;
  customer: string | null;
  total_poisha: number;
  items: SavedItem[];
}
/** A saved non-sale, as entrySummary() writes it (step 4a): বাকি, জমা, খরচ, মালিক নিল, মাল কেনা. */
export interface SavedEntry {
  intent: Intent;
  customer: string | null;
  amount: number | null;
  item: string | null;
  person: string | null;
  note?: string | null;
  purchase?: unknown;
}

/** One entry of the export's `logs` array (src/app/pilot-log.tsx). */
export interface PilotLog {
  id?: string;
  at?: string;
  source?: 'voice' | 'typed';
  tab?: string | null;
  transcript?: string;
  parsed?: Partial<ParsedCommand>;
  outcome?: string;
  edits?: string[];
  saved?: SavedBasket | SavedEntry;
  stt_ok?: boolean;
  /** 'pick' = chosen on ছবি দেখে: no speech, no parse, nothing to evaluate. */
  via?: 'pick';
}

export type SkipReason = 'not_saved' | 'no_transcript' | 'stt_wrong' | 'no_result' | 'picked';
export type Converted = { fixture: Fixture } | { skip: SkipReason };

const TABS: readonly Tab[] = ['sale', 'purchase', 'ledger', 'stock', 'expense'] as Tab[];
const taka = (poisha: number) => Math.round(poisha) / 100;
const round2 = (n: number) => Math.round(n * 100) / 100;

const tabOf = (log: PilotLog): Tab => (TABS.includes(log.tab as Tab) ? (log.tab as Tab) : 'sale');

/** The parser's guess as a starting label (no confirmed result exists for it). */
function draftFromParse(p: Partial<ParsedCommand>): Expected {
  const e: Expected = { intent: p.intent ?? 'unknown' };
  if (p.customer) e.customer = p.customer;
  if (p.credit) e.credit = true;
  if (p.amount !== undefined) e.amount = p.amount;
  if (p.item) e.item = p.item;
  if (p.person) e.person = p.person;
  if (p.items?.length)
    e.items = p.items.map((i) => {
      const x: ExpectedItem = {};
      if (i.product) x.product = i.product;
      if (i.quantity) x.quantity = { ...i.quantity };
      if (i.total !== undefined) x.total = i.total;
      if (i.priceKind === 'unit' && i.unitPrice !== undefined) x.unitPrice = i.unitPrice;
      return x;
    });
  return e;
}

/**
 * Non-sale command (baki, joma, expense, owner_withdrawal, …): the app can't save these yet
 * (outcome "unsupported"), so nobody confirmed a result. Imported as status "review" with the
 * parser's guess as a draft, to be labelled by ear.
 */
function reviewFromUnsupported(log: PilotLog, text: string): Converted {
  const intent = log.parsed?.intent ?? 'unknown';
  const fixture: Fixture = {
    text,
    tab: tabOf(log),
    source: 'pilot',
    expected: draftFromParse(log.parsed ?? {}),
    status: 'review',
    review_notes: [`unconfirmed: ${intent}`],
  };
  if (log.id) fixture.pilot_id = log.id;
  return { fixture };
}

export function fixtureFromLog(log: PilotLog): Converted {
  if (log.via === 'pick') return { skip: 'picked' };
  const text = log.transcript?.trim();
  const unsupported = log.outcome === 'unsupported' && log.parsed?.intent !== 'sale';
  if (!unsupported && log.outcome !== 'saved' && log.outcome !== 'saved_edited') return { skip: 'not_saved' };
  if (!text) return { skip: 'no_transcript' };
  // STT wrote something else than was said: the confirmed result is not what this text means
  if (log.stt_ok === false) return { skip: 'stt_wrong' };
  if (unsupported) return reviewFromUnsupported(log, text);
  if (log.saved && 'intent' in log.saved) return entryFixture(log, text, log.saved);
  const saved = log.saved as SavedBasket | undefined;
  if (!saved || !Array.isArray(saved.items)) return { skip: 'no_result' };

  const edits = new Set(log.edits ?? []);
  const review: string[] = [];
  const parsedItems = log.parsed?.items ?? [];

  // confirm card keys are indexes into the parsed basket; removed lines are gone from saved
  const kept = parsedItems.map((_, k) => k).filter((k) => !edits.has(`items[${k}].removed`));
  if (kept.length !== saved.items.length) review.push('item_count');

  const items: ExpectedItem[] = saved.items.map((s, j) => {
    const k = kept[j] ?? j;
    const p = kept.length === saved.items.length ? parsedItems[k] : undefined;
    const edited = (f: string) => edits.has(`items[${k}].${f}`);
    const qtyEdited = edited('quantity') || edited('unit');
    const priceEdited = edited('pricePoisha') || edited('amountPoisha');
    const out: ExpectedItem = { product: s.product };

    if (p?.quantity && !qtyEdited) out.quantity = { ...p.quantity };
    else if (p?.quantity || qtyEdited) out.quantity = { value: s.quantity, unit: s.unit };
    else if (!p) out.quantity = { value: s.quantity, unit: s.unit };
    // else: price-only line ("১০০ টাকার চিনি"), the app worked the quantity out

    // unitPrice is compared only for a spoken per-unit price ("করে/প্রতি"); for a spoken
    // total the parser also derives one, but that is not something that was said
    const spokenPrice = p?.total !== undefined || p?.unitPrice !== undefined;
    const perUnit = p?.priceKind === 'unit';
    if (spokenPrice && !priceEdited && !qtyEdited) {
      if (p!.total !== undefined) out.total = p!.total;
      if (perUnit && p!.unitPrice !== undefined) out.unitPrice = p!.unitPrice;
    } else if (spokenPrice) {
      out.total = taka(s.amount_poisha);
      if (perUnit || s.price_mode === 'unit') out.unitPrice = taka(s.price_poisha);
    } else if (priceEdited) {
      // the shopkeeper typed a price nobody said, or the parser missed a spoken one
      review.push(`items[${j}].price`);
    }
    if (!p && review.indexOf('item_count') < 0) review.push(`items[${j}]`);
    return out;
  });

  const expected: Expected = { intent: 'sale', items };
  const customer = saved.customer?.trim();
  if (customer) expected.customer = customer;
  if (saved.credit) expected.credit = true;
  if (items.length && items.every((i) => i.total !== undefined)) expected.amount = round2(items.reduce((t, i) => t + i.total!, 0));

  const fixture: Fixture = { text, tab: tabOf(log), source: 'pilot', expected, edited: log.outcome === 'saved_edited' };
  if (log.id) fixture.pilot_id = log.id;
  if (review.length) {
    fixture.status = 'review';
    fixture.review_notes = review;
  }
  return { fixture };
}

/**
 * A saved non-sale. Like a sale: an untouched field keeps the parser's value, an edited one
 * takes the saved value. A field the user filled where the parse had nothing (a name or an
 * amount typed in, a kind chosen for an unclear command) is ambiguous — the parser may have
 * missed it, or it was never said (customer screen defaults, number pad) — so: review.
 */
function entryFixture(log: PilotLog, text: string, saved: SavedEntry): Converted {
  const p = log.parsed ?? {};
  const edits = new Set(log.edits ?? []);
  const review: string[] = [];
  const parsedIntent = p.intent ?? 'unknown';
  const expected: Expected = { intent: parsedIntent };
  if (saved.intent !== parsedIntent) {
    if (parsedIntent === 'unknown') review.push('intent');
    expected.intent = saved.intent;
  }
  const field = <K extends 'customer' | 'amount' | 'item' | 'person'>(name: K, parsed: Expected[K] | undefined, now: Expected[K] | null, keys: string[]) => {
    let v = parsed;
    if (keys.some((k) => edits.has(k))) {
      if (parsed === undefined || parsed === null) review.push(name);
      v = now ?? undefined;
    }
    if (v !== undefined && v !== null) expected[name] = v;
  };
  field('customer', p.customer, saved.customer, ['customerName']);
  field('amount', p.amount, saved.amount, ['amountPoisha']);
  field('item', p.item, saved.item, ['item']);
  field('person', p.person, saved.person, ['person']);

  const fixture: Fixture = { text, tab: tabOf(log), source: 'pilot', expected, edited: log.outcome === 'saved_edited' };
  if (log.id) fixture.pilot_id = log.id;
  if (review.length) {
    fixture.status = 'review';
    fixture.review_notes = review;
  }
  return { fixture };
}

/** The export is one JSON object ({ logs: [...] }); also take a JSON array or JSONL of logs/exports. */
export function readPilotLogs(content: string): PilotLog[] {
  const flatten = (v: unknown): PilotLog[] =>
    Array.isArray(v) ? v.flatMap(flatten) : v && typeof v === 'object' && 'logs' in v ? flatten((v as { logs: unknown }).logs) : v && typeof v === 'object' ? [v as PilotLog] : [];
  const trimmed = content.trim();
  if (!trimmed) return [];
  try {
    return flatten(JSON.parse(trimmed));
  } catch {
    return trimmed
      .split('\n')
      .filter((l) => l.trim())
      .flatMap((l, n) => {
        try {
          return flatten(JSON.parse(l));
        } catch {
          throw new Error(`line ${n + 1} is not JSON`);
        }
      });
  }
}

/** Products and customers the shop confirmed that the seed list lacks (the app would know them). */
export function seedAdditions(seed: Seed, fixtures: readonly Fixture[], logs: readonly PilotLog[]) {
  const products = new Map<string, Seed['products'][number]>();
  const customers = new Set<string>();
  const known = new Set(seed.products.map((p) => p.name));
  const ids = new Set(fixtures.map((f) => f.pilot_id).filter(Boolean));
  for (const l of logs) {
    if (!l.saved || (l.id && !ids.has(l.id))) continue;
    for (const s of 'items' in l.saved ? l.saved.items : []) {
      if (!known.has(s.product) && !products.has(s.product) && s.price_poisha > 0)
        products.set(s.product, { name: s.product, unit: s.unit, price: taka(s.price_poisha) });
    }
    const c = l.saved.customer?.trim();
    if (c && !seed.customers.includes(c)) customers.add(c);
  }
  return { products: [...products.values()], customers: [...customers] };
}
