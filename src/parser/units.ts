import type { Unit } from './types';
import { wordMap } from './util';

export interface UnitMatch {
  unit: Unit;
  /** Multiply the spoken number by this (পোয়া = 0.25 kg). */
  factor: number;
}

const UNITS = wordMap<UnitMatch>({
  কেজি: { unit: 'kg', factor: 1 },
  কিলো: { unit: 'kg', factor: 1 },
  কিলোগ্রাম: { unit: 'kg', factor: 1 },
  kg: { unit: 'kg', factor: 1 },
  পোয়া: { unit: 'kg', factor: 0.25 },
  গ্রাম: { unit: 'g', factor: 1 },
  g: { unit: 'g', factor: 1 },
  gm: { unit: 'g', factor: 1 },
  লিটার: { unit: 'litre', factor: 1 },
  litre: { unit: 'litre', factor: 1 },
  liter: { unit: 'litre', factor: 1 },
  মিলি: { unit: 'ml', factor: 1 },
  ml: { unit: 'ml', factor: 1 },
  পিস: { unit: 'piece', factor: 1 },
  পিচ: { unit: 'piece', factor: 1 },
  pcs: { unit: 'piece', factor: 1 },
  টা: { unit: 'piece', factor: 1 },
  টি: { unit: 'piece', factor: 1 },
  টো: { unit: 'piece', factor: 1 },
  খানা: { unit: 'piece', factor: 1 },
  প্যাকেট: { unit: 'packet', factor: 1 },
  পেকেট: { unit: 'packet', factor: 1 },
  ডজন: { unit: 'dozen', factor: 1 },
  হালি: { unit: 'hali', factor: 1 },
  বস্তা: { unit: 'bosta', factor: 1 },
});

export function parseUnit(token: string): UnitMatch | null {
  return UNITS.get(token) ?? null;
}
