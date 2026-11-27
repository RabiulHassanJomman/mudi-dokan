/**
 * Android parsing: the four fixed sentence formats (docs/PLAN.md › Android parsing).
 * The keyword picks the type; the number next to টাকা is the one total.
 *
 *   বাকি   "সাজু বাকি নিয়েছে আদা, চাল, আটা ১০০ টাকা"
 *          "সাজু বাকি ১০০ টাকা" (goods may be left out)
 *   নগদ   "নগদ বিক্রি আদা, চাল ১০০ টাকা"
 *   কেনা   "১০০০ টাকার আলু কেনা হয়েছে"
 *   জমা    "সাজু ৫০ টাকা জমা দিয়েছে"
 *
 * Nothing is guessed: anything missing or doubled is a problem, and the app asks again.
 * Pure TS, separate from parseCommand (typed text).
 */
import * as K from './keywords';
import { tokenize } from './normalize';
import { parseNumber } from './numbers';
import { fixSpelling } from './spelling';
import { nfc, wordSet } from './util';

export type FixedKind = 'baki' | 'cash_sale' | 'purchase' | 'joma';

export type FixedProblem =
  | 'no_match' // no type keyword
  | 'two_types'
  | 'no_customer'
  | 'no_goods'
  | 'many_goods' // কেনা takes one product
  | 'no_amount'
  | 'two_amounts';

export interface FixedCommand {
  /** null with no_match / two_types. */
  kind: FixedKind | null;
  customer?: string;
  /** In spoken order. Known names and aliases become the product's name; the rest is as spoken. */
  goods: string[];
  /** Total taka. */
  amount?: number;
  /** Empty = complete, ready for the confirm card. */
  problems: FixedProblem[];
  raw: string;
  normalized: string;
}

export interface FixedContext {
  knownProducts?: readonly string[];
  /** Spoken name → product name (product_aliases). */
  productAliases?: Readonly<Record<string, string>>;
  knownCustomers?: readonly string[];
}

const KIND_WORDS: readonly (readonly [FixedKind, ReadonlySet<string>])[] = [
  ['baki', wordSet([...K.BAKI, ...K.CREDIT])],
  ['cash_sale', wordSet(['নগদ', 'নগদে', 'নগদা'])],
  ['purchase', K.PURCHASE],
  ['joma', K.JOMA],
];

const kindOf = (t: string): FixedKind | undefined => KIND_WORDS.find(([, words]) => words.has(t))?.[0];

/** The sentence's verbs and glue: neither a name nor goods. */
const VERBS = wordSet([
  ...K.TAKE, ...K.GAVE, ...K.SALE, ...K.TODAY, 'নিয়েছেন', 'দিয়েছেন', 'নিলেন', 'দিলেন', 'বিক্রিতে',
  'হয়েছে', 'হইছে', 'হলো', 'হল', 'হয়', 'করলাম', 'করেছি', 'করেছে', 'করল', 'করলো', 'করলেন', 'করেছেন', 'করা',
  'দিলাম', 'দিয়েছি', 'দিছি', 'দিয়ে', 'গেল', 'গেলো', 'গেছে', 'নিলাম', 'নিয়েছি', 'নিছি',
  'মোট', 'টোটাল',
]);

/** Between two goods. */
const SEPARATORS = wordSet(['আর', 'এবং', 'ও']);

const CASE_SUFFIXES = ['কে', 'ের', 'র'].map(nfc);

interface Word {
  text: string;
  /** A comma or separator came before it: never joins the word before. */
  starts: boolean;
}

/** Tokens, remembering where the text had commas. */
function words(text: string): Word[] {
  // "1,500" stays one number
  return text
    .split(/[,،](?![0-9০-৯])|(?<![0-9০-৯])[,،]/)
    .flatMap((part) => tokenize(part).map((t, n) => ({ text: fixSpelling(t), starts: n === 0 })));
}

interface Taken {
  amounts: number[];
  rest: Word[];
}

/** Take out "<number> টাকা" (and "৳<number>"); other numbers stay in the words. */
function takeAmounts(all: readonly Word[]): Taken {
  const tokens = all.map((w) => w.text);
  const amounts: number[] = [];
  const rest: Word[] = [];
  const isMoney = (i: number) => K.MONEY.has(tokens[i] ?? '');
  let cut = false;
  const keep = (w: Word) => {
    rest.push(cut ? { ...w, starts: true } : w);
    cut = false;
  };
  for (let i = 0; i < tokens.length; ) {
    // "টাকা 100" (from ৳১০০), only when no number comes before the টাকা
    const prefixed = isMoney(i) ? parseNumber(tokens, i + 1) : null;
    if (prefixed) {
      amounts.push(prefixed.value);
      i += 1 + prefixed.consumed;
      cut = true;
      continue;
    }
    const num = parseNumber(tokens, i);
    if (num && isMoney(i + num.consumed)) {
      amounts.push(num.value);
      i += num.consumed + 1;
      cut = true;
      continue;
    }
    const n = num?.consumed ?? 1;
    all.slice(i, i + n).forEach(keep);
    i += n;
  }
  return { amounts, rest };
}

function customerName(ws: readonly Word[], known: readonly string[]): string | undefined {
  const ts = ws.map((w) => w.text).filter((t) => !VERBS.has(t) && !K.HONORIFIC_SET.has(t) && !SEPARATORS.has(t) && t !== 'কে');
  if (!ts.length) return undefined;
  const names = new Map(known.map((k) => [tokenize(k).join(' '), k.normalize('NFC')]));
  const spoken = ts.join(' ');
  const exact = names.get(spoken);
  if (exact) return exact;
  for (const suffix of CASE_SUFFIXES) {
    if (!spoken.endsWith(suffix)) continue;
    const stem = names.get(spoken.slice(0, -suffix.length));
    if (stem) return stem;
  }
  // an unknown name: only কে and ের come off ("সাগর" ends in র itself)
  for (const suffix of ['কে', 'ের'].map(nfc)) {
    if (spoken.length > suffix.length + 1 && spoken.endsWith(suffix)) return spoken.slice(0, -suffix.length);
  }
  return spoken;
}

/** Known names (longest first) split the words; the words between them stay together. */
function goodsList(ws: readonly Word[], ctx: FixedContext): string[] {
  const known = [
    ...(ctx.knownProducts ?? []).map((name) => [name, name] as const),
    ...Object.entries(ctx.productAliases ?? {}),
  ]
    .map(([spoken, name]) => ({ tokens: tokenize(spoken), name: name.normalize('NFC') }))
    .filter((k) => k.tokens.length > 0)
    .sort((a, b) => b.tokens.length - a.tokens.length);

  const out: string[] = [];
  let run: string[] = [];
  const flush = () => {
    if (run.length) out.push(run.join(' '));
    run = [];
  };
  for (let i = 0; i < ws.length; ) {
    const w = ws[i]!;
    if (w.starts) flush();
    if (VERBS.has(w.text) || SEPARATORS.has(w.text)) {
      flush();
      i++;
      continue;
    }
    const hit = known.find((k) => k.tokens.every((t, o) => ws[i + o]?.text === t && (o === 0 || !ws[i + o]!.starts)));
    if (hit) {
      flush();
      out.push(hit.name);
      i += hit.tokens.length;
      continue;
    }
    run.push(w.text);
    i++;
  }
  flush();
  return out;
}

export function parseFixed(text: string, ctx: FixedContext = {}): FixedCommand {
  const all = words(text);
  const base = { raw: text, normalized: all.map((w) => w.text).join(' ') };

  const kinds = new Set(all.map((w) => kindOf(w.text)).filter((k) => k !== undefined));
  const [kind] = kinds;
  // "সাজুর বাকি কত" asks, it doesn't write
  const question = all.some((w) => K.HOW_MUCH.has(w.text));
  if (!kind || question) return { kind: null, goods: [], problems: ['no_match'], ...base };
  if (kinds.size > 1) return { kind: null, goods: [], problems: ['two_types'], ...base };

  const { amounts, rest } = takeAmounts(all);
  const amount = amounts.length === 1 && amounts[0]! > 0 ? amounts[0] : undefined;
  const at = rest.findIndex((w) => kindOf(w.text) !== undefined);
  const without = (ws: readonly Word[]) => ws.filter((w) => kindOf(w.text) === undefined);
  const before = rest.slice(0, at);
  const after = without(rest.slice(at + 1));
  const customers = ctx.knownCustomers ?? [];

  let customer: string | undefined;
  let goods: string[] = [];
  if (kind === 'baki') {
    customer = customerName(before, customers);
    goods = goodsList(after, ctx);
  } else if (kind === 'cash_sale') {
    // before নগদ: the buyer, unless it is a product we know
    const early = goodsList(before, ctx);
    const products = new Set([...(ctx.knownProducts ?? []), ...Object.values(ctx.productAliases ?? {})].map((p) => p.normalize('NFC')));
    const earlyAreGoods = early.some((g) => products.has(g));
    if (!earlyAreGoods) customer = customerName(before, customers);
    goods = [...(earlyAreGoods ? early : []), ...goodsList(after, ctx)];
  } else if (kind === 'purchase') {
    goods = goodsList(without(rest), ctx);
  } else {
    customer = customerName(without(rest), customers);
  }

  const problems: FixedProblem[] = [];
  if ((kind === 'baki' || kind === 'joma') && !customer) problems.push('no_customer');
  // a বাকি may be only the name and the amount ("সাজু বাকি ১০০ টাকা")
  // only কেনা needs its product; বাকি and নগদ may be just the amount ("নগদ বিক্রি ১০০ টাকা")
  if (kind === 'purchase' && !goods.length) problems.push('no_goods');
  if (kind === 'purchase' && goods.length > 1) problems.push('many_goods');
  if (amounts.length > 1) problems.push('two_amounts');
  else if (amount === undefined) problems.push('no_amount');

  return { kind, ...(customer ? { customer } : {}), goods, ...(amount !== undefined ? { amount } : {}), problems, ...base };
}
