/**
 * The big Bangla number pad (Pick, Setup cash): ১–৯, ½, ০, ⌫. Pure TS.
 * State is a plain ASCII string: "2", "2.5" (½ adds ".5", only once, last).
 */
import { formatNumber, toBnDigits } from '../lib/bn';

export type PadKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'half' | 'back';

/** Screen order: ১ ২ ৩ / ৪ ৫ ৬ / ৭ ৮ ৯ / ½ ০ ⌫ */
export const PAD_KEYS: readonly PadKey[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'half', '0', 'back'];

export interface PadOptions {
  /** ½ key works (kg, litre…); off for গ্রাম, টাকার, cash. */
  allowHalf?: boolean;
  /** Whole-number digits (6 = up to ৯,৯৯,৯৯৯). */
  maxDigits?: number;
}

export function padPress(s: string, key: PadKey, { allowHalf = true, maxDigits = 6 }: PadOptions = {}): string {
  const half = s.endsWith('.5');
  if (key === 'back') {
    if (half) return s === '0.5' ? '' : s.slice(0, -2);
    return s.slice(0, -1);
  }
  if (key === 'half') {
    if (!allowHalf || half) return s;
    return `${s || '0'}.5`;
  }
  if (half) return s; // nothing after ½
  if (s === '0') return key;
  if (s.length >= maxDigits) return s;
  return s + key;
}

export const padValue = (s: string): number | null => (s === '' ? null : parseFloat(s));

/** "2.5" → "২½", "5000" → "৫,০০০", "0.5" → "½". */
export function padDisplay(s: string): string {
  if (s === '') return '';
  if (!s.endsWith('.5')) return formatNumber(parseFloat(s), 0);
  const whole = s.slice(0, -2);
  return `${whole === '0' ? '' : formatNumber(parseFloat(whole), 0)}½`;
}

/** A label for the screen reader / TTS. */
export const padKeyLabel = (k: PadKey) => (k === 'back' ? 'মুছুন' : k === 'half' ? 'আধা' : toBnDigits(k));
