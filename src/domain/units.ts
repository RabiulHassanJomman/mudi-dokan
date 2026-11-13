import { convertUnit } from '../parser/units';
import type { Unit } from '../parser/types';

/** 500 g → 0.5 kg; 1 dozen → 12 piece. null when the units can't convert (kg ↔ piece). */
export function convertQuantity(value: number, from: Unit, to: Unit): number | null {
  const v = convertUnit(value, from, to);
  return v === null ? null : Math.round(v * 1000) / 1000;
}

/** +/− step on the confirm card. */
export function quantityStep(unit: Unit): number {
  if (unit === 'kg' || unit === 'litre') return 0.5;
  if (unit === 'g' || unit === 'ml') return 50;
  return 1;
}

/** Mass and volume are taken 1:1 (1 kg ≈ 1 litre, 1 g ≈ 1 ml); counts never mix with them. */
const LOOSE: Partial<Record<Unit, number>> = { kg: 1000, g: 1, litre: 1000, ml: 1 };

/**
 * For a unit the product isn't sold in ("৫ কেজি তেল" when তেল is by the litre):
 * no real conversion, just the same number in the product's unit (500 g → 0.5 litre,
 * 2 kg ডিম → 2 piece). The confirm card warns instead.
 */
export function looseQuantity(value: number, from: Unit, to: Unit): number {
  const exact = convertQuantity(value, from, to);
  if (exact !== null) return exact;
  const f = LOOSE[from];
  const t = LOOSE[to];
  return f && t ? Math.round(((value * f) / t) * 1000) / 1000 : value;
}
