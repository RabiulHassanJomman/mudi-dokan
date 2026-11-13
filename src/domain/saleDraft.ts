/**
 * Parsed sale command + what the DB knows about the product → what the
 * confirm card shows and what gets saved. Pure TS.
 */
import { UNIT_BN, formatNumber, formatQty } from '../lib/bn';
import type { ParsedCommand, Unit } from '../parser/types';
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

export type Problem = 'no_product' | 'no_quantity' | 'no_price' | 'unit_mismatch' | 'no_customer';

export interface SaleDraft {
  productName: string | null;
  /** null = new product, created on save. */
  product: ProductInfo | null;
  /** In `unit`. */
  quantity: number | null;
  unit: Unit;
  /** Per unit. */
  pricePoisha: number | null;
  amountPoisha: number | null;
  credit: boolean;
  customerName: string | null;
  problems: Problem[];
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

function problemsOf(d: Omit<SaleDraft, 'problems'>, mismatch = false): Problem[] {
  const p: Problem[] = [];
  if (!d.productName) p.push('no_product');
  if (mismatch) p.push('unit_mismatch');
  if (d.quantity === null || d.quantity <= 0) p.push('no_quantity');
  if (d.amountPoisha === null || d.pricePoisha === null) p.push('no_price');
  if (d.credit && !d.customerName) p.push('no_customer');
  return p;
}

export function draftFromParse(parsed: ParsedCommand, product: ProductInfo | null): SaleDraft {
  const spoken = parsed.quantity;
  const unit: Unit = product?.unit ?? spoken?.unit ?? 'piece';
  let quantity: number | null = null;
  let mismatch = false;
  if (spoken) {
    if (!spoken.unit || spoken.unit === unit) quantity = spoken.value;
    else {
      quantity = convertQuantity(spoken.value, spoken.unit, unit);
      mismatch = quantity === null;
    }
  }

  let pricePoisha = product?.sellPricePoisha ?? null;
  let amountPoisha = parsed.amount !== undefined ? Math.round(parsed.amount * 100) : null;

  if (amountPoisha !== null) {
    // the spoken total is what the customer paid; derive whatever is missing
    if (quantity === null && pricePoisha) quantity = round3(amountPoisha / pricePoisha);
    else if (quantity) pricePoisha = Math.round(amountPoisha / quantity);
  } else if (quantity !== null && pricePoisha !== null) {
    amountPoisha = Math.round(quantity * pricePoisha);
  }

  const base = {
    productName: product?.name ?? parsed.product ?? null,
    product,
    quantity,
    unit,
    pricePoisha,
    amountPoisha,
    credit: parsed.credit === true,
    customerName: parsed.customer ?? null,
  };
  return { ...base, problems: problemsOf(base, mismatch) };
}

const recompute = (d: SaleDraft): SaleDraft => {
  const amountPoisha =
    d.quantity !== null && d.pricePoisha !== null ? Math.round(d.quantity * d.pricePoisha) : d.amountPoisha;
  const next = { ...d, amountPoisha };
  return { ...next, problems: problemsOf(next) };
};

export const withQuantity = (d: SaleDraft, quantity: number): SaleDraft =>
  recompute({ ...d, quantity: Math.max(0, round3(quantity)) });

export const stepQuantity = (d: SaleDraft, dir: 1 | -1): SaleDraft => {
  const step = quantityStep(d.unit);
  const q = d.quantity ?? 0;
  return withQuantity(d, dir === 1 ? q + step : Math.max(0, q - step));
};

export const withPrice = (d: SaleDraft, pricePoisha: number): SaleDraft => recompute({ ...d, pricePoisha });

export const withCredit = (d: SaleDraft, credit: boolean): SaleDraft => recompute({ ...d, credit });

export const withCustomer = (d: SaleDraft, name: string): SaleDraft =>
  recompute({ ...d, customerName: name.trim() || null });

export const canSave = (d: SaleDraft): boolean => d.problems.length === 0;

/** What TTS says on the confirm card: "চাল ২ কেজি, ১২০ টাকা। ঠিক আছে?" */
export function readback(d: SaleDraft): string {
  if (!d.productName) return 'মালের নাম বুঝিনি। আবার বলুন।';
  const parts: string[] = [d.productName];
  if (d.quantity) parts[0] += ` ${formatQty(d.quantity, d.unit)}`;
  let text = parts[0]!;
  if (d.amountPoisha !== null) text += `, ${formatNumber(d.amountPoisha / 100)} টাকা`;
  if (d.credit) text += d.customerName ? `, ${d.customerName}-এর বাকি` : ', বাকিতে';
  text += '।';
  if (d.problems.includes('unit_mismatch')) return `${text} ${d.productName} ${UNIT_BN[d.unit]}-এ বিক্রি হয়। পরিমাণ ঠিক করুন।`;
  if (d.problems.includes('no_quantity')) return `${text} কতটুকু?`;
  if (d.problems.includes('no_price')) return `${text} দাম কত?`;
  if (d.problems.includes('no_customer')) return `${text} কার বাকি?`;
  return `${text} ঠিক আছে?`;
}

/** Fields the user changed between the first draft and the saved one (pilot log). */
export function diffDrafts(a: SaleDraft, b: SaleDraft): string[] {
  const keys = ['productName', 'quantity', 'unit', 'pricePoisha', 'amountPoisha', 'credit', 'customerName'] as const;
  return keys.filter((k) => a[k] !== b[k]);
}
