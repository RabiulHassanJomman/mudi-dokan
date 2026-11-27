import { tokenize } from '../normalize';
import { parseNumber } from '../numbers';

/** Parse the whole text as one number; fails if any token is left over. */
function num(text: string) {
  const tokens = tokenize(text);
  const r = parseNumber(tokens, 0);
  return r && r.consumed === tokens.length ? r : null;
}

describe('number words 1–99', () => {
  const WORDS_1_TO_99 = [
    'এক', 'দুই', 'তিন', 'চার', 'পাঁচ', 'ছয়', 'সাত', 'আট', 'নয়', 'দশ',
    'এগারো', 'বারো', 'তেরো', 'চৌদ্দ', 'পনেরো', 'ষোলো', 'সতেরো', 'আঠারো', 'উনিশ', 'বিশ',
    'একুশ', 'বাইশ', 'তেইশ', 'চব্বিশ', 'পঁচিশ', 'ছাব্বিশ', 'সাতাশ', 'আটাশ', 'উনত্রিশ', 'ত্রিশ',
    'একত্রিশ', 'বত্রিশ', 'তেত্রিশ', 'চৌত্রিশ', 'পঁয়ত্রিশ', 'ছত্রিশ', 'সাঁইত্রিশ', 'আটত্রিশ', 'উনচল্লিশ', 'চল্লিশ',
    'একচল্লিশ', 'বিয়াল্লিশ', 'তেতাল্লিশ', 'চুয়াল্লিশ', 'পঁয়তাল্লিশ', 'ছেচল্লিশ', 'সাতচল্লিশ', 'আটচল্লিশ', 'উনপঞ্চাশ', 'পঞ্চাশ',
    'একান্ন', 'বায়ান্ন', 'তিপ্পান্ন', 'চুয়ান্ন', 'পঞ্চান্ন', 'ছাপ্পান্ন', 'সাতান্ন', 'আটান্ন', 'উনষাট', 'ষাট',
    'একষট্টি', 'বাষট্টি', 'তেষট্টি', 'চৌষট্টি', 'পঁয়ষট্টি', 'ছেষট্টি', 'সাতষট্টি', 'আটষট্টি', 'উনসত্তর', 'সত্তর',
    'একাত্তর', 'বাহাত্তর', 'তিয়াত্তর', 'চুয়াত্তর', 'পঁচাত্তর', 'ছিয়াত্তর', 'সাতাত্তর', 'আটাত্তর', 'উনআশি', 'আশি',
    'একাশি', 'বিরাশি', 'তিরাশি', 'চুরাশি', 'পঁচাশি', 'ছিয়াশি', 'সাতাশি', 'আটাশি', 'উননব্বই', 'নব্বই',
    'একানব্বই', 'বিরানব্বই', 'তিরানব্বই', 'চুরানব্বই', 'পঁচানব্বই', 'ছিয়ানব্বই', 'সাতানব্বই', 'আটানব্বই', 'নিরানব্বই',
  ];
  it('has all 99 words', () => expect(WORDS_1_TO_99).toHaveLength(99));
  it.each(WORDS_1_TO_99.map((w, i) => [w, i + 1] as const))('%s = %d', (w, n) => {
    expect(num(w)?.value).toBe(n);
  });
});

describe('fractions, hundreds, thousands', () => {
  it.each([
    ['আধা', 0.5],
    ['আধ', 0.5],
    ['দেড়', 1.5],
    ['আড়াই', 2.5],
    ['সাড়ে তিন', 3.5],
    ['সোয়া দুই', 2.25],
    ['পৌনে দুই', 1.75],
    ['একশ', 100],
    ['একশো', 100],
    ['পাঁচশ', 500],
    ['পাচশ', 500],
    ['দুশো', 200],
    ['ছ শ', 600],
    ['পাঁচ শ', 500],
    ['আড়াইশ', 250],
    ['দেড়শ', 150],
    ['সাড়ে তিনশ', 350],
    ['একশ বিশ', 120],
    ['এক হাজার', 1000],
    ['হাজার', 1000],
    ['এক হাজার পাঁচশ', 1500],
    ['দেড় হাজার', 1500],
    ['আড়াই হাজার', 2500],
    ['পৌনে দুই হাজার', 1750],
    ['দুই হাজার তিনশ পঞ্চাশ', 2350],
    ['এক লাখ', 100000],
    ['দুই লক্ষ পঞ্চাশ হাজার', 250000],
  ])('%s = %d', (text, value) => {
    expect(num(text)?.value).toBe(value);
  });
});

describe('digits', () => {
  it.each([
    ['১৫০০', 1500],
    ['1500', 1500],
    ['১,৫০০', 1500],
    ['1,50,000', 150000],
    ['২.৫', 2.5],
    ['০.৫', 0.5],
    ['২ হাজার', 2000],
    ['২ হাজার ৫০০', 2500],
  ])('%s = %d', (text, value) => {
    expect(num(text)?.value).toBe(value);
  });
});

describe('classifier suffixes', () => {
  it.each([
    ['দুইটা', 2],
    ['দুটো', 2],
    ['দুটি', 2],
    ['একটা', 1],
    ['তিনটে', 3],
    ['পাঁচখানা', 5],
  ])('%s = %d pieces', (text, value) => {
    expect(num(text)).toEqual({ value, consumed: 1, classifier: true });
  });
});

describe('not numbers / boundaries', () => {
  it.each(['আটা', 'চাল', 'সাড়ে', 'টাকা', 'বিশ্বাস'])('%s is not a number', (w) => {
    expect(parseNumber(tokenize(w), 0)).toBeNull();
  });

  it('does not merge two plain numbers', () => {
    expect(parseNumber(tokenize('দুই ১২০'), 0)).toEqual({ value: 2, consumed: 1, classifier: false });
    expect(parseNumber(tokenize('৫৫ ৬০'), 0)?.value).toBe(55);
  });

  it('stops at the unit', () => {
    expect(parseNumber(tokenize('সাড়ে তিন কেজি'), 0)).toEqual({ value: 3.5, consumed: 2, classifier: false });
  });

  it('treats precomposed and nukta spellings the same', () => {
    const pre = 'আড়াই'; // ড় as one code point
    const dec = 'আড়াই'; // ড + nukta
    expect(num(pre)?.value).toBe(2.5);
    expect(num(dec)?.value).toBe(2.5);
    expect(num('ছয়শ')?.value).toBe(600); // ছয়শ
    expect(num('নয়')?.value).toBe(9);
    expect(num('নয়')?.value).toBe(9);
  });
});

describe('how the phone recognizer writes spoken numbers (A5, Nov 27)', () => {
  it.each([
    // "সাড়ে তিনশো" → "সাড়ে 300"
    ['সাড়ে 300', 350],
    ['সাড়ে ৩০০', 350],
    ['সাড়ে 2000', 2500],
    ['সাড়ে 3', 3.5],
    // "এক হাজার দুইশো" → "১০০০ ২০০"
    ['১০০০ ২০০', 1200],
    ['1000 200', 1200],
    ['2000 500 50', 2550],
    ['২০০ ৫০', 250],
    // still one number
    ['১০০ হাজার', 100000],
    ['1200', 1200],
  ])('%s = %d', (text, value) => {
    expect(num(text)?.value).toBe(value);
  });

  it('two numbers that are not a hundreds/thousands pair stay apart', () => {
    expect(num('২ ৫০০')).toBeNull();
    expect(num('৫০ ২০')).toBeNull();
    expect(num('১২০০ ৫০০')).toBeNull();
  });
});
