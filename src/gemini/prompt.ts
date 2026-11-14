/**
 * Gemini prompt, few-shot examples and response schema. Pure TS, shared by the app
 * (audio) and the offline eval (scripts/eval-gemini.ts: text and --audio).
 */
import type { Intent, Unit } from '../parser/types';

export const UNITS: readonly Unit[] = ['kg', 'g', 'litre', 'ml', 'piece', 'packet', 'dozen', 'hali', 'bosta'];
export const INTENTS: readonly Intent[] = [
  'sale',
  'purchase',
  'baki',
  'joma',
  'expense',
  'owner_withdrawal',
  'stock_query',
  'balance_query',
  'total_baki_query',
  'profit_query',
  'unknown',
];

const str = { type: ['string', 'null'] };
const num = { type: ['number', 'null'] };
const unit = { type: 'string', enum: [...UNITS, 'none'] };

/**
 * ParseResult as JSON Schema (generationConfig.responseJsonSchema). Quantity is flattened;
 * unit "none" = not said. Top-level product/quantity/unit/buyPrice/sellPrice are for
 * purchase and stock_query (a sale uses items). `transcript` only in audio mode.
 */
export function responseSchema(withTranscript: boolean) {
  const properties: Record<string, unknown> = {
    ...(withTranscript ? { transcript: { type: 'string' } } : {}),
    intent: { type: 'string', enum: [...INTENTS] },
    customer: str,
    credit: { type: 'boolean' },
    amount: num,
    item: str,
    person: str,
    note: str,
    product: str,
    quantity: num,
    unit,
    buyPrice: num,
    sellPrice: num,
    isNewProduct: { type: 'boolean' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: { product: str, quantity: num, unit, unitPrice: num, total: num },
        required: ['product', 'quantity', 'unit', 'unitPrice', 'total'],
      },
    },
  };
  return {
    type: 'object',
    properties,
    required: [...(withTranscript ? ['transcript'] : []), 'intent', 'customer', 'credit', 'amount', 'item', 'person', 'items'],
  };
}

export const SYSTEM = `You parse one Bangla voice command from a grocery shop (Bangladesh) into JSON.
intent: sale (selling goods), purchase (shop buys stock: কিনলাম/কেনা), baki (customer owes money, no goods), joma (customer pays back: জমা/দিল/শোধ), expense (shop cost: বিল/ভাড়া/বেতন/নাস্তা/খরচ), owner_withdrawal (the owner takes cash: "মালিক" or a name in "owners" + নিল/নিয়েছে), stock_query (চাল কত আছে?), balance_query (one named customer: করিমের বাকি কত?), total_baki_query (all customers together, no name: মোট কত বাকি? সবার বাকি কত? বাকি কত টাকা পাওনা?), profit_query (লাভ কত?), unknown.
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
- amount: for sale, the sum of line totals only if every line has a total, else null; for baki/joma/expense/owner_withdrawal, the taka said; for purchase, the total paid only if a total was said.
- purchase and stock_query: product, quantity, unit at the top level (items []). buyPrice / sellPrice = per-unit prices said with কেনা / বেচা; isNewProduct = true when "নতুন" was said.
- No intent word: use the open tab (sale → sale, purchase → purchase, expense → expense, ledger → baki or joma).
- First person taking cash ("৩০০ টাকা নিলাম", "৫০০ তুললাম", no name): if this phone's role is owner → owner_withdrawal with person = this phone's name; otherwise expense, item "অগ্রিম বেতন", person = this phone's name.
- person: who took cash (owner_withdrawal). item: what an expense was for. Numbers as digits (আড়াই = 2.5, দেড় = 1.5, আধা = 0.5).`;

/** Extra rules when Gemini gets the recorded clip instead of a transcript. */
export const AUDIO_RULES = `
You get the recorded audio of the command. Listen to it and fill transcript with exactly what was said, in Bangla script (numbers as spoken words). Parse what was said in the audio, not the examples. If the audio has no speech, transcript "" and intent unknown.`;

const NULLS = { customer: null, credit: false, amount: null, item: null, person: null, note: null, items: [] };

/** Few-shot: [spoken text, expected output without transcript]. */
export const EXAMPLES: [string, Record<string, unknown>][] = [
  [
    'রাশেদ বাকিতে নিল আটা দুই কেজি একশো দশ টাকা আর ডিম ছয়টা',
    { intent: 'sale', ...NULLS, customer: 'রাশেদ', credit: true, items: [
      { product: 'আটা', quantity: 2, unit: 'kg', unitPrice: null, total: 110 },
      { product: 'ডিম', quantity: 6, unit: 'piece', unitPrice: null, total: null },
    ] },
  ],
  [
    'চার কেজি আলু পঁয়ত্রিশ টাকা করে',
    { intent: 'sale', ...NULLS, amount: 140, items: [{ product: 'আলু', quantity: 4, unit: 'kg', unitPrice: 35, total: 140 }] },
  ],
  ['মিনা আপা তিনশো টাকা বাকি', { intent: 'baki', ...NULLS, customer: 'মিনা', amount: 300 }],
  ['রশিদের নামে আটশো টাকা বাকি লেখেন', { intent: 'baki', ...NULLS, customer: 'রশিদ', amount: 800 }],
  ['সবার বাকি কত', { intent: 'total_baki_query', ...NULLS }],
  ['মিজান সাতশো টাকা জমা দিল', { intent: 'joma', ...NULLS, customer: 'মিজান', amount: 700 }],
  ['গ্যাস বিল আটশো টাকা খরচ', { intent: 'expense', ...NULLS, amount: 800, item: 'গ্যাস বিল' }],
  ['মালিক তিনশো টাকা নিল ওষুধের জন্য', { intent: 'owner_withdrawal', ...NULLS, amount: 300, person: 'মালিক', note: 'ওষুধের জন্য' }],
  [
    'নতুন মসুর ডাল বিশ কেজি কেনা একশো দশ বেচা একশো বিশ',
    { intent: 'purchase', ...NULLS, product: 'মসুর ডাল', quantity: 20, unit: 'kg', buyPrice: 110, sellPrice: 120, isNewProduct: true },
  ],
];

export type Tab = 'sale' | 'purchase' | 'ledger' | 'stock' | 'expense';

/** What the model is told about the shop (built from the DB in the app, from eval/seed.json in the eval). */
export interface PromptContext {
  tab: Tab;
  /** ≤ 15, most likely first. */
  products: { name: string; unit: Unit; aliases: string[] }[];
  /** ≤ 15. */
  customers: string[];
  /** Customer name → learned spellings (customer_aliases). */
  customerAliases?: Record<string, string[]>;
  device?: { name: string; role: 'owner' | 'staff' | null };
  /** device_name of the shop's মালিক phones (besides the word "মালিক"). */
  owners?: string[];
}

export function contextText(c: PromptContext): string {
  const products = c.products
    .map((p) => `${p.name} (${p.unit}${p.aliases.length ? `; also said ${p.aliases.join('/')}` : ''})`)
    .join(', ');
  const customers = c.customers
    .map((n) => (c.customerAliases?.[n]?.length ? `${n} (also said ${c.customerAliases[n]!.join('/')})` : n))
    .join(', ');
  const lines = [`tab: ${c.tab}`, `products: ${products}`, `customers: ${customers}`];
  if (c.owners?.length) lines.push(`owners: ${c.owners.join(', ')}`);
  if (c.device) lines.push(`this phone: ${c.device.name}, role ${c.device.role ?? 'unset'}`);
  return lines.join('\n');
}

export type Input = { text: string } | { audio: { mimeType: string; base64: string } };

/** generateContent request body. Gemini 3 can't turn thinking fully off: "minimal"; 2.x: budget 0. */
export function buildRequest(model: string, input: Input, ctx: PromptContext) {
  const audio = 'audio' in input;
  const thinkingConfig = /^gemini-2/.test(model) ? { thinkingBudget: 0 } : { thinkingLevel: 'minimal' };
  const contents = [
    ...EXAMPLES.flatMap(([t, o]) => [
      { role: 'user', parts: [{ text: `${audio ? 'example, said' : 'transcript'}: ${t}\ntab: sale` }] },
      { role: 'model', parts: [{ text: JSON.stringify(audio ? { transcript: t, ...o } : o) }] },
    ]),
    {
      role: 'user',
      parts: audio
        ? [{ inlineData: { mimeType: input.audio.mimeType, data: input.audio.base64 } }, { text: `audio: the command above\n${contextText(ctx)}` }]
        : [{ text: `transcript: ${input.text}\n${contextText(ctx)}` }],
    },
  ];
  return {
    systemInstruction: { parts: [{ text: audio ? SYSTEM + AUDIO_RULES : SYSTEM }] },
    contents,
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      responseJsonSchema: responseSchema(audio),
      thinkingConfig,
    },
  };
}
