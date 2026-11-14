/**
 * Is this name already known? Pure TS. Used by the list importer (customers now,
 * products later). Order: exact → alias → same phone → phonetic key → fuzzy.
 * exact/alias = the same one; the rest = probably the same (the user decides).
 */
import { distance } from './customers';

/** NFC, one space, lower case, no punctuation at the ends. */
export const nameKey = (s: string) =>
  s
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[\s.,;:।\-–]+|[\s.,;:।\-–]+$/g, '')
    .toLowerCase();

// Bangla letter → sound class; vowels, vowel signs, ঁ, ্, য় drop out
const BN: Record<string, string> = {
  'ক': 'k', 'খ': 'k', 'গ': 'g', 'ঘ': 'g', 'ঙ': 'n',
  'চ': 'c', 'ছ': 'c', 'জ': 'j', 'ঝ': 'j', 'ঞ': 'n', 'য': 'j',
  'ট': 't', 'ঠ': 't', 'ড': 'd', 'ঢ': 'd', 'ণ': 'n',
  'ত': 't', 'থ': 't', 'দ': 'd', 'ধ': 'd', 'ন': 'n', 'ৎ': 't',
  'প': 'p', 'ফ': 'f', 'ব': 'b', 'ভ': 'b', 'ম': 'm',
  'র': 'r', 'ড়': 'r', 'ঢ়': 'r', 'ঋ': 'r', 'ল': 'l',
  'শ': 's', 'ষ': 's', 'স': 's', 'হ': 'h', 'ঃ': 'h', 'ং': 'n',
};
// Latin: digraphs first, then letters; vowels and y/w drop out
const LATIN_DIGRAPHS: [RegExp, string][] = [
  [/kh/g, 'k'], [/gh/g, 'g'], [/ch/g, 'c'], [/jh/g, 'j'], [/th/g, 't'], [/dh/g, 'd'],
  [/ph/g, 'f'], [/bh/g, 'b'], [/sh/g, 's'], [/x/g, 'ks'], [/q/g, 'k'], [/c/g, 'k'],
];
const LATIN: Record<string, string> = { z: 'j', v: 'b' };

/**
 * Sound skeleton: consonant classes only, doubles merged, so Bangla and English
 * spellings meet: রহিম / Rahim → "rhm", শফিক / সফিক → "sfk", মোহাম্মদ / Muhammad → "mhmd".
 */
export function phoneticKey(name: string): string {
  let s = nameKey(name);
  for (const [re, to] of LATIN_DIGRAPHS) s = s.replace(re, `\u0000${to}`);
  // digraph output is marked so "c" from "ch" isn't turned into "k" again
  const out: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === '\u0000') {
      out.push(s[++i]!);
      continue;
    }
    // Bangla nukta letters can arrive decomposed (ড + ়)
    if ((ch === 'ড' || ch === 'ঢ') && s[i + 1] === '়') {
      out.push('r');
      i++;
      continue;
    }
    if (BN[ch]) out.push(BN[ch]!);
    else if (/[bdfghjklmnprst]/.test(ch)) out.push(ch);
    else if (LATIN[ch]) out.push(LATIN[ch]!);
  }
  return out.filter((c, i) => c !== out[i - 1]).join('');
}

export interface Candidate {
  name: string;
  /** Other spellings already linked to it (product_aliases; customers have none yet). */
  aliases: readonly string[];
  phone: string | null;
  /** Where it is: "আগে থেকে" (in the shop) or "লাইন ৩" (earlier in the file). */
  label: string;
}

/** 'ai' (exp/gemini-audio only): Gemini's tidy-up said it is probably this customer. */
export type MatchHow = 'exact' | 'alias' | 'phone' | 'phonetic' | 'fuzzy' | 'ai';
export interface NameMatch {
  how: MatchHow;
  candidate: Candidate;
}

/** Same = exact or alias; the rest are only "probably the same". */
export const isSame = (how: MatchHow) => how === 'exact' || how === 'alias';

/**
 * Fuzzy: edits ≤ a third of the longer name (Levenshtein over code points), names of 5+
 * code points only — one edit in a short name is another name (চাল / ডাল, করিম / কবির).
 */
const FUZZY_MAX = 0.34;
const FUZZY_MIN_LEN = 5;

export function matchName(name: string, phone: string | null, candidates: readonly Candidate[]): NameMatch | null {
  const key = nameKey(name);
  if (!key) return null;
  const find = (how: MatchHow, test: (c: Candidate) => boolean): NameMatch | null => {
    const c = candidates.find(test);
    return c ? { how, candidate: c } : null;
  };
  const sound = phoneticKey(name);
  return (
    find('exact', (c) => nameKey(c.name) === key) ??
    find('alias', (c) => c.aliases.some((a) => nameKey(a) === key)) ??
    (phone ? find('phone', (c) => c.phone === phone) : null) ??
    (sound.length >= 2 ? find('phonetic', (c) => [c.name, ...c.aliases].some((n) => phoneticKey(n) === sound)) : null) ??
    bestFuzzy(key, candidates)
  );
}

function bestFuzzy(key: string, candidates: readonly Candidate[]): NameMatch | null {
  let best: { c: Candidate; score: number } | null = null;
  for (const c of candidates) {
    for (const n of [c.name, ...c.aliases]) {
      const k = nameKey(n);
      const len = Math.max([...key].length, [...k].length);
      if (len < FUZZY_MIN_LEN) continue;
      const score = distance(key, k) / len;
      if (score <= FUZZY_MAX && (!best || score < best.score)) best = { c, score };
    }
  }
  return best ? { how: 'fuzzy', candidate: best.c } : null;
}
