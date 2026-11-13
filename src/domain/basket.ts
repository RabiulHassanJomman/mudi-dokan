/**
 * Parsed sale (items[]) + what the DB knows about each product → the basket
 * the confirm card shows and edits, and what gets saved. Pure TS.
 * Customer and নগদ/বাকি apply to the whole basket.
 */
import { UNIT_BN, UNIT_BN_LOC, formatQty, formatTaka, toBnDigits } from '../lib/bn';
import type { ParsedCommand, SaleItem, Unit } from '../parser/types';
import { convertQuantity, looseQuantity, quantityStep } from './units';

export interface ProductInfo {
  id: string;
  name: string;
  unit: Unit;
  /** Per product unit. */
  sellPricePoisha: number | null;
  /** Average buy price per unit from purchases; null when nothing was bought yet. */
  costPricePoisha: number | null;
}

export type ItemProblem = 'no_product' | 'no_quantity' | 'no_price';
export type BasketProblem = 'no_items' | 'no_customer' | 'item';

export interface ItemDraft {
  /** Stable row key (its index in the parsed basket). */
  key: string;
  productName: string | null;
  /** null = new product, created on save. */
  product: ProductInfo | null;
  /** In `unit`. */
  quantity: number | null;
  /** Unit shown and edited: the product's unit, or the spoken one when they don't match (unitWarning). */
  unit: Unit;
  /** Per `unit`. */
  pricePoisha: number | null;
  amountPoisha: number | null;
  /** Which value the price box edits: what was spoken; line total when nothing (or a total) was said. */
  priceMode: 'total' | 'unit';
  /** Stored selling price per `unit` (null for a new product or no stored price). */
  storedPricePoisha: number | null;
  /** Spoken price is more than 20% away from the stored selling price (shown, never blocks). */
  priceWarning: boolean;
  /** Spoken unit is not the product's ("৫ কেজি তেল", তেল by the litre): shown, never blocks, not converted. */
  unitWarning: boolean;
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

function itemProblems(i: Omit<ItemDraft, 'problems'>): ItemProblem[] {
  const p: ItemProblem[] = [];
  if (!i.productName) p.push('no_product');
  if (i.quantity === null || i.quantity <= 0) p.push('no_quantity');
  if (i.pricePoisha === null && i.amountPoisha === null) p.push('no_price');
  return p;
}

const withProblems = (i: Omit<ItemDraft, 'problems'> | ItemDraft): ItemDraft => ({ ...i, problems: itemProblems(i) });

function itemFrom(si: SaleItem, product: ProductInfo | null, key: string): ItemDraft {
  let unit: Unit = product?.unit ?? si.quantity?.unit ?? si.priceUnit ?? 'piece';
  let unitWarning = false;
  // a unit the product can't convert to (kg ↔ litre, kg ↔ piece): keep the spoken one and warn
  const keepSpoken = (u: Unit | undefined) => {
    if (product && u && u !== unit && convertQuantity(1, u, unit) === null) {
      unit = u;
      unitWarning = true;
    }
  };
  keepSpoken(si.quantity?.unit);
  if (!si.quantity) keepSpoken(si.priceUnit);

  let quantity: number | null = null;
  if (si.quantity) {
    const from = si.quantity.unit ?? unit;
    quantity = from === unit ? si.quantity.value : looseQuantity(si.quantity.value, from, unit);
  }

  const stored = product?.sellPricePoisha ?? null;
  // per shown unit (1 kg of a by-the-litre product costs what 1 litre does)
  const storedPricePoisha =
    stored !== null && product ? Math.round(stored * looseQuantity(1, unit, product.unit)) : null;
  let pricePoisha: number | null = null;
  let amountPoisha: number | null = null;
  const spoken = si.total !== undefined || si.unitPrice !== undefined;

  if (si.total !== undefined) {
    // a spoken or computed line total is what the customer pays
    amountPoisha = poisha(si.total);
    if (quantity) pricePoisha = Math.round(amountPoisha / quantity);
    else if (storedPricePoisha) {
      pricePoisha = storedPricePoisha;
      quantity = round3(amountPoisha / storedPricePoisha);
    }
  } else if (si.unitPrice !== undefined) {
    // "চাল ২০০ টাকা করে" with no quantity yet: price per unit, amount once the quantity is set
    const per = si.priceUnit && si.priceUnit !== unit ? looseQuantity(1, unit, si.priceUnit) : 1;
    pricePoisha = Math.round(poisha(si.unitPrice) * per);
  } else {
    pricePoisha = storedPricePoisha;
  }
  if (amountPoisha === null && quantity !== null && pricePoisha !== null) {
    amountPoisha = Math.round(quantity * pricePoisha);
  }

  const priceWarning =
    spoken && storedPricePoisha !== null && storedPricePoisha > 0 && pricePoisha !== null &&
    Math.abs(pricePoisha - storedPricePoisha) / storedPricePoisha > PRICE_WARNING_RATIO;

  return withProblems({
    key,
    productName: product?.name ?? si.product ?? null,
    product,
    quantity,
    unit,
    pricePoisha,
    amountPoisha,
    priceMode: si.priceKind === 'unit' ? 'unit' : 'total',
    storedPricePoisha,
    priceWarning,
    unitWarning,
  });
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

const editItem = (b: BasketDraft, key: string, f: (i: ItemDraft) => ItemDraft): BasketDraft =>
  finalize({ ...b, items: b.items.map((i) => (i.key === key ? withProblems(f(i)) : i)) });

/**
 * − / +. Unit mode keeps the unit price. Total mode keeps the price per unit too, by
 * scaling the line total; a typed total with no quantity yet stays and sets the price.
 */
export const stepItem = (b: BasketDraft, key: string, dir: 1 | -1): BasketDraft =>
  editItem(b, key, (i) => {
    const old = i.quantity ?? 0;
    const step = quantityStep(i.unit);
    const q = Math.max(0, round3(dir === 1 ? old + step : old - step));
    let { pricePoisha, amountPoisha } = i;
    if (i.priceMode === 'total' && amountPoisha !== null && old > 0) {
      amountPoisha = Math.round((amountPoisha * q) / old);
    } else if (pricePoisha !== null) {
      amountPoisha = Math.round(q * pricePoisha);
    }
    if (i.priceMode === 'total' && amountPoisha !== null && q > 0) pricePoisha = Math.round(amountPoisha / q);
    return { ...i, quantity: q, pricePoisha, amountPoisha };
  });

/** The user typed a unit price: it is now theirs, so no warning. */
export const setItemPrice = (b: BasketDraft, key: string, pricePoisha: number): BasketDraft =>
  editItem(b, key, (i) => ({
    ...i,
    pricePoisha,
    amountPoisha: i.quantity !== null ? Math.round(i.quantity * pricePoisha) : null,
    priceWarning: false,
  }));

/** The user typed the line total: the unit price follows from the quantity. */
export const setItemTotal = (b: BasketDraft, key: string, amountPoisha: number): BasketDraft =>
  editItem(b, key, (i) => ({
    ...i,
    amountPoisha,
    pricePoisha: i.quantity ? Math.round(amountPoisha / i.quantity) : i.pricePoisha,
    priceWarning: false,
  }));

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

  const warn = b.items
    .filter((i) => i.unitWarning && i.product)
    .map((i) => ` ${i.productName} সাধারণত ${UNIT_BN_LOC[i.product!.unit]}।`)
    .join('');
  body += warn;

  const bad = b.items.find((i) => i.problems.length);
  if (bad) {
    const who = one ? '' : `${bad.productName ?? ''} `;
    if (bad.problems.includes('no_product')) return `${prefix}${body} একটা মালের নাম বুঝিনি।`;
    if (bad.problems.includes('no_quantity')) return `${prefix}${body} ${who}কতটুকু?`;
    if (bad.problems.includes('no_price')) return `${prefix}${body} ${who}দাম কত?`;
  }
  if (b.problems.includes('no_customer')) return `${prefix}${body} কার বাকি?`;
  return `${prefix}${body} ঠিক আছে?`;
}

// ── confirm card text ──────────────────────────────────────────

/** Small text under the price box: the value it doesn't edit. */
export function otherPriceText(i: ItemDraft): string | null {
  if (i.priceMode === 'unit') return i.amountPoisha !== null ? `মোট ${formatTaka(i.amountPoisha)}` : null;
  return i.pricePoisha !== null && i.quantity ? `${formatTaka(i.pricePoisha)}/${UNIT_BN[i.unit]}` : null;
}

/** "সাধারণত ২ কেজি ৳ ১২০ — …" (total mode) or "সাধারণত ৳ ৬০/কেজি — …" (unit mode). */
export function priceWarningText(i: ItemDraft): string | null {
  if (!i.priceWarning || i.storedPricePoisha === null) return null;
  const usual =
    i.priceMode === 'total' && i.quantity
      ? `${formatQty(i.quantity, i.unit)} ${formatTaka(Math.round(i.quantity * i.storedPricePoisha))}`
      : `${formatTaka(i.storedPricePoisha)}/${UNIT_BN[i.unit]}`;
  return `সাধারণত ${usual} — দাম ঠিক আছে তো?`;
}

/** "তেল সাধারণত লিটারে — ঠিক আছে তো?" */
export const unitWarningText = (i: ItemDraft): string | null =>
  i.unitWarning && i.product ? `${i.productName} সাধারণত ${UNIT_BN_LOC[i.product.unit]} — ঠিক আছে তো?` : null;

/**
 * What a line saves as: quantity and price in the product's unit (sales.quantity is
 * always in it). A mismatched unit goes over 1:1 (5 kg তেল → 5 litre); spoken_unit keeps "kg".
 */
export function storedLine(i: ItemDraft): { quantity: number; pricePoisha: number; spokenUnit: Unit } {
  if (i.quantity === null || i.amountPoisha === null) throw new Error(`line ${i.key} is not complete`);
  const unit = i.product?.unit ?? i.unit;
  if (unit === i.unit) {
    return { quantity: i.quantity, pricePoisha: i.pricePoisha ?? Math.round(i.amountPoisha / i.quantity), spokenUnit: i.unit };
  }
  const quantity = looseQuantity(i.quantity, i.unit, unit);
  return { quantity, pricePoisha: Math.round(i.amountPoisha / quantity), spokenUnit: i.unit };
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
    price_mode: i.priceMode,
    price_warning: i.priceWarning,
    unit_warning: i.unitWarning,
  })),
});
