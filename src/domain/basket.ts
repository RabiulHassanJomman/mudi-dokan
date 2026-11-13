/**
 * Parsed sale (items[]) + what the DB knows about each product → the basket
 * the confirm card shows and edits, and what gets saved. Pure TS.
 * Customer and নগদ/বাকি apply to the whole basket.
 */
import { UNIT_BN, formatQty, toBnDigits } from '../lib/bn';
import type { ParsedCommand, SaleItem, Unit } from '../parser/types';
import { convertQuantity, quantityStep } from './units';

export interface ProductInfo {
  id: string;
  name: string;
  unit: Unit;
  /** Per product unit. */
  sellPricePoisha: number | null;
  /** Average buy price per unit from purchases; null when nothing was bought yet. */
  costPricePoisha: number | null;
}

export type ItemProblem = 'no_product' | 'no_quantity' | 'no_price' | 'unit_mismatch';
export type BasketProblem = 'no_items' | 'no_customer' | 'item';

export interface ItemDraft {
  /** Stable row key (its index in the parsed basket). */
  key: string;
  productName: string | null;
  /** null = new product, created on save. */
  product: ProductInfo | null;
  /** In `unit`. */
  quantity: number | null;
  unit: Unit;
  /** Per unit. */
  pricePoisha: number | null;
  amountPoisha: number | null;
  /** Spoken price is more than 20% away from the stored selling price (shown, never blocks). */
  priceWarning: boolean;
  problems: ItemProblem[];
}

export interface BasketDraft {
  items: ItemDraft[];
  credit: boolean;
  customerName: string | null;
  /** Sum of line amounts; null while any line has no amount. */
  totalPoisha: number | null;
  problems: BasketProblem[];
}

/** How far a spoken price may differ from the stored one before it is highlighted. */
export const PRICE_WARNING_RATIO = 0.2;

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const poisha = (taka: number) => Math.round(taka * 100);

function itemProblems(i: Omit<ItemDraft, 'problems'>, mismatch: boolean): ItemProblem[] {
  const p: ItemProblem[] = [];
  if (!i.productName) p.push('no_product');
  if (mismatch) p.push('unit_mismatch');
  if (i.quantity === null || i.quantity <= 0) p.push('no_quantity');
  if (i.pricePoisha === null || i.amountPoisha === null) p.push('no_price');
  return p;
}

function itemFrom(si: SaleItem, product: ProductInfo | null, key: string): ItemDraft {
  const unit: Unit = product?.unit ?? si.quantity?.unit ?? si.priceUnit ?? 'piece';
  let mismatch = false;

  let quantity: number | null = null;
  if (si.quantity) {
    const from = si.quantity.unit ?? unit;
    quantity = from === unit ? si.quantity.value : convertQuantity(si.quantity.value, from, unit);
    if (quantity === null) mismatch = true;
  }

  const stored = product?.sellPricePoisha ?? null;
  let pricePoisha: number | null = null;
  let amountPoisha: number | null = null;
  const spoken = si.total !== undefined || si.unitPrice !== undefined;

  if (si.total !== undefined) {
    // a spoken or computed line total is what the customer pays
    amountPoisha = poisha(si.total);
    if (quantity) pricePoisha = Math.round(amountPoisha / quantity);
    else if (stored) {
      pricePoisha = stored;
      quantity = round3(amountPoisha / stored);
    }
  } else if (si.unitPrice !== undefined) {
    // "চাল ২০০ টাকা করে" with no quantity yet: price per unit, amount once the quantity is set
    const per = si.priceUnit && si.priceUnit !== unit ? convertQuantity(1, unit, si.priceUnit) : 1;
    if (per === null) mismatch = true;
    else pricePoisha = Math.round(poisha(si.unitPrice) * per);
  } else {
    pricePoisha = stored;
  }
  if (amountPoisha === null && quantity !== null && pricePoisha !== null) {
    amountPoisha = Math.round(quantity * pricePoisha);
  }

  const priceWarning =
    spoken && stored !== null && stored > 0 && pricePoisha !== null &&
    Math.abs(pricePoisha - stored) / stored > PRICE_WARNING_RATIO;

  const base = {
    key,
    productName: product?.name ?? si.product ?? null,
    product,
    quantity,
    unit,
    pricePoisha,
    amountPoisha,
    priceWarning,
  };
  return { ...base, problems: itemProblems(base, mismatch) };
}

function finalize(b: Omit<BasketDraft, 'totalPoisha' | 'problems'>): BasketDraft {
  const amounts = b.items.map((i) => i.amountPoisha);
  const totalPoisha = amounts.length && amounts.every((a) => a !== null)
    ? amounts.reduce<number>((s, a) => s + (a ?? 0), 0)
    : null;
  const problems: BasketProblem[] = [];
  if (!b.items.length) problems.push('no_items');
  if (b.credit && !b.customerName) problems.push('no_customer');
  if (b.items.some((i) => i.problems.length)) problems.push('item');
  return { ...b, totalPoisha, problems };
}

/** `products` maps each spoken product name to what the DB knows (missing = new product). */
export function basketFromParse(parsed: ParsedCommand, products: ReadonlyMap<string, ProductInfo>): BasketDraft {
  const items = (parsed.items ?? []).map((si, n) =>
    itemFrom(si, si.product ? (products.get(si.product) ?? null) : null, String(n)),
  );
  return finalize({ items, credit: parsed.credit === true, customerName: parsed.customer ?? null });
}

// ── edits ──────────────────────────────────────────────────────

function recomputeItem(i: ItemDraft): ItemDraft {
  const amountPoisha =
    i.quantity !== null && i.pricePoisha !== null ? Math.round(i.quantity * i.pricePoisha) : i.amountPoisha;
  const next = { ...i, amountPoisha };
  // a unit mismatch is cleared once the user sets a quantity in the product's unit
  return { ...next, problems: itemProblems(next, false) };
}

const editItem = (b: BasketDraft, key: string, f: (i: ItemDraft) => ItemDraft): BasketDraft =>
  finalize({ ...b, items: b.items.map((i) => (i.key === key ? recomputeItem(f(i)) : i)) });

export const stepItem = (b: BasketDraft, key: string, dir: 1 | -1): BasketDraft =>
  editItem(b, key, (i) => {
    const q = i.quantity ?? 0;
    const step = quantityStep(i.unit);
    return { ...i, quantity: Math.max(0, round3(dir === 1 ? q + step : q - step)) };
  });

/** The user typed a price: it is now theirs, so no warning. */
export const setItemPrice = (b: BasketDraft, key: string, pricePoisha: number): BasketDraft =>
  editItem(b, key, (i) => ({ ...i, pricePoisha, priceWarning: false }));

export const removeItem = (b: BasketDraft, key: string): BasketDraft =>
  finalize({ ...b, items: b.items.filter((i) => i.key !== key) });

export const withCredit = (b: BasketDraft, credit: boolean): BasketDraft => finalize({ ...b, credit });

export const withCustomer = (b: BasketDraft, name: string): BasketDraft =>
  finalize({ ...b, customerName: name.trim() || null });

export const canSave = (b: BasketDraft): boolean => b.problems.length === 0;

// ── speech & pilot log ─────────────────────────────────────────

/** Plain Bangla digits for TTS ("১২০০", no thousands comma). */
const spoken = (n: number) => toBnDigits(Math.round(n * 100) / 100);

const itemPhrase = (i: ItemDraft) =>
  [i.productName ?? '', i.quantity ? formatQty(i.quantity, i.unit) : ''].filter(Boolean).join(' ');

/**
 * What TTS says on the confirm card:
 * "করিম, বাকি। চাল ২ কেজি ২০০, চাল ৩ কেজি ৪০০, তেল ৫ কেজি ৬০০। মোট ১২০০ টাকা। ঠিক আছে?"
 * More than 4 lines: count + total only.
 */
export function readback(b: BasketDraft): string {
  if (!b.items.length) return 'কিছু বুঝিনি। আবার বলুন।';
  const one = b.items.length === 1 ? b.items[0]! : null;
  if (one && !one.productName) return 'মালের নাম বুঝিনি। আবার বলুন।';

  const prefix = b.credit ? `${b.customerName ? `${b.customerName}, ` : ''}বাকি। ` : '';
  let body: string;
  if (one) {
    body = itemPhrase(one) + (one.amountPoisha !== null ? `, ${spoken(one.amountPoisha / 100)} টাকা` : '') + '।';
  } else if (b.items.length > 4 && b.totalPoisha !== null) {
    body = `${toBnDigits(b.items.length)}টি জিনিস, মোট ${spoken(b.totalPoisha / 100)} টাকা।`;
  } else {
    body =
      b.items
        .map((i) => itemPhrase(i) + (i.amountPoisha !== null ? ` ${spoken(i.amountPoisha / 100)}` : ''))
        .join(', ') + '।';
    if (b.totalPoisha !== null) body += ` মোট ${spoken(b.totalPoisha / 100)} টাকা।`;
  }

  const bad = b.items.find((i) => i.problems.length);
  if (bad) {
    const who = one ? '' : `${bad.productName ?? ''} `;
    if (bad.problems.includes('no_product')) return `${prefix}${body} একটা মালের নাম বুঝিনি।`;
    if (bad.problems.includes('unit_mismatch'))
      return `${prefix}${body} ${bad.productName} ${UNIT_BN[bad.unit]}-এ বিক্রি হয়। পরিমাণ ঠিক করুন।`;
    if (bad.problems.includes('no_quantity')) return `${prefix}${body} ${who}কতটুকু?`;
    if (bad.problems.includes('no_price')) return `${prefix}${body} ${who}দাম কত?`;
  }
  if (b.problems.includes('no_customer')) return `${prefix}${body} কার বাকি?`;
  return `${prefix}${body} ঠিক আছে?`;
}

const ITEM_FIELDS = ['productName', 'quantity', 'unit', 'pricePoisha', 'amountPoisha'] as const;

/** What the user changed on the confirm card, e.g. ["items[0].removed", "items[1].quantity", "credit"]. */
export function diffBaskets(a: BasketDraft, b: BasketDraft): string[] {
  const out: string[] = [];
  a.items.forEach((ai) => {
    const bi = b.items.find((x) => x.key === ai.key);
    if (!bi) out.push(`items[${ai.key}].removed`);
    else for (const f of ITEM_FIELDS) if (ai[f] !== bi[f]) out.push(`items[${ai.key}].${f}`);
  });
  if (a.credit !== b.credit) out.push('credit');
  if (a.customerName !== b.customerName) out.push('customerName');
  return out;
}

/** The saved lines, for the pilot log. */
export const basketSummary = (b: BasketDraft) => ({
  credit: b.credit,
  customer: b.customerName,
  total_poisha: b.totalPoisha,
  items: b.items.map((i) => ({
    product: i.productName,
    new_product: i.product === null,
    quantity: i.quantity,
    unit: i.unit,
    price_poisha: i.pricePoisha,
    amount_poisha: i.amountPoisha,
    price_warning: i.priceWarning,
  })),
});
