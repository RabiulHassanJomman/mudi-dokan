/**
 * ছবি দেখে বেছে নিন: a picked product + number + unit chip → the same ParsedCommand
 * shape the voice parser gives, so it goes to the same confirm card. Pure TS.
 */
import { UNIT_BN, formatNumber, formatQty, spokenQty } from '../lib/bn';
import type { ParsedCommand, Unit } from '../parser/types';

/** A unit chip, or টাকার ("১০০ টাকার চিনি": an amount, the quantity is worked out). */
export type PickMode = Unit | 'taka';

export interface PickedItem {
  product: string;
  value: number;
  mode: PickMode;
}

export interface PickProduct {
  id: string;
  name: string;
  unit: Unit;
  sellPricePoisha: number | null;
  aliases: string[];
}

const SUB_UNITS: Partial<Record<Unit, Unit[]>> = {
  kg: ['kg', 'g'],
  g: ['kg', 'g'],
  litre: ['litre', 'ml'],
  ml: ['litre', 'ml'],
  piece: ['piece', 'dozen'],
  dozen: ['dozen', 'piece'],
  hali: ['hali', 'piece'],
};

/** Chips for a product's unit; no product (or a new one): কেজি / গ্রাম / টাকার. */
export const pickUnits = (unit: Unit | null): PickMode[] => [...(unit ? SUB_UNITS[unit] ?? [unit] : ['kg', 'g'] as Unit[]), 'taka'];

const HALVES = new Set<PickMode>(['kg', 'litre', 'dozen', 'hali', 'bosta']);
export const halfAllowed = (mode: PickMode) => HALVES.has(mode);

export const pickModeLabel = (mode: PickMode) => (mode === 'taka' ? 'টাকার' : UNIT_BN[mode]);

/** "চাল ২½ কেজি", "১০০ টাকার চিনি" — for the log, the button and the "বেছে নিয়েছি" line. */
export const pickText = (p: PickedItem) =>
  p.mode === 'taka' ? `${formatNumber(p.value)} টাকার ${p.product}` : `${p.product} ${formatQty(p.value, p.mode)}`;

/** The same for TTS: "চাল আড়াই কেজি". */
export const pickWords = (p: PickedItem) =>
  p.mode === 'taka' ? pickText(p) : `${p.product} ${spokenQty(p.value, p.mode)}`;

export function pickedCommand(p: PickedItem): ParsedCommand {
  const text = pickText(p);
  const base = { intent: 'sale' as const, confidence: 'high' as const, missing: [], raw: text, normalized: text, product: p.product };
  if (p.mode === 'taka') {
    return { ...base, amount: p.value, items: [{ product: p.product, total: p.value, priceKind: 'total' }] };
  }
  const quantity = { value: p.value, unit: p.mode };
  return { ...base, quantity, items: [{ product: p.product, quantity }] };
}

const norm = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim();

/** Name or alias: starts-with matches first, then contains; order kept within each. */
export function filterProducts<T extends Pick<PickProduct, 'name' | 'aliases'>>(list: readonly T[], query: string): T[] {
  const q = norm(query);
  if (!q) return [...list];
  const names = (p: T) => [p.name, ...p.aliases].map(norm);
  const starts = list.filter((p) => names(p).some((n) => n.startsWith(q)));
  const contains = list.filter((p) => !starts.includes(p) && names(p).some((n) => n.includes(q)));
  return [...starts, ...contains];
}
