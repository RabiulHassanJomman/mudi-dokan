/**
 * মাল (Stock): stock = bought − sold (never stored), low-stock, and what TTS says.
 * Pure TS.
 */
import { UNIT_BN, formatQty, formatTaka, spokenQty, toBnDigits } from '../lib/bn';
import type { Unit } from '../parser/types';

/** One product with its effective purchase and sale totals (repo.stockList). */
export interface StockRow {
  id: string;
  name: string;
  unit: Unit;
  sellPricePoisha: number | null;
  /** Weighted average buy price per unit; null = never bought. */
  costPricePoisha: number | null;
  /** Sum of purchase quantities, in the product's unit. */
  bought: number;
  sold: number;
  /** Number of purchase rows with a quantity: 0 = the stock is unknown. */
  purchases: number;
  /** Money spent buying it where no quantity was said (Android parsing). */
  spentPoisha: number;
}

export interface StockView {
  id: string;
  name: string;
  unit: Unit;
  sellPricePoisha: number | null;
  costPricePoisha: number | null;
  /** null = no purchase written yet (sold before any কেনা): unknown, not negative. */
  stock: number | null;
  known: boolean;
  low: boolean;
  spentPoisha: number;
}

/**
 * At or under this much (in the product's unit) the card turns orange. One rule per
 * unit until products get their own threshold.
 */
export const LOW_STOCK: Readonly<Record<Unit, number>> = {
  kg: 5,
  g: 500,
  litre: 2,
  ml: 500,
  piece: 5,
  packet: 5,
  dozen: 1,
  hali: 2,
  bosta: 1,
};

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function stockView(r: StockRow): StockView {
  const known = r.purchases > 0;
  const stock = known ? round3(r.bought - r.sold) : null;
  return {
    id: r.id,
    name: r.name,
    unit: r.unit,
    sellPricePoisha: r.sellPricePoisha,
    costPricePoisha: r.costPricePoisha,
    stock,
    known,
    low: stock !== null && stock <= LOW_STOCK[r.unit],
    spentPoisha: r.spentPoisha,
  };
}

/** The big line on a মাল card: the quantity, or the money spent when no quantity was ever said. */
export function stockQtyText(v: StockView): string {
  if (v.stock !== null) return v.stock <= 0 ? 'শেষ' : formatQty(v.stock, v.unit);
  return v.spentPoisha > 0 ? `খরচ ${formatTaka(v.spentPoisha)}` : 'কেনা লেখা নেই';
}

const priceWords = (v: StockView) =>
  v.sellPricePoisha !== null ? ` বেচা দাম ${UNIT_BN[v.unit]} ${toBnDigits(Math.round(v.sellPricePoisha) / 100)} টাকা।` : '';

/** "চাল ৪২ কেজি আছে। বেচা দাম কেজি ৬০ টাকা।" — card tap and "চাল কত আছে?". */
export function stockWords(v: StockView): string {
  if (v.stock === null && v.spentPoisha > 0) return `${v.name} কিনতে মোট ${toBnDigits(Math.round(v.spentPoisha) / 100)} টাকা খরচ হয়েছে।${priceWords(v)}`;
  if (v.stock === null) return `${v.name} কেনার হিসাব নেই।${priceWords(v)} নতুন মাল বলে কেনা লিখুন।`;
  if (v.stock <= 0) return `${v.name} শেষ, আর নেই।${priceWords(v)}`;
  const qty = spokenQty(v.stock, v.unit);
  if (v.low) return `${v.name} আছে মাত্র ${qty}, কম।${priceWords(v)}`;
  return `${v.name} ${qty} আছে।${priceWords(v)}`;
}

/** 🔊 on the মাল screen. */
export function stockScreenWords(list: readonly StockView[]): string {
  const end = ' নতুন মাল বলতে নিচের বোতাম চাপুন।';
  if (!list.length) return `মাল পাতা। এখনো কোনো মাল নেই।${end}`;
  const low = list.filter((v) => v.low).map((v) => v.name);
  return (
    `মাল পাতা। ${toBnDigits(list.length)}টি মাল।` +
    (low.length ? ` কম আছে: ${low.join(', ')}।` : '') +
    ' কোনো মালে চাপলে শুনবেন।' +
    end
  );
}

/** "সব মাল কত আছে" list: low-stock first, otherwise the stock list's order. */
export const allStockList = (list: readonly StockView[]): StockView[] => [
  ...list.filter((v) => v.low),
  ...list.filter((v) => !v.low),
];

/** "মোট ৭ রকম মাল। কম আছে: চাল, ডাল।" — at most 5 low-stock names. */
export function allStockWords(list: readonly StockView[]): string {
  if (!list.length) return 'এখনো কোনো মাল নেই।';
  const low = list.filter((v) => v.low).slice(0, 5).map((v) => v.name);
  return `মোট ${toBnDigits(list.length)} রকম মাল।` + (low.length ? ` কম আছে: ${low.join(', ')}।` : '');
}
