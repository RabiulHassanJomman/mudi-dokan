/**
 * আজকের ক্যাশ / নোট গুনুন / লাভ / আজকের হিসাব: day boundaries, expected cash, note
 * counting and what TTS says. Pure TS. Money in poisha.
 *
 * হাতে থাকার কথা = opening + নগদ বিক্রি + বাকি জমা − খরচ − নগদ কেনা − মালিক নিল
 * (docs/Plan.md feature 9). Opening = the latest anchor: Setup's opening cash, or a
 * day's counted cash (দিন শেষ করুন) for the next day; days not closed carry on.
 */
import { formatTaka, toBnDigits } from '../lib/bn';

// ── business days (the shop's local calendar) ───────────────────

const pad2 = (n: number) => String(n).padStart(2, '0');

/** ms → "2026-11-14" (local). */
export function businessDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** "2026-11-14" → local midnight (ms). */
export function dayStart(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y!, m! - 1, d!).getTime();
}

export const addDays = (date: string, n: number): string => {
  const [y, m, d] = date.split('-').map(Number);
  return businessDate(new Date(y!, m! - 1, d! + n).getTime());
};

export const today = (now = Date.now()) => businessDate(now);

// ── cash ────────────────────────────────────────────────────────

/** One day's (or range's) money movements, from the effective entries. */
export interface CashFlows {
  /** Every sale (cash + credit). */
  sales: number;
  cashSales: number;
  /** New baki: credit sales + plain বাকি entries. */
  bakiGiven: number;
  joma: number;
  expenses: number;
  cashPurchases: number;
  withdrawals: number;
}

export const ZERO_FLOWS: CashFlows = { sales: 0, cashSales: 0, bakiGiven: 0, joma: 0, expenses: 0, cashPurchases: 0, withdrawals: 0 };

/** Cash in minus cash out. */
export const netCash = (f: CashFlows) => f.cashSales + f.joma - f.expenses - f.cashPurchases - f.withdrawals;

export const expectedCash = (openingPoisha: number, f: CashFlows) => openingPoisha + netCash(f);

/** A day_close row: Setup's opening (start of `date`) or a counted close (end of `date`). */
export interface CashAnchor {
  date: string;
  kind: 'opening' | 'close';
  amountPoisha: number;
}

/**
 * Where `date`'s opening cash comes from: the latest anchor before it. `from` = the first
 * day whose flows are not in the amount yet (the repo adds flows from `from` to `date`).
 * setup = Setup's opening for this day; close = yesterday's counted cash; carry = older,
 * with the days in between added.
 */
export function openingAnchor(
  anchors: readonly CashAnchor[],
  date: string,
): { from: string; amountPoisha: number; source: 'setup' | 'close' | 'carry' } | null {
  let best: { from: string; amountPoisha: number; kind: CashAnchor['kind'] } | null = null;
  for (const a of anchors) {
    const from = a.kind === 'close' ? addDays(a.date, 1) : a.date;
    if (from > date) continue;
    // later wins; on the same day an explicit opening wins over the previous close.
    // Same day and kind (two phones): the first listed (cashAnchors: latest first) stays.
    if (!best || from > best.from || (from === best.from && a.kind === 'opening' && best.kind !== 'opening')) best = { from, amountPoisha: a.amountPoisha, kind: a.kind };
  }
  if (!best) return null;
  const source = best.from !== date ? 'carry' : best.kind === 'opening' ? 'setup' : 'close';
  return { from: best.from, amountPoisha: best.amountPoisha, source };
}

export type OpeningSource = 'setup' | 'close' | 'carry' | 'none';

const openingLabel = (s: OpeningSource) => (s === 'setup' ? 'শুরুর ক্যাশ' : 'গতকালের ক্যাশ');

export interface CashRow {
  key: string;
  label: string;
  sign: 1 | -1;
  poisha: number;
}

/** The Cash screen's hisab card, top to bottom. মাল কেনা / মালিক নিল only when there are any. */
export function cashRows(openingPoisha: number, source: OpeningSource, f: CashFlows): CashRow[] {
  const rows: CashRow[] = [
    { key: 'opening', label: openingLabel(source), sign: 1, poisha: openingPoisha },
    { key: 'cashSales', label: 'নগদ বিক্রি', sign: 1, poisha: f.cashSales },
    { key: 'joma', label: 'বাকি জমা পেলাম', sign: 1, poisha: f.joma },
    { key: 'expenses', label: 'খরচ', sign: -1, poisha: f.expenses },
  ];
  if (f.cashPurchases) rows.push({ key: 'cashPurchases', label: 'মাল কেনা (নগদ)', sign: -1, poisha: f.cashPurchases });
  if (f.withdrawals) rows.push({ key: 'withdrawals', label: 'মালিক নিল', sign: -1, poisha: f.withdrawals });
  return rows;
}

/** Plain digits for TTS ("৮২৩০", no thousands comma). */
const say = (poisha: number) => toBnDigits(Math.round(poisha) / 100);

/** 🔊 on the Cash screen. */
export function cashWords(openingPoisha: number, source: OpeningSource, f: CashFlows): string {
  const parts = cashRows(openingPoisha, source, f).map((r, k) =>
    k === 0 ? `${r.label} ${say(r.poisha)} টাকা।` : `${r.label === 'মাল কেনা (নগদ)' ? 'মাল কেনা' : r.label} ${say(r.poisha)}।`,
  );
  return `${parts.join(' ')} হাতে থাকার কথা ${say(expectedCash(openingPoisha, f))} টাকা।`;
}

// ── note counting (নোট গুনুন) ──────────────────────────────────

export const NOTES = [1000, 500, 200, 100, 50, 20, 10] as const;
export type Note = (typeof NOTES)[number];
/** Note face → how many; zero counts are left out (day_close.note_counts_json). */
export type NoteCounts = Partial<Record<Note, number>>;

export function stepNote(c: NoteCounts, face: Note, dir: 1 | -1): NoteCounts {
  const n = Math.max(0, (c[face] ?? 0) + dir);
  const next = { ...c };
  if (n) next[face] = n;
  else delete next[face];
  return next;
}

export const countedPoisha = (c: NoteCounts) => NOTES.reduce((s, f) => s + f * 100 * (c[f] ?? 0), 0);

export interface Gap {
  kind: 'ok' | 'short' | 'over';
  /** Always ≥ 0. */
  poisha: number;
  /** "৳ ৫০ কম আছে" */
  text: string;
  words: string;
}

export function gapOf(countedPoisha: number, expectedPoisha: number): Gap {
  const d = countedPoisha - expectedPoisha;
  if (d === 0) return { kind: 'ok', poisha: 0, text: 'ঠিক মিলেছে', words: 'ঠিক মিলেছে।' };
  const word = d < 0 ? 'কম' : 'বেশি';
  const p = Math.abs(d);
  return { kind: d < 0 ? 'short' : 'over', poisha: p, text: `${formatTaka(p)} ${word} আছে`, words: `${say(p)} টাকা ${word} আছে।` };
}

/** দিন শেষ করুন → ConfirmSheet. */
export const closeReadback = (countedP: number, expectedP: number) =>
  `গুনে পেলাম ${say(countedP)} টাকা। থাকার কথা ${say(expectedP)} টাকা। ${gapOf(countedP, expectedP).words} দিন শেষ করবো?`;

// ── লাভ (Plan feature 5) ───────────────────────────────────────

/** Sums the repo gives for a period. Lines whose buy price is unknown are counted apart. */
export interface ProfitInput {
  salesPoisha: number;
  /** Sales with a known buy price, and what those goods cost. */
  knownSalesPoisha: number;
  knownCostPoisha: number;
  unknownLines: number;
  expensesPoisha: number;
}

export interface Profit {
  sales: number;
  gross: number;
  expenses: number;
  net: number;
  unknownLines: number;
}

export const profitOf = (p: ProfitInput): Profit => {
  const gross = p.knownSalesPoisha - p.knownCostPoisha;
  return { sales: p.salesPoisha, gross, expenses: p.expensesPoisha, net: gross - p.expensesPoisha, unknownLines: p.unknownLines };
};

/** "আজ বিক্রি ৪৮৫০ টাকা। মোট লাভ ৯২০। খরচ ৫৭০। আসল লাভ ৩৫০ টাকা।" */
export function profitWords(p: Profit): string {
  if (!p.sales) return `আজ এখনো কোনো বিক্রি নেই। খরচ ${say(p.expenses)}।`;
  let s = `আজ বিক্রি ${say(p.sales)} টাকা। মোট লাভ ${p.gross < 0 ? 'নেই, লোকসান ' : ''}${say(Math.abs(p.gross))}। খরচ ${say(p.expenses)}।`;
  s += p.net < 0 ? ` আসল লাভ নেই, লোকসান ${say(-p.net)} টাকা।` : ` আসল লাভ ${say(p.net)} টাকা।`;
  if (p.unknownLines) s += ` ${toBnDigits(p.unknownLines)}টা বিক্রির কেনা দাম জানা নেই, লাভে ধরা হয়নি।`;
  return s;
}

// ── আজকের হিসাব ───────────────────────────────────────────────

/** "আজ বিক্রি … বাকি দিলাম … জমা পেলাম … খরচ … হাতে থাকার কথা … টাকা।" */
export function daySummaryWords(f: CashFlows, expectedPoisha: number): string {
  let s = `আজ বিক্রি ${say(f.sales)} টাকা। বাকি দিলাম ${say(f.bakiGiven)}। জমা পেলাম ${say(f.joma)}। খরচ ${say(f.expenses)}।`;
  if (f.cashPurchases) s += ` মাল কেনা ${say(f.cashPurchases)}।`;
  if (f.withdrawals) s += ` মালিক নিল ${say(f.withdrawals)}।`;
  return `${s} হাতে থাকার কথা ${say(expectedPoisha)} টাকা।`;
}
