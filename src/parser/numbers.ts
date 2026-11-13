import { nfc, round, wordMap } from './util';

/** Bangla number words 0–99 (each is irregular) plus common spoken variants. */
const WORDS = wordMap<number>({
  শূন্য: 0,
  এক: 1, দুই: 2, দু: 2, তিন: 3, চার: 4, পাঁচ: 5, পাচ: 5, ছয়: 6, ছ: 6, সাত: 7, আট: 8, নয়: 9, দশ: 10,
  এগারো: 11, এগার: 11, বারো: 12, বার: 12, তেরো: 13, তের: 13, চৌদ্দ: 14, চোদ্দ: 14,
  পনেরো: 15, পনের: 15, ষোলো: 16, ষোল: 16, সতেরো: 17, সতের: 17, আঠারো: 18, আঠার: 18,
  উনিশ: 19, বিশ: 20, কুড়ি: 20,
  একুশ: 21, বাইশ: 22, তেইশ: 23, চব্বিশ: 24, পঁচিশ: 25, ছাব্বিশ: 26, সাতাশ: 27, আটাশ: 28, উনত্রিশ: 29, ত্রিশ: 30, তিরিশ: 30,
  একত্রিশ: 31, বত্রিশ: 32, তেত্রিশ: 33, চৌত্রিশ: 34, পঁয়ত্রিশ: 35, ছত্রিশ: 36, সাঁইত্রিশ: 37, আটত্রিশ: 38, উনচল্লিশ: 39, চল্লিশ: 40,
  একচল্লিশ: 41, বিয়াল্লিশ: 42, তেতাল্লিশ: 43, চুয়াল্লিশ: 44, পঁয়তাল্লিশ: 45, ছেচল্লিশ: 46, সাতচল্লিশ: 47, আটচল্লিশ: 48, উনপঞ্চাশ: 49, পঞ্চাশ: 50,
  একান্ন: 51, বায়ান্ন: 52, তিপ্পান্ন: 53, চুয়ান্ন: 54, পঞ্চান্ন: 55, ছাপ্পান্ন: 56, সাতান্ন: 57, আটান্ন: 58, উনষাট: 59, ষাট: 60,
  একষট্টি: 61, বাষট্টি: 62, তেষট্টি: 63, চৌষট্টি: 64, পঁয়ষট্টি: 65, ছেষট্টি: 66, সাতষট্টি: 67, আটষট্টি: 68, উনসত্তর: 69, সত্তর: 70,
  একাত্তর: 71, বাহাত্তর: 72, তিয়াত্তর: 73, চুয়াত্তর: 74, পঁচাত্তর: 75, ছিয়াত্তর: 76, সাতাত্তর: 77, আটাত্তর: 78, উনআশি: 79, আশি: 80,
  একাশি: 81, বিরাশি: 82, তিরাশি: 83, চুরাশি: 84, পঁচাশি: 85, ছিয়াশি: 86, সাতাশি: 87, আটাশি: 88, উননব্বই: 89, নব্বই: 90,
  একানব্বই: 91, বিরানব্বই: 92, তিরানব্বই: 93, চুরানব্বই: 94, পঁচানব্বই: 95, ছিয়ানব্বই: 96, সাতানব্বই: 97, আটানব্বই: 98, নিরানব্বই: 99,
  // fractions
  আধা: 0.5, আধ: 0.5, অর্ধেক: 0.5, দেড়: 1.5, আড়াই: 2.5,
});

/** Modifiers applied to the following base: সাড়ে তিন = 3.5, সাড়ে তিনশ = 350. */
const MODIFIERS = wordMap<number>({ সাড়ে: 0.5, সোয়া: 0.25, পৌনে: -0.25 });

const SCALES = wordMap<number>({
  শ: 100, শো: 100, শত: 100,
  হাজার: 1000,
  লাখ: 100_000, লক্ষ: 100_000,
  কোটি: 10_000_000,
});

/** Scale words that may stand alone without a base: "হাজার টাকা" = 1000. */
const STANDALONE_SCALES = new Set([1000, 100_000, 10_000_000]);

const CLASSIFIER_SUFFIXES = ['খানা', 'খান', 'টা', 'টি', 'টো', 'টে'].map(nfc);
const SCALE_SUFFIXES: [string, number][] = [
  ['শো', 100],
  ['শত', 100],
  ['শ', 100],
].map(([s, v]) => [nfc(s as string), v as number]);

const DIGITS = /^\d+(?:\.\d+)?$/;

interface Atom {
  base: number;
  scale?: number;
  classifier?: boolean;
}

function parseAtom(tok: string): Atom | null {
  if (DIGITS.test(tok)) return { base: parseFloat(tok) };
  const exact = WORDS.get(tok);
  if (exact !== undefined) return { base: exact };
  for (const suf of CLASSIFIER_SUFFIXES) {
    if (tok.length > suf.length && tok.endsWith(suf)) {
      const b = WORDS.get(tok.slice(0, -suf.length));
      if (b !== undefined) return { base: b, classifier: true };
    }
  }
  for (const [suf, scale] of SCALE_SUFFIXES) {
    if (tok.length > suf.length && tok.endsWith(suf)) {
      const b = WORDS.get(tok.slice(0, -suf.length));
      if (b !== undefined) return { base: b, scale };
    }
  }
  return null;
}

interface Group {
  value: number;
  scale: number;
  consumed: number;
  classifier: boolean;
}

/** One group: [modifier] base [scale], e.g. "সাড়ে তিন", "পাঁচশ", "দেড় হাজার". */
function parseGroup(tokens: readonly string[], i: number): Group | null {
  let j = i;
  const first = tokens[j];
  if (first === undefined) return null;

  const mod = MODIFIERS.get(first);
  if (mod !== undefined) j++;

  const tok = tokens[j];
  let atom = tok !== undefined ? parseAtom(tok) : null;
  if (atom) {
    j++;
  } else if (mod !== undefined) {
    // "সোয়া কেজি" = 1.25 kg; other modifiers need a base
    if (mod !== 0.25) return null;
    atom = { base: 1 };
  } else {
    const s = SCALES.get(first);
    if (s === undefined || !STANDALONE_SCALES.has(s)) return null;
    return { value: s, scale: s, consumed: 1, classifier: false };
  }

  let scale = atom.scale;
  if (scale === undefined && !atom.classifier) {
    const next = tokens[j];
    const s = next !== undefined ? SCALES.get(next) : undefined;
    if (s !== undefined) {
      scale = s;
      j++;
    }
  }
  return {
    value: round((atom.base + (mod ?? 0)) * (scale ?? 1)),
    scale: scale ?? 1,
    consumed: j - i,
    classifier: atom.classifier ?? false,
  };
}

export interface NumberMatch {
  value: number;
  /** Tokens consumed starting at the given index. */
  consumed: number;
  /** Had a classifier suffix (দুইটা, একটা) → counts pieces. */
  classifier: boolean;
}

/**
 * Parse a number starting at tokens[i]. Groups combine only in decreasing
 * scale ("এক হাজার পাঁচশ পঞ্চাশ" = 1550), so two adjacent plain numbers
 * ("কেনা ৫৫ বেচা ৬০") never merge.
 */
export function parseNumber(tokens: readonly string[], i: number): NumberMatch | null {
  const g = parseGroup(tokens, i);
  if (!g) return null;
  let total = g.value;
  let lastScale = g.scale;
  let j = i + g.consumed;
  let classifier = g.classifier;
  while (!classifier && lastScale > 1) {
    const n = parseGroup(tokens, j);
    if (!n || n.scale >= lastScale) break;
    total += n.value;
    lastScale = n.scale;
    j += n.consumed;
    classifier = n.classifier;
  }
  return { value: round(total), consumed: j - i, classifier };
}
