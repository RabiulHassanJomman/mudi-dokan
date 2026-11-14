/** Customer names: is it someone we know, and who did STT probably mean? Pure TS. */

const norm = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim();

export type CustomerStatus = 'known' | 'unknown' | 'missing';

export function customerStatus(name: string | null | undefined, known: readonly string[]): CustomerStatus {
  const n = norm(name ?? '');
  if (!n) return 'missing';
  return known.some((k) => norm(k) === n) ? 'known' : 'unknown';
}

/** Levenshtein distance over code points (Bangla vowel signs count as one each). */
function distance(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[y.length]!;
}

/**
 * Known names closest to an unknown one ("কোরিম" → করিম), best first, at most `n`.
 * Only names within about a third of the length are offered; others are noise.
 */
export function suggestCustomers(name: string, known: readonly string[], n = 3): string[] {
  const q = norm(name);
  if (!q) return [];
  return known
    .map((k) => {
      const d = distance(q, norm(k));
      return { k, d, score: d / Math.max([...q].length, [...norm(k)].length) };
    })
    .filter((x) => x.score <= 0.4)
    .sort((a, b) => a.d - b.d || a.score - b.score)
    .slice(0, n)
    .map((x) => x.k);
}

// Bangla marks that belong to the letter before them: vowel signs, ং ঃ ঁ, nukta, ৗ
const MARK = /[ঁ-ঃ়া-ৌৗ]/;
const VIRAMA = '্';

/** First letter for the avatar, with its conjunct and vowel sign: "শ্যামল" → "শ্যা". */
export function initialOf(name: string): string {
  const cs = [...norm(name)];
  if (!cs.length) return '?';
  let out = cs[0]!;
  let i = 1;
  while (i < cs.length) {
    if (cs[i] === VIRAMA && i + 1 < cs.length) {
      out += cs[i]! + cs[i + 1]!;
      i += 2;
    } else if (MARK.test(cs[i]!)) {
      out += cs[i]!;
      i++;
    } else break;
  }
  return out;
}
