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

import { parseCommand, shouldEscalate } from '../src/parser';
import type { Intent, ParseContext, ParsedCommand, Unit } from '../src/parser/types';
import type { Expected, ExpectedItem, Fixture, Seed, Tab } from './eval-types';

// ── setup ──────────────────────────────────────────────────────

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/** Newest stable Flash-Lite per ai.google.dev/gemini-api/docs/models (Nov 2026). */
const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
/** Free tier is ~15 requests/min: keep ≥ 4.5 s between calls. */
const DELAY_MS = 4500;
/** 429 and 503 are retried up to 3×: 429 waits the error's retryDelay, 503 backs off 2 s, 5 s, 10 s. */
const MAX_RETRIES = 3;
const BACKOFF_503_MS = [2000, 5000, 10_000];

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

const allFixtures: Fixture[] = readFileSync(join(ROOT, 'eval/fixtures.jsonl'), 'utf8')
  .split('\n')
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l) as Fixture);
/** status "review" = expected is only a draft; not run or scored until labelled. */
const unlabelled = allFixtures.filter((f) => f.status === 'review');
const fixtures = allFixtures.filter((f) => f.status !== 'review').slice(0, limit);
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
    .map((p) => {
      const spellings = [p.name, ...Object.entries(seed.aliases).filter(([, v]) => v === p.name).map(([k]) => k)];
      const score = Math.max(
        ...spellings.map((n) => (nfc(text).includes(n) ? 1 : Math.max(...windows.map((w) => dice(w, n))))),
      );
      return { p, score };
    })
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
- customer: use the given customer name when it matches (drop ভাই/আপা/সাহেব).
- "<name> <amount> টাকা বাকি", "<name>-এর নামে <amount> টাকা বাকি লেখেন" (money only, no goods) = intent baki, credit false, items [].
- credit = true only when goods are taken on বাকি (a sale with items).
- Keep quantity and unit exactly as spoken (টা/টি/একটা = piece); never convert kg ↔ litre or g ↔ kg. unit "none" if no unit was said.
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
  ['মিনা আপা তিনশো টাকা বাকি', { intent: 'baki', customer: 'মিনা', credit: false, amount: 300, item: null, person: null, note: null, items: [] }],
  ['রশিদের নামে আটশো টাকা বাকি লেখেন', { intent: 'baki', customer: 'রশিদ', credit: false, amount: 800, item: null, person: null, note: null, items: [] }],
  ['মিজান সাতশো টাকা জমা দিল', { intent: 'joma', customer: 'মিজান', credit: false, amount: 700, item: null, person: null, note: null, items: [] }],
  ['গ্যাস বিল আটশো টাকা খরচ', { intent: 'expense', customer: null, credit: false, amount: 800, item: 'গ্যাস বিল', person: null, note: null, items: [] }],
  ['আব্বু তিনশো টাকা নিল ওষুধের জন্য', { intent: 'owner_withdrawal', customer: null, credit: false, amount: 300, item: null, person: 'আব্বু', note: 'ওষুধের জন্য', items: [] }],
];

function userText(f: Fixture): string {
  const also = (name: string) => Object.entries(seed.aliases).filter(([, v]) => v === name).map(([k]) => k);
  const products = topProducts(f.text)
    .map((p) => `${p.name} (${p.unit}${also(p.name).length ? `; also said ${also(p.name).join('/')}` : ''})`)
    .join(', ');
  return `transcript: ${f.text}\ntab: ${f.tab}\nproducts: ${products}\ncustomers: ${seed.customers.slice(0, 10).join(', ')}`;
}

interface GeminiItem { product: string | null; quantity: number | null; unit: string; unitPrice: number | null; total: number | null }
interface GeminiOut {
  intent: Intent; customer: string | null; credit: boolean; amount: number | null;
  item: string | null; person: string | null; items: GeminiItem[];
}
interface Call {
  out: GeminiOut | null;
  /** HTTP/API failure (rate limit, quota, network): not counted as a parse failure. */
  apiError?: string;
  /** The model answered but not with usable JSON: a parse failure. */
  error?: string;
  ms: number; promptTokens: number; outputTokens: number; thoughtTokens: number;
}

/** "12s" / "1.5s" from google.rpc.RetryInfo; fallback 10 s. */
function retryDelayMs(body: unknown): number {
  const details = (body as { error?: { details?: { retryDelay?: string }[] } } | null)?.error?.details ?? [];
  const d = details.find((x) => typeof x.retryDelay === 'string')?.retryDelay;
  const secs = d ? Number.parseFloat(d) : NaN;
  return Number.isFinite(secs) ? Math.ceil(secs * 1000) + 500 : 10_000;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Network failure → a 599 response, so it is reported as an API error. */
const fetchOrNull = (url: string, init: RequestInit): Promise<Response> =>
  fetch(url, init).catch((e: unknown) => new Response(JSON.stringify({ error: { message: String(e) } }), { status: 599 }));

async function callGemini(f: Fixture, attempt = 0): Promise<Call> {
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
  const res = await fetchOrNull(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
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
  if ((res.status === 429 || res.status === 503) && attempt < MAX_RETRIES) {
    const wait = res.status === 429 ? retryDelayMs(body) : BACKOFF_503_MS[attempt]!;
    process.stdout.write(`\n  ${res.status}, waiting ${(wait / 1000).toFixed(1)} s (retry ${attempt + 1}/${MAX_RETRIES})`);
    await sleep(wait);
    return callGemini(f, attempt + 1);
  }
  if (!res.ok) return { out: null, apiError: `HTTP ${res.status}: ${body?.error?.message ?? 'no body'}`, ms, ...usage };
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

interface Row extends Fixture {
  rule: { out: Norm; fails: string[]; confidence: 'high' | 'low'; lowReasons?: string[] };
  /** fails is null on an API error (excluded from pass %). */
  gemini?: Omit<Call, 'out'> & { out: Norm | null; fails: string[] | null };
  /** Rule result when confident, else Gemini's. null = escalated but Gemini had an API error. */
  hybrid?: { from: 'rule' | 'gemini'; fails: string[] | null };
}

async function main() {
  const ctx = (tab: Tab): ParseContext => ({
    tab,
    knownProducts: seed.products.map((p) => p.name),
    knownCustomers: seed.customers,
    productAliases: seed.aliases,
  });
  console.log(`${fixtures.length} cases · rule parser${ruleOnly ? '' : ` vs ${model}`}\n`);
  const rows: Row[] = [];
  for (const [k, f] of fixtures.entries()) {
    const parsed = parseCommand(f.text, ctx(f.tab));
    const ruleOut = fromRule(parsed);
    const row: Row = {
      ...f,
      rule: { out: ruleOut, fails: diff(f.expected, ruleOut), confidence: parsed.confidence, lowReasons: parsed.lowReasons },
    };
    if (!ruleOnly) {
      if (k > 0) await sleep(DELAY_MS);
      const { out: raw, ...c } = await callGemini(f);
      const out = raw ? fromGemini(raw) : null;
      const fails = c.apiError ? null : out ? diff(f.expected, out) : ['bad_json'];
      row.gemini = { ...c, out, fails };
      row.hybrid = shouldEscalate(parsed) ? { from: 'gemini', fails } : { from: 'rule', fails: row.rule.fails };
      process.stdout.write(`\r  ${k + 1}/${fixtures.length}`);
    }
    rows.push(row);
  }
  if (!ruleOnly) process.stdout.write('\n\n');

  // pass % overall and per source; API errors are left out of the denominator
  const pct = (xs: Row[], pick: (r: Row) => string[] | null | undefined) => {
    const scored = xs.filter((r) => pick(r) != null);
    if (!scored.length) return '—';
    const ok = scored.filter((r) => pick(r)!.length === 0).length;
    return `${Math.round((ok / scored.length) * 100)}% ${ok}/${scored.length}`;
  };
  const groups: [string, Row[]][] = [
    ['all', rows],
    ['new', rows.filter((r) => r.source === 'new')],
    ['tests', rows.filter((r) => r.source === 'tests')],
    // held out: real shop commands, never used to write parser rules
    ['pilot', rows.filter((r) => r.source === 'pilot')],
    ['  edited', rows.filter((r) => r.source === 'pilot' && r.edited)],
  ];
  console.log('pass %          rule           gemini         hybrid');
  for (const [name, xs] of groups) {
    if (name === '  edited' && !xs.length) continue;
    const cols = [pct(xs, (r) => r.rule.fails), ruleOnly ? '—' : pct(xs, (r) => r.gemini?.fails), ruleOnly ? '—' : pct(xs, (r) => r.hybrid?.fails)];
    console.log(`  ${`${name} (${xs.length})`.padEnd(14)}${cols.map((c) => c.padEnd(15)).join('')}`);
  }
  const pilotNow = rows.filter((r) => r.source === 'pilot');
  if (pilotNow.length)
    console.log(
      `\npilot = held-out score. "edited" = the shopkeeper fixed the confirm card, i.e. the app's parser was wrong then;` +
        ` the other pilot cases were accepted as parsed, so they mostly catch regressions.`,
    );
  if (unlabelled.length) {
    const byIntent = new Map<string, number>();
    for (const f of unlabelled) byIntent.set(f.expected.intent, (byIntent.get(f.expected.intent) ?? 0) + 1);
    console.log(
      `\nnot scored: ${unlabelled.length} cases with status "review" (draft label: ${[...byIntent].map(([i, n]) => `${i} ${n}`).join(', ')}).` +
        ` Label them in eval/fixtures.jsonl and delete "status" to count them.`,
    );
  }
  const low = rows.filter((r) => r.rule.confidence === 'low');
  const lowWrong = low.filter((r) => r.rule.fails.length).length;
  const highWrong = rows.filter((r) => r.rule.confidence === 'high' && r.rule.fails.length).length;
  console.log(
    `\nrule confidence: ${low.length}/${rows.length} low → hybrid asks Gemini ${low.length}× ` +
      `(low & wrong ${lowWrong}, low & right ${low.length - lowWrong}; high & wrong ${highWrong})`,
  );

  // cases with any failure
  const mark = (f?: string[] | null) => (f === undefined ? '' : f === null ? 'API error' : f.length ? `✗ ${f.join(', ')}` : '✓');
  const shown = rows.filter((r) => r.rule.fails.length || r.gemini?.fails?.length || r.hybrid?.fails?.length);
  if (shown.length) console.log(`\ncases with a failure (${shown.length}):`);
  for (const r of shown) {
    console.log(`\n  “${r.text}” [${r.source}, ${r.tab}]`);
    console.log(`    rule   ${mark(r.rule.fails)}  (${r.rule.confidence}${r.rule.lowReasons ? `: ${r.rule.lowReasons.join(', ')}` : ''})`);
    if (r.gemini) console.log(`    gemini ${mark(r.gemini.fails)}${r.gemini.error ? ` (${r.gemini.error})` : ''}`);
    if (r.hybrid) console.log(`    hybrid ${mark(r.hybrid.fails)} (from ${r.hybrid.from})`);
  }

  // Gemini cost/latency (successful calls only)
  const calls = rows.map((r) => r.gemini).filter((g): g is NonNullable<Row['gemini']> => !!g && !g.apiError);
  if (calls.length) {
    const avg = (f: (g: (typeof calls)[number]) => number) => Math.round(calls.reduce((s, g) => s + f(g), 0) / calls.length);
    const sorted = calls.map((g) => g.ms).sort((a, b) => a - b);
    console.log(
      `\ngemini ${model}: ${calls.length} calls · avg tokens in ${avg((g) => g.promptTokens)} / out ${avg((g) => g.outputTokens)}` +
        ` / thinking ${avg((g) => g.thoughtTokens)} · latency avg ${avg((g) => g.ms)} ms, p50 ${sorted[Math.floor(sorted.length / 2)]} ms, max ${sorted.at(-1)} ms`,
    );
  }
  const apiErrors = rows.filter((r) => r.gemini?.apiError);
  if (apiErrors.length) {
    console.log(`\nAPI errors (not counted as failures): ${apiErrors.length}`);
    for (const r of apiErrors) console.log(`  “${r.text}”: ${r.gemini!.apiError}`);
  }

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
