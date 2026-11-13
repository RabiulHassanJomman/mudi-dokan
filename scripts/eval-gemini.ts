/**
 * Offline eval: rule parser (src/parser) vs Gemini on eval/fixtures.jsonl.
 * Mac-only dev tool, never bundled in the app (lives outside src/).
 *
 *   GEMINI_API_KEY=... npx tsx scripts/eval-gemini.ts [--model <id>] [--rule-only] [--limit N]
 *
 * Writes eval/results/<timestamp>.json (gitignored).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseCommand } from '../src/parser';
import type { Intent, ParseContext, ParsedCommand, Unit } from '../src/parser/types';

// ── setup ──────────────────────────────────────────────────────

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/** Newest stable Flash-Lite per ai.google.dev/gemini-api/docs/models (Nov 2026). */
const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
const DELAY_MS = 600;

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const model = flag('--model') ?? DEFAULT_MODEL;
const ruleOnly = args.includes('--rule-only');
const limit = flag('--limit') ? Number(flag('--limit')) : Infinity;

const apiKey = process.env.GEMINI_API_KEY;
if (!ruleOnly && !apiKey) {
  console.error('GEMINI_API_KEY is not set.\n  export GEMINI_API_KEY=<key from aistudio.google.com>  (or run with --rule-only)');
  process.exit(1);
}

type Tab = NonNullable<ParseContext['tab']>;
type Source = 'new' | 'tests';

/** The fields we compare; same names as ParsedCommand. */
interface ExpectedItem {
  product?: string;
  quantity?: { value: number; unit?: Unit };
  unitPrice?: number;
  total?: number;
}
interface Expected {
  intent: Intent;
  customer?: string;
  credit?: boolean;
  amount?: number;
  items?: ExpectedItem[];
  item?: string;
  person?: string;
}
interface Fixture {
  text: string;
  tab: Tab;
  source: Source;
  expected: Expected;
}
interface Seed {
  products: { name: string; unit: Unit; price: number }[];
  customers: string[];
}

const fixtures: Fixture[] = readFileSync(join(ROOT, 'eval/fixtures.jsonl'), 'utf8')
  .split('\n')
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l) as Fixture)
  .slice(0, limit);
const seed = JSON.parse(readFileSync(join(ROOT, 'eval/seed.json'), 'utf8')) as Seed;

// ── fuzzy product match (top 15 for the prompt) ────────────────

const nfc = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim();
const bigrams = (s: string) => {
  const t = [...s.replace(/\s/g, '')];
  const out: string[] = [];
  for (let i = 0; i < t.length - 1; i++) out.push(t[i]! + t[i + 1]!);
  return out.length ? out : t;
};
function dice(a: string, b: string): number {
  const A = bigrams(a);
  const B = bigrams(b);
  const pool = [...B];
  let hit = 0;
  for (const x of A) {
    const j = pool.indexOf(x);
    if (j >= 0) {
      hit++;
      pool.splice(j, 1);
    }
  }
  return (2 * hit) / (A.length + B.length || 1);
}
function topProducts(text: string, n = 15) {
  const words = nfc(text).split(' ');
  const windows = [...words, ...words.slice(1).map((w, i) => `${words[i]} ${w}`)];
  return seed.products
    .map((p) => ({ p, score: nfc(text).includes(p.name) ? 1 : Math.max(...windows.map((w) => dice(w, p.name))) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .map((x) => x.p);
}

// ── Gemini ─────────────────────────────────────────────────────

const UNITS: Unit[] = ['kg', 'g', 'litre', 'ml', 'piece', 'packet', 'dozen', 'hali', 'bosta'];
const INTENTS: Intent[] = ['sale', 'purchase', 'baki', 'joma', 'expense', 'owner_withdrawal', 'stock_query', 'profit_query', 'unknown'];
const str = { type: ['string', 'null'] };
const num = { type: ['number', 'null'] };

/** ParseResult as JSON Schema (responseJsonSchema). Quantity is flattened; unit "none" = not said. */
const SCHEMA = {
  type: 'object',
  properties: {
    intent: { type: 'string', enum: INTENTS },
    customer: str,
    credit: { type: 'boolean' },
    amount: num,
    item: str,
    person: str,
    note: str,
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          product: str,
          quantity: num,
          unit: { type: 'string', enum: [...UNITS, 'none'] },
          unitPrice: num,
          total: num,
        },
        required: ['product', 'quantity', 'unit', 'unitPrice', 'total'],
      },
    },
  },
  required: ['intent', 'customer', 'credit', 'amount', 'item', 'person', 'items'],
};

const SYSTEM = `You parse one Bangla voice command from a grocery shop (Bangladesh) into JSON.
intent: sale (selling goods), purchase (shop buys stock: কিনলাম/কেনা), baki (customer owes money, no goods), joma (customer pays back: জমা/দিল/শোধ), expense (shop cost: বিল/ভাড়া/বেতন/নাস্তা/খরচ), owner_withdrawal (owner or family takes cash: মালিক/আব্বু/আম্মু নিল), stock_query, profit_query, unknown.
Rules:
- items only for sale; one entry per line in spoken order; the same product twice stays two lines.
- product: use ONLY a name from the given product list (map spelling variants and brand words to it, e.g. চাউল → চাল). If none fits, use the spoken word.
- customer: use the given customer name when it matches (drop ভাই/আপা/সাহেব). credit = true only for বাকি/বাকিতে sales.
- quantity in the spoken unit (টা/টি/একটা = piece). unit "none" if no unit was said.
- "X টাকা করে", "প্রতি কেজি X", "কেজি X করে", "X টাকা কেজি" = unitPrice; total = quantity × unitPrice.
- A plain "X টাকা" after a line = that line's total. "X টাকার <product>" = total with no quantity.
- NEVER invent prices: if no price was said, unitPrice and total are null. Do not use list prices.
- amount: for sale, the sum of line totals only if every line has a total, else null; for baki/joma/expense/owner_withdrawal, the taka said.
- person: who took cash (owner_withdrawal). item: what an expense was for. Numbers as digits (আড়াই = 2.5, দেড় = 1.5, আধা = 0.5).`;

const EXAMPLES: [string, unknown][] = [
  [
    'রাশেদ বাকিতে নিল আটা দুই কেজি একশো দশ টাকা আর ডিম ছয়টা',
    { intent: 'sale', customer: 'রাশেদ', credit: true, amount: null, item: null, person: null, note: null, items: [
      { product: 'আটা', quantity: 2, unit: 'kg', unitPrice: null, total: 110 },
      { product: 'ডিম', quantity: 6, unit: 'piece', unitPrice: null, total: null },
    ] },
  ],
  [
    'চার কেজি আলু পঁয়ত্রিশ টাকা করে',
    { intent: 'sale', customer: null, credit: false, amount: 140, item: null, person: null, note: null, items: [
      { product: 'আলু', quantity: 4, unit: 'kg', unitPrice: 35, total: 140 },
    ] },
  ],
  ['মিজান সাতশো টাকা জমা দিল', { intent: 'joma', customer: 'মিজান', credit: false, amount: 700, item: null, person: null, note: null, items: [] }],
  ['গ্যাস বিল আটশো টাকা খরচ', { intent: 'expense', customer: null, credit: false, amount: 800, item: 'গ্যাস বিল', person: null, note: null, items: [] }],
  ['আব্বু তিনশো টাকা নিল ওষুধের জন্য', { intent: 'owner_withdrawal', customer: null, credit: false, amount: 300, item: null, person: 'আব্বু', note: 'ওষুধের জন্য', items: [] }],
];

function userText(f: Fixture): string {
  const products = topProducts(f.text).map((p) => `${p.name} (${p.unit})`).join(', ');
  return `transcript: ${f.text}\ntab: ${f.tab}\nproducts: ${products}\ncustomers: ${seed.customers.slice(0, 10).join(', ')}`;
}

interface GeminiItem { product: string | null; quantity: number | null; unit: string; unitPrice: number | null; total: number | null }
interface GeminiOut {
  intent: Intent; customer: string | null; credit: boolean; amount: number | null;
  item: string | null; person: string | null; items: GeminiItem[];
}
interface Call { out: GeminiOut | null; error?: string; ms: number; promptTokens: number; outputTokens: number; thoughtTokens: number }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function callGemini(f: Fixture, retry = true): Promise<Call> {
  // Gemini 3 can't turn thinking fully off; "minimal" is the lowest. 2.x takes a 0 budget.
  const thinkingConfig = /^gemini-2/.test(model) ? { thinkingBudget: 0 } : { thinkingLevel: 'minimal' };
  const contents = [
    ...EXAMPLES.flatMap(([t, o]) => [
      { role: 'user', parts: [{ text: `transcript: ${t}\ntab: sale` }] },
      { role: 'model', parts: [{ text: JSON.stringify(o) }] },
    ]),
    { role: 'user', parts: [{ text: userText(f) }] },
  ];
  const t0 = Date.now();
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey! },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents,
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
        responseJsonSchema: SCHEMA,
        thinkingConfig,
      },
    }),
  });
  const ms = Date.now() - t0;
  if (res.status === 429 && retry) {
    const wait = Number(res.headers.get('retry-after') ?? 0) * 1000 || 5000;
    console.warn(`  429, retrying once in ${wait / 1000}s`);
    await sleep(wait);
    return callGemini(f, false);
  }
  const body = (await res.json().catch(() => null)) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
    error?: { message?: string };
  } | null;
  const usage = {
    promptTokens: body?.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: body?.usageMetadata?.candidatesTokenCount ?? 0,
    thoughtTokens: body?.usageMetadata?.thoughtsTokenCount ?? 0,
  };
  if (!res.ok) return { out: null, error: `HTTP ${res.status}: ${body?.error?.message ?? 'no body'}`, ms, ...usage };
  const text = body?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  try {
    return { out: JSON.parse(text) as GeminiOut, ms, ...usage };
  } catch {
    return { out: null, error: `bad JSON: ${text.slice(0, 200)}`, ms, ...usage };
  }
}

// ── normalize both sides to the compared shape ─────────────────

interface Norm {
  intent: Intent;
  customer: string | null;
  credit: boolean;
  amount: number | null;
  items: ExpectedItem[];
  item: string | null;
  person: string | null;
}

const clean = <T>(o: T): T => JSON.parse(JSON.stringify(o)) as T; // drops undefined

function fromRule(p: ParsedCommand): Norm {
  return {
    intent: p.intent,
    customer: p.customer ?? null,
    credit: p.credit === true,
    amount: p.amount ?? null,
    items: (p.items ?? []).map((i) => clean({ product: i.product, quantity: i.quantity, unitPrice: i.unitPrice, total: i.total })),
    item: p.item ?? null,
    person: p.person ?? null,
  };
}

function fromGemini(g: GeminiOut): Norm {
  return {
    intent: g.intent,
    customer: g.customer || null,
    credit: g.credit === true,
    amount: g.amount ?? null,
    items: (g.intent === 'sale' ? g.items ?? [] : []).map((i) =>
      clean({
        product: i.product ?? undefined,
        quantity:
          i.quantity === null ? undefined : { value: i.quantity, unit: i.unit === 'none' ? undefined : (i.unit as Unit) },
        unitPrice: i.unitPrice ?? undefined,
        total: i.total ?? undefined,
      }),
    ),
    item: g.item || null,
    person: g.person || null,
  };
}

// ── compare ────────────────────────────────────────────────────

const near = (a: number | null | undefined, b: number | null | undefined) =>
  (a ?? null) === null || (b ?? null) === null ? (a ?? null) === (b ?? null) : Math.abs(a! - b!) < 0.011;
const sameName = (a?: string | null, b?: string | null) => nfc(a ?? '') === nfc(b ?? '');

/**
 * Field by field. Always compared: intent, customer, credit (baki), items, amount — an
 * absent expected value must be absent in the output too (no invented prices or names).
 * item/person are compared only when the fixture gives them. unitPrice only when expected.
 */
function diff(e: Expected, n: Norm): string[] {
  const bad: string[] = [];
  if (e.intent !== n.intent) bad.push('intent');
  if (!sameName(e.customer, n.customer)) bad.push('customer');
  if ((e.credit === true) !== n.credit) bad.push('credit');
  if (!near(e.amount, n.amount)) bad.push('amount');
  const ei = e.items ?? [];
  if (ei.length !== n.items.length) bad.push(`items.length`);
  else
    ei.forEach((x, k) => {
      const y = n.items[k]!;
      if (!sameName(x.product, y.product)) bad.push(`items[${k}].product`);
      if (!near(x.quantity?.value, y.quantity?.value) || (x.quantity?.unit ?? null) !== (y.quantity?.unit ?? null))
        bad.push(`items[${k}].quantity`);
      if (!near(x.total, y.total)) bad.push(`items[${k}].total`);
      if (x.unitPrice !== undefined && !near(x.unitPrice, y.unitPrice)) bad.push(`items[${k}].unitPrice`);
    });
  if (e.item !== undefined && !sameName(e.item, n.item)) bad.push('item');
  if (e.person !== undefined && !sameName(e.person, n.person)) bad.push('person');
  return bad;
}

// ── run ────────────────────────────────────────────────────────

interface Row {
  text: string; tab: Tab; source: Source; expected: Expected;
  rule: { out: Norm; fails: string[] };
  gemini?: { out: Norm | null; fails: string[]; error?: string; ms: number; promptTokens: number; outputTokens: number; thoughtTokens: number };
}

async function main() {
  const ctx = (tab: Tab): ParseContext => ({
    tab,
    knownProducts: seed.products.map((p) => p.name),
    knownCustomers: seed.customers,
  });
  console.log(`${fixtures.length} cases · rule parser${ruleOnly ? '' : ` vs ${model}`}\n`);
  const rows: Row[] = [];
  for (const [k, f] of fixtures.entries()) {
    const ruleOut = fromRule(parseCommand(f.text, ctx(f.tab)));
    const row: Row = { ...f, rule: { out: ruleOut, fails: diff(f.expected, ruleOut) } };
    if (!ruleOnly) {
      if (k > 0) await sleep(DELAY_MS);
      const c = await callGemini(f);
      const out = c.out ? fromGemini(c.out) : null;
      row.gemini = { ...c, out, fails: out ? diff(f.expected, out) : ['error'] };
      process.stdout.write(`\r  ${k + 1}/${fixtures.length}`);
    }
    rows.push(row);
  }
  if (!ruleOnly) process.stdout.write('\n\n');

  // pass % overall and per source
  const pct = (xs: Row[], pick: (r: Row) => string[] | undefined) =>
    xs.length ? `${Math.round((xs.filter((r) => pick(r)?.length === 0).length / xs.length) * 100)}%` : '—';
  const groups: [string, Row[]][] = [
    ['all', rows],
    ['new', rows.filter((r) => r.source === 'new')],
    ['tests', rows.filter((r) => r.source === 'tests')],
  ];
  console.log('pass %        rule     gemini');
  for (const [name, xs] of groups) {
    console.log(`  ${`${name} (${xs.length})`.padEnd(12)}${pct(xs, (r) => r.rule.fails).padEnd(9)}${ruleOnly ? '—' : pct(xs, (r) => r.gemini?.fails)}`);
  }

  // cases where they differ (or, rule-only: every rule failure)
  const shown = rows.filter((r) =>
    ruleOnly ? r.rule.fails.length : r.rule.fails.length !== 0 || (r.gemini?.fails.length ?? 0) !== 0,
  );
  if (shown.length) console.log(`\ncases with a failure (${shown.length}):`);
  for (const r of shown) {
    const mark = (f?: string[]) => (f === undefined ? '' : f.length ? `✗ ${f.join(', ')}` : '✓');
    console.log(`\n  “${r.text}” [${r.source}, ${r.tab}]`);
    console.log(`    rule   ${mark(r.rule.fails)}`);
    if (r.gemini) console.log(`    gemini ${mark(r.gemini.fails)}${r.gemini.error ? ` (${r.gemini.error})` : ''}`);
  }

  // Gemini cost/latency
  const calls = rows.map((r) => r.gemini).filter((g): g is NonNullable<Row['gemini']> => !!g && !g.error);
  if (calls.length) {
    const avg = (f: (g: (typeof calls)[number]) => number) => Math.round(calls.reduce((s, g) => s + f(g), 0) / calls.length);
    const sorted = calls.map((g) => g.ms).sort((a, b) => a - b);
    console.log(
      `\ngemini ${model}: ${calls.length} ok calls · avg tokens in ${avg((g) => g.promptTokens)} / out ${avg((g) => g.outputTokens)}` +
        ` / thinking ${avg((g) => g.thoughtTokens)} · latency avg ${avg((g) => g.ms)} ms, p50 ${sorted[Math.floor(sorted.length / 2)]} ms, max ${sorted.at(-1)} ms`,
    );
  }
  const errors = rows.filter((r) => r.gemini?.error).length;
  if (errors) console.log(`gemini errors: ${errors}`);

  const dir = join(ROOT, 'eval/results');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, JSON.stringify({ model: ruleOnly ? null : model, at: new Date().toISOString(), rows }, null, 1));
  console.log(`\nwrote ${file.slice(ROOT.length + 1)}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
