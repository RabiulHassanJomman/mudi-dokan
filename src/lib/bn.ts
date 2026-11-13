/** Bangla display helpers. Pure TS. */
import type { Unit } from '../parser/types';

export const toBnDigits = (s: number | string): string =>
  String(s).replace(/\d/g, (d) => String.fromCharCode(0x09e6 + Number(d)));

/** 8230 → "৮,২৩০", 2.5 → "২.৫" (at most `maxFraction` decimals, trailing zeros dropped). */
export function formatNumber(n: number, maxFraction = 2): string {
  const neg = n < 0;
  const fixed = Math.abs(n).toFixed(maxFraction).replace(/\.?0+$/, '');
  const [int = '0', frac] = fixed.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return toBnDigits(`${neg ? '−' : ''}${grouped}${frac ? `.${frac}` : ''}`);
}

/** 12000 poisha → "৳ ১২০". */
export const formatTaka = (poisha: number): string => `৳ ${formatNumber(poisha / 100)}`;

export const UNIT_BN: Readonly<Record<Unit, string>> = {
  kg: 'কেজি',
  g: 'গ্রাম',
  litre: 'লিটার',
  ml: 'মিলি',
  piece: 'পিস',
  packet: 'প্যাকেট',
  dozen: 'ডজন',
  hali: 'হালি',
  bosta: 'বস্তা',
};

/** "তেল সাধারণত লিটারে" — the unit with the locative ending. */
export const UNIT_BN_LOC: Readonly<Record<Unit, string>> = {
  kg: 'কেজিতে',
  g: 'গ্রামে',
  litre: 'লিটারে',
  ml: 'মিলিতে',
  piece: 'পিসে',
  packet: 'প্যাকেটে',
  dozen: 'ডজনে',
  hali: 'হালিতে',
  bosta: 'বস্তায়',
};

/** 2, kg → "২ কেজি". */
export const formatQty = (value: number, unit: Unit): string => `${formatNumber(value, 3)} ${UNIT_BN[unit]}`;

/** Taka typed by the user ("১২০", "120.5") → poisha, or null. */
export function parseTakaInput(text: string): number | null {
  const ascii = text.replace(/[০-৯]/g, (d) => String(d.charCodeAt(0) - 0x09e6)).replace(/[,\s৳]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(ascii)) return null;
  return Math.round(parseFloat(ascii) * 100);
}
