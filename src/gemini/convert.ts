/**
 * Gemini's JSON → the app's ParsedCommand, checked like rule-parser output. Pure TS.
 *
 * - schema: wrong types, an unknown intent or unit, negative numbers → GeminiOutputError
 *   (the app then falls back to the Android result).
 * - names: products go through the aliases to the product's name; a name in neither the
 *   product list nor the aliases is kept as spoken and marks the result "low" (the confirm
 *   card offers the closest names, as for the rule parser).
 * - money: line totals are recomputed (quantity × unitPrice), the basket amount is the sum
 *   of line totals, never the model's.
 * - missing fields: same rules as the rule parser, so the confirm card asks the same way.
 */
import { tokenize } from '../parser/normalize';
import type { Field, Intent, LowReason, ParsedCommand, Quantity, SaleItem, Unit } from '../parser/types';
import { INTENTS, UNITS } from './prompt';

export class GeminiOutputError extends Error {}

export interface ConvertContext {
  knownProducts: readonly string[];
  /** Spoken name → product name. */
  productAliases: Readonly<Record<string, string>>;
  /** Learned spelling → customer name (customer_aliases). */
  customerAliases?: Readonly<Record<string, string>>;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const nfc = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim();

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

function str(o: Obj, k: string): string | undefined {
  const v = o[k];
  if (v === null || v === undefined) return undefined;
  if (typeof v !== 'string') throw new GeminiOutputError(`${k}: not a string`);
  return nfc(v) || undefined;
}
function num(o: Obj, k: string, positive = false): number | undefined {
  const v = o[k];
  if (v === null || v === undefined) return undefined;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new GeminiOutputError(`${k}: not a number ≥ 0`);
  if (positive && v === 0) return undefined;
  return v;
}
function unitOf(o: Obj, k = 'unit'): Unit | undefined {
  const v = o[k];
  if (v === null || v === undefined || v === 'none') return undefined;
  if (typeof v !== 'string' || !(UNITS as readonly string[]).includes(v)) throw new GeminiOutputError(`${k}: unknown unit ${String(v)}`);
  return v as Unit;
}
const qty = (value: number | undefined, unit: Unit | undefined): Quantity | undefined =>
  value === undefined ? undefined : unit ? { value, unit } : { value };

export interface Converted {
  parsed: ParsedCommand;
  /** Gemini's own transcript ('' in text mode). */
  transcript: string;
}

export function convertGemini(json: unknown, ctx: ConvertContext): Converted {
  if (!isObj(json)) throw new GeminiOutputError('not an object');
  const intent = json.intent;
  if (typeof intent !== 'string' || !(INTENTS as readonly string[]).includes(intent)) throw new GeminiOutputError(`intent: ${String(intent)}`);
  const transcript = typeof json.transcript === 'string' ? nfc(json.transcript) : '';
  if (json.items !== undefined && json.items !== null && !Array.isArray(json.items)) throw new GeminiOutputError('items: not a list');
  if (json.credit !== undefined && json.credit !== null && typeof json.credit !== 'boolean') throw new GeminiOutputError('credit: not true/false');

  const aliases = new Map(Object.entries(ctx.productAliases).map(([k, v]) => [nfc(k), nfc(v)]));
  const known = new Set(ctx.knownProducts.map(nfc));
  const lowReasons = new Set<LowReason>();
  const canon = (name: string | undefined) => {
    if (name === undefined) return undefined;
    // alias first: the app's known list (knownNames) also holds the aliases
    const a = aliases.get(name);
    if (a) return a;
    if (known.has(name)) return name;
    if (known.size || aliases.size) lowReasons.add('unmatched_product');
    return name;
  };

  const i = intent as Intent;
  const base = { raw: transcript, normalized: tokenize(transcript).join(' ') };
  const custAliases = new Map(Object.entries(ctx.customerAliases ?? {}).map(([k, v]) => [nfc(k), nfc(v)]));
  const spokenCustomer = str(json, 'customer');
  const customer = spokenCustomer ? custAliases.get(spokenCustomer) ?? spokenCustomer : undefined;
  const amount = num(json, 'amount');
  const out: Partial<ParsedCommand> = { intent: i };
  const missing: Field[] = [];

  if (i === 'sale') {
    const items: SaleItem[] = ((json.items as unknown[] | null) ?? []).map((raw, k) => {
      if (!isObj(raw)) throw new GeminiOutputError(`items[${k}]: not an object`);
      return saleItem(raw, canon);
    });
    out.items = items;
    if (customer) out.customer = customer;
    if (json.credit === true) out.credit = true;
    if (items.length === 1) {
      const only = items[0]!;
      if (only.product) out.product = only.product;
      if (only.quantity) out.quantity = only.quantity;
      if (only.total !== undefined) out.amount = only.total;
    } else if (items.length && items.every((it) => it.total !== undefined)) {
      out.amount = round2(items.reduce((s, it) => s + it.total!, 0));
    }
    if (!items.length || items.some((it) => !it.product)) missing.push('product');
    if (out.credit && !customer) missing.push('customer');
    if (!items.length || items.some((it) => !it.quantity && it.total === undefined)) missing.push('quantity');
    const incomplete = items.some((it) => !it.product || (!it.quantity && it.total === undefined));
    if (items.length > 1 && incomplete) lowReasons.add('item_count');
  } else if (i === 'purchase') {
    out.product = canon(str(json, 'product'));
    out.quantity = qty(num(json, 'quantity', true), unitOf(json));
    out.buyPrice = num(json, 'buyPrice');
    out.sellPrice = num(json, 'sellPrice');
    out.amount = amount;
    if (json.isNewProduct === true) out.isNewProduct = true;
    if (!out.product) missing.push('product');
    if (!out.quantity) missing.push('quantity');
    if (out.isNewProduct) {
      if (out.buyPrice === undefined && amount === undefined) missing.push('buyPrice');
      if (out.sellPrice === undefined) missing.push('sellPrice');
    }
  } else if (i === 'baki' || i === 'joma') {
    out.customer = customer;
    out.amount = amount;
    if (!customer) missing.push('customer');
    if (amount === undefined) missing.push('amount');
  } else if (i === 'expense') {
    out.item = str(json, 'item');
    out.person = str(json, 'person');
    out.note = str(json, 'note');
    out.amount = amount;
    if (!out.item) missing.push('item');
    if (amount === undefined) missing.push('amount');
  } else if (i === 'owner_withdrawal') {
    out.person = str(json, 'person');
    out.note = str(json, 'note');
    out.amount = amount;
    if (amount === undefined) missing.push('amount');
  } else if (i === 'stock_query') {
    out.product = canon(str(json, 'product'));
    if (!out.product) missing.push('product');
  } else if (i === 'balance_query') {
    // no name = all customers (as the rule parser does)
    if (customer) out.customer = customer;
    else out.intent = 'total_baki_query';
  }
  if (i === 'unknown') lowReasons.add('unknown_intent');

  const reasons = [...lowReasons];
  const parsed = Object.fromEntries(
    Object.entries({
      ...out,
      missing,
      confidence: reasons.length ? 'low' : 'high',
      lowReasons: reasons.length ? reasons : undefined,
      ...base,
    }).filter(([, v]) => v !== undefined),
  ) as unknown as ParsedCommand;
  return { parsed, transcript };
}

function saleItem(o: Obj, canon: (n: string | undefined) => string | undefined): SaleItem {
  const item: SaleItem = {};
  const product = canon(str(o, 'product'));
  if (product) item.product = product;
  const unit = unitOf(o);
  const q = qty(num(o, 'quantity', true), unit);
  if (q) item.quantity = q;
  const each = num(o, 'unitPrice');
  const total = num(o, 'total');
  if (each !== undefined) {
    item.priceKind = 'unit';
    item.unitPrice = round2(each);
    if (unit) item.priceUnit = unit;
    if (q) item.total = round2(q.value * each);
    else if (total !== undefined) item.total = total;
  } else if (total !== undefined) {
    item.priceKind = 'total';
    item.total = total;
    if (q) {
      item.unitPrice = round2(total / q.value);
      if (unit) item.priceUnit = unit;
    }
  }
  return item;
}
