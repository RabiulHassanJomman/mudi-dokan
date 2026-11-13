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
