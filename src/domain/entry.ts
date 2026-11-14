/**
 * Every confirmed command that is not a sale: বাকি, জমা, খরচ, মালিক নিল, মাল কেনা.
 * Parsed command + what the DB knows → the draft the confirm card shows and edits,
 * and what gets saved. Pure TS. Money in poisha.
 */
import { UNIT_BN, spokenQty, toBnDigits } from '../lib/bn';
import type { ParseContext, ParsedCommand, Unit } from '../parser/types';
import type { ProductInfo } from './basket';
import { customerStatus } from './customers';
import { convertQuantity, quantityStep } from './units';

export type LedgerKind = 'baki' | 'joma';
export type EntryKind = LedgerKind | 'expense' | 'owner_withdrawal' | 'purchase';

export type EntryProblem =
  | 'no_kind' // বাকি না জমা? (the বাকি tab heard a name/amount but no keyword)
  | 'no_customer'
  | 'customer_unknown' // not in the customer list and not confirmed as new
  | 'no_amount'
  | 'no_item'
  | 'no_product'
  | 'no_quantity'
  | 'no_price';

export interface PurchaseLine {
  productName: string | null;
  /** null = new product, created on save. */
  product: ProductInfo | null;
  quantity: number | null;
  /** The product's unit, or the spoken one when they can't convert (unitWarning). */
  unit: Unit;
  /** Per `unit`. */
  buyPricePoisha: number | null;
  /** New selling price per `unit`, if said ("বেচা ৬০") or typed. */
  sellPricePoisha: number | null;
  unitWarning: boolean;
  /** Spoken name to save as an alias of `product` (chosen from the closest matches). */
  alias: string | null;
}

export interface EntryDraft {
  /** null only for a ledger entry whose kind was not heard. */
  kind: EntryKind | null;
  customerName: string | null;
  /** The customer is in the list, or the user chose "নতুন ক্রেতা". */
  customerOk: boolean;
  /** Ledger/expense/withdrawal amount; purchase total. */
  amountPoisha: number | null;
  item: string | null;
  person: string | null;
  note: string | null;
  purchase: PurchaseLine | null;
  problems: EntryProblem[];
}

export interface EntryContext {
  /** Spoken product name → product (purchases). */
  products: ReadonlyMap<string, ProductInfo>;
  knownCustomers: readonly string[];
  tab?: ParseContext['tab'];
  /** From the customer screen (জমা নিন / বাকি দিন): used when the command doesn't say. */
  defaultCustomer?: string;
  defaultKind?: LedgerKind;
}

const poisha = (taka: number) => Math.round(taka * 100);
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const isLedger = (k: EntryKind | null) => k === null || k === 'baki' || k === 'joma';

function problemsOf(d: Omit<EntryDraft, 'problems'>): EntryProblem[] {
  const p: EntryProblem[] = [];
  const noAmount = d.amountPoisha === null || d.amountPoisha <= 0;
  if (isLedger(d.kind)) {
    if (d.kind === null) p.push('no_kind');
    if (!d.customerName) p.push('no_customer');
    else if (!d.customerOk) p.push('customer_unknown');
    if (noAmount) p.push('no_amount');
  } else if (d.kind === 'expense') {
    if (noAmount) p.push('no_amount');
    if (!d.item) p.push('no_item');
  } else if (d.kind === 'owner_withdrawal') {
    if (noAmount) p.push('no_amount');
  } else if (d.purchase) {
    if (!d.purchase.productName) p.push('no_product');
    if (!d.purchase.quantity || d.purchase.quantity <= 0) p.push('no_quantity');
    if (d.purchase.buyPricePoisha === null) p.push('no_price');
  }
  return p;
}

const finalize = (d: Omit<EntryDraft, 'problems'> | EntryDraft): EntryDraft => ({ ...d, problems: problemsOf(d) });

function purchaseFrom(p: ParsedCommand, product: ProductInfo | null): { line: PurchaseLine; amountPoisha: number | null } {
  const spokenUnit = p.quantity?.unit;
  let unit: Unit = product?.unit ?? spokenUnit ?? 'piece';
  let quantity = p.quantity?.value ?? null;
  let unitWarning = false;
  // price per spoken unit → per stored unit, by the same factor as the quantity
  let factor = 1;
  if (quantity !== null && spokenUnit && spokenUnit !== unit) {
    const q = convertQuantity(quantity, spokenUnit, unit);
    if (q === null) {
      unit = spokenUnit; // "২ বস্তা চাল": keep it, warn, never guess a conversion
      unitWarning = !!product;
    } else {
      factor = quantity / q;
      quantity = q;
    }
  }
  let buy = p.buyPrice !== undefined ? Math.round(poisha(p.buyPrice) * factor) : null;
  let amountPoisha: number | null = null;
  if (p.amount !== undefined) {
    amountPoisha = poisha(p.amount);
    if (quantity) buy = Math.round(amountPoisha / quantity);
  } else if (buy !== null && quantity) {
    amountPoisha = Math.round(quantity * buy);
  }
  const sell = p.sellPrice !== undefined ? Math.round(poisha(p.sellPrice) * factor) : null;
  return {
    line: { productName: product?.name ?? p.product ?? null, product, quantity, unit, buyPricePoisha: buy, sellPricePoisha: sell, unitWarning, alias: null },
    amountPoisha,
  };
}

/** null when the command is not an entry (a sale, a question, or nothing understood off the বাকি tab). */
export function entryFromParse(p: ParsedCommand, ctx: EntryContext): EntryDraft | null {
  const base = { customerName: null, customerOk: false, amountPoisha: p.amount !== undefined ? poisha(p.amount) : null, item: null, person: null, note: null, purchase: null };
  let kind: EntryKind | null;
  if (p.intent === 'baki' || p.intent === 'joma') kind = p.intent;
  else if (p.intent === 'unknown' && (ctx.tab === 'ledger' || p.missing.includes('intent'))) kind = ctx.defaultKind ?? null;
  else if (p.intent === 'expense' || (p.intent === 'unknown' && ctx.tab === 'expense' && !p.raw.trim())) {
    return finalize({ ...base, kind: 'expense', item: p.item ?? null, person: p.person ?? null, note: p.note ?? null });
  } else if (p.intent === 'owner_withdrawal') {
    return finalize({ ...base, kind: 'owner_withdrawal', person: p.person ?? null, note: p.note ?? null });
  } else if (p.intent === 'purchase') {
    const product = p.product ? ctx.products.get(p.product) ?? null : null;
    const { line, amountPoisha } = purchaseFrom(p, product);
    return finalize({ ...base, kind: 'purchase', amountPoisha, purchase: line });
  } else return null;

  const name = p.customer?.trim() || ctx.defaultCustomer?.trim() || null;
  return finalize({ ...base, kind, customerName: name, customerOk: customerStatus(name, ctx.knownCustomers) === 'known' });
}

// ── edits ──────────────────────────────────────────────────────

export const withKind = (d: EntryDraft, kind: LedgerKind): EntryDraft => finalize({ ...d, kind });

/** `ok`: the name is in the list, or the user confirmed a new customer. */
export const withEntryCustomer = (d: EntryDraft, name: string, ok: boolean): EntryDraft =>
  finalize({ ...d, customerName: name.trim() || null, customerOk: ok && !!name.trim() });

export const setEntryAmount = (d: EntryDraft, amountPoisha: number | null): EntryDraft => {
  if (d.purchase) {
    // a purchase total: the per-unit price follows
    const q = d.purchase.quantity;
    const buy = amountPoisha !== null && q ? Math.round(amountPoisha / q) : d.purchase.buyPricePoisha;
    return finalize({ ...d, amountPoisha, purchase: { ...d.purchase, buyPricePoisha: buy } });
  }
  return finalize({ ...d, amountPoisha });
};

export const setEntryItem = (d: EntryDraft, item: string): EntryDraft => finalize({ ...d, item: item.trim() || null });
export const setEntryPerson = (d: EntryDraft, person: string): EntryDraft => finalize({ ...d, person: person.trim() || null });

const purchaseTotal = (l: PurchaseLine) => (l.quantity && l.buyPricePoisha !== null ? Math.round(l.quantity * l.buyPricePoisha) : null);

/** ± on the purchase quantity; the per-unit buy price stays, the total follows. */
export function stepPurchase(d: EntryDraft, dir: 1 | -1): EntryDraft {
  if (!d.purchase) return d;
  const step = quantityStep(d.purchase.unit);
  const q = round3(Math.max(step, (d.purchase.quantity ?? 0) + dir * step));
  const line = { ...d.purchase, quantity: q };
  return finalize({ ...d, purchase: line, amountPoisha: purchaseTotal(line) ?? d.amountPoisha });
}

export function setBuyPrice(d: EntryDraft, perUnitPoisha: number): EntryDraft {
  if (!d.purchase) return d;
  const line = { ...d.purchase, buyPricePoisha: perUnitPoisha };
  return finalize({ ...d, purchase: line, amountPoisha: purchaseTotal(line) });
}

export const setSellPrice = (d: EntryDraft, perUnitPoisha: number | null): EntryDraft =>
  d.purchase ? finalize({ ...d, purchase: { ...d.purchase, sellPricePoisha: perUnitPoisha } }) : d;

/**
 * The user chose a known product for a purchase whose name matched none: the quantity
 * and prices move to the product's unit when they convert (else kept, with the warning),
 * and the spoken name is saved as an alias.
 */
export function choosePurchaseProduct(d: EntryDraft, product: ProductInfo): EntryDraft {
  const l = d.purchase;
  if (!l) return d;
  let { quantity, unit, buyPricePoisha, sellPricePoisha } = l;
  let unitWarning = false;
  if (unit !== product.unit) {
    const q = quantity !== null ? convertQuantity(quantity, unit, product.unit) : convertQuantity(1, unit, product.unit);
    if (q === null) unitWarning = true;
    else {
      const factor = quantity !== null ? quantity / q : 1 / q;
      if (quantity !== null) quantity = q;
      unit = product.unit;
      if (buyPricePoisha !== null) buyPricePoisha = Math.round(buyPricePoisha * factor);
      if (sellPricePoisha !== null) sellPricePoisha = Math.round(sellPricePoisha * factor);
    }
  }
  const alias = l.productName && l.productName !== product.name ? l.productName : null;
  return finalize({
    ...d,
    purchase: { ...l, product, productName: product.name, quantity, unit, buyPricePoisha, sellPricePoisha, unitWarning, alias },
  });
}

/** A purchase's product name typed or said on the card: a known one is chosen, else a new product. */
export function renamePurchaseProduct(d: EntryDraft, name: string, known: ProductInfo | null): EntryDraft {
  const n = name.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!d.purchase || !n) return d;
  if (known) return choosePurchaseProduct(d, known);
  return finalize({ ...d, purchase: { ...d.purchase, productName: n, product: null, unitWarning: false, alias: null } });
}

export const canSaveEntry = (d: EntryDraft) => d.problems.length === 0;

// ── speech & pilot log ─────────────────────────────────────────

const spoken = (poishaAmount: number) => toBnDigits(Math.round(poishaAmount) / 100);
const taka = (p: number | null) => (p === null ? '' : `${spoken(p)} টাকা`);

export const KIND_BN: Record<EntryKind, string> = {
  baki: 'বাকি',
  joma: 'জমা',
  expense: 'খরচ',
  owner_withdrawal: 'মালিক নিল',
  purchase: 'মাল কেনা',
};

export function entryReadback(d: EntryDraft): string {
  const has = (p: EntryProblem) => d.problems.includes(p);
  const end = d.problems.length ? '' : ' ঠিক আছে?';

  if (isLedger(d.kind)) {
    const who = d.customerName ? `${d.customerName}, ` : '';
    const parts = [d.amountPoisha !== null ? taka(d.amountPoisha) : '', d.kind ? KIND_BN[d.kind] : ''].filter(Boolean).join(' ');
    let s = `${who}${parts}`.replace(/, $/, '') + '।';
    if (has('no_kind')) s += ' বাকি না জমা?';
    else if (has('no_customer')) s += ` কার ${KIND_BN[d.kind!]}?`;
    else if (has('customer_unknown')) s += ` ${d.customerName} নামে কাউকে চিনি না। নিচে বেছে নিন।`;
    else if (has('no_amount')) s += ' কত টাকা?';
    return s + end;
  }
  if (d.kind === 'expense') {
    let s = `খরচ${d.item ? `: ${d.item}` : ''}${d.amountPoisha !== null ? `, ${taka(d.amountPoisha)}` : ''}।`;
    if (has('no_item')) s += ' কিসের খরচ?';
    else if (has('no_amount')) s += ' কত টাকা?';
    return s + end;
  }
  if (d.kind === 'owner_withdrawal') {
    let s = `মালিক নিল${d.person ? `: ${d.person}` : ''}${d.amountPoisha !== null ? `, ${taka(d.amountPoisha)}` : ''}।`;
    if (has('no_amount')) s += ' কত টাকা?';
    return s + end;
  }
  const l = d.purchase!;
  const unit = UNIT_BN[l.unit];
  let s = `কেনা: ${l.productName ?? 'মাল'}${l.quantity ? ` ${spokenQty(l.quantity, l.unit)}` : ''}`;
  if (l.buyPricePoisha !== null) s += `, ${unit} ${taka(l.buyPricePoisha)}`;
  if (d.amountPoisha !== null && l.buyPricePoisha !== null) s += `, মোট ${taka(d.amountPoisha)}`;
  s += '।';
  if (l.sellPricePoisha !== null) s += ` বেচা ${unit} ${spoken(l.sellPricePoisha)}।`;
  if (has('no_product')) s += ' কোন মাল?';
  else if (has('no_quantity')) s += ' কতটুকু?';
  else if (has('no_price')) s += ' কেনা দাম কত?';
  return s + end;
}

/** What was saved, for voice_logs.final_json (pilot log, eval import). Money in taka. */
export const entrySummary = (d: EntryDraft) => ({
  intent: d.kind,
  customer: d.customerName,
  amount: d.amountPoisha === null ? null : d.amountPoisha / 100,
  item: d.item,
  person: d.person,
  note: d.note,
  purchase: d.purchase
    ? {
        product: d.purchase.productName,
        new_product: d.purchase.product === null,
        quantity: d.purchase.quantity,
        unit: d.purchase.unit,
        buy_price: d.purchase.buyPricePoisha === null ? null : d.purchase.buyPricePoisha / 100,
        sell_price: d.purchase.sellPricePoisha === null ? null : d.purchase.sellPricePoisha / 100,
        unit_warning: d.purchase.unitWarning,
        alias: d.purchase.alias,
      }
    : null,
});

/** Fields the user changed on the confirm card, e.g. ["customerName", "amountPoisha"]. */
export function diffEntries(a: EntryDraft, b: EntryDraft): string[] {
  const out: string[] = [];
  if (a.kind !== b.kind) out.push('kind');
  if (a.customerName !== b.customerName) out.push('customerName');
  else if (a.customerOk !== b.customerOk) out.push('customerNew');
  if (a.purchase && b.purchase) {
    if (a.purchase.productName !== b.purchase.productName) out.push('purchase.productName');
    if (a.purchase.quantity !== b.purchase.quantity) out.push('purchase.quantity');
    if (a.purchase.buyPricePoisha !== b.purchase.buyPricePoisha) out.push('purchase.buyPricePoisha');
    if (a.purchase.sellPricePoisha !== b.purchase.sellPricePoisha) out.push('purchase.sellPricePoisha');
  }
  if (a.amountPoisha !== b.amountPoisha) out.push('amountPoisha');
  if (a.item !== b.item) out.push('item');
  if (a.person !== b.person) out.push('person');
  return out;
}
