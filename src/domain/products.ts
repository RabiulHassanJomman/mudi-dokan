/** Which known product did STT probably mean? Fuzzy over names and aliases. Pure TS. */
import { tokenize } from '../parser/normalize';
import { distance } from './customers';

const norm = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim();

/** How far apart (edits ÷ length) a name may be and still be offered. */
const MAX_SCORE = 0.4;

/**
 * Products closest to a spoken name that matched none ("চাউল" → চাল, "পিঁয়াজ" →
 * পেঁয়াজ via its alias পিয়াজ, "সয়াবিন তেল" → তেল), best first, at most `n`.
 * A name or alias said as a whole word inside counts as closest.
 */
export function suggestProducts<T extends { name: string; aliases: readonly string[] }>(
  spoken: string,
  products: readonly T[],
  n = 3,
): T[] {
  const q = norm(spoken);
  if (!q) return [];
  const words = ` ${tokenize(q).join(' ')} `;
  const scored = products
    .map((p, order) => {
      let best = { d: Infinity, score: Infinity };
      for (const name of [p.name, ...p.aliases].map(norm)) {
        const inside = words.includes(` ${tokenize(name).join(' ')} `);
        const d = inside ? 0 : distance(q, name);
        const score = inside ? 0 : d / Math.max([...q].length, [...name].length);
        if (d < best.d || (d === best.d && score < best.score)) best = { d, score };
      }
      return { p, order, ...best };
    })
    .filter((x) => x.score <= MAX_SCORE)
    .sort((a, b) => a.d - b.d || a.score - b.score || a.order - b.order);
  return scored.slice(0, n).map((x) => x.p);
}
