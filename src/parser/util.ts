/**
 * NFC normalisation. Note: য় ড় ঢ় are composition exclusions, so NFC turns the
 * precomposed forms into base + nukta. Applying NFC to both input and every
 * lookup table makes the two spellings STT may emit compare equal.
 */
export const nfc = (s: string): string => s.normalize('NFC');

export const wordSet = (words: readonly string[]): ReadonlySet<string> =>
  new Set(words.map(nfc));

export const wordMap = <T>(entries: Record<string, T>): ReadonlyMap<string, T> =>
  new Map(Object.entries(entries).map(([k, v]) => [nfc(k), v] as const));

export const round = (v: number): number => Math.round(v * 1e6) / 1e6;
