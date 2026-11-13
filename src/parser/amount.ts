/**
 * One spoken amount of money, for questions like Setup's "এখন ক্যাশে কত টাকা?".
 * Pure TS. "পাঁচ হাজার টাকা" → 5000, "কিছু নেই" → 0, two different numbers → null.
 */
import { tokenize } from './normalize';
import { parseNumber } from './numbers';
import { nfc } from './util';

const NOTHING = new Set(['নেই', 'নাই', 'নাহ'].map(nfc));

export function parseSpokenAmount(text: string): number | null {
  const tokens = tokenize(text);
  const found: number[] = [];
  for (let i = 0; i < tokens.length; ) {
    const m = parseNumber(tokens, i);
    if (m) {
      found.push(m.value);
      i += m.consumed;
    } else i++;
  }
  if (found.length === 1) return found[0]!;
  if (found.length > 1) return null; // "পাঁচশ না ছয়শ": ask again
  return tokens.some((t) => NOTHING.has(t)) ? 0 : null;
}
