import type { Unit } from '../parser/types';

/** How many base units one unit is: kg/g share mass, litre/ml volume, dozen/hali/piece count. */
const BASE: Readonly<Record<Unit, readonly [string, number]>> = {
  kg: ['mass', 1000],
  g: ['mass', 1],
  litre: ['volume', 1000],
  ml: ['volume', 1],
  piece: ['count', 1],
  hali: ['count', 4],
  dozen: ['count', 12],
  packet: ['packet', 1],
  bosta: ['bosta', 1],
};

/** 500 g → 0.5 kg; 1 dozen → 12 piece. null when the units can't convert (kg ↔ piece). */
export function convertQuantity(value: number, from: Unit, to: Unit): number | null {
  const [fk, fv] = BASE[from];
  const [tk, tv] = BASE[to];
  if (fk !== tk) return null;
  return Math.round(((value * fv) / tv) * 1000) / 1000;
}

/** +/− step on the confirm card. */
export function quantityStep(unit: Unit): number {
  if (unit === 'kg' || unit === 'litre') return 0.5;
  if (unit === 'g' || unit === 'ml') return 50;
  return 1;
}
