import { parseCommand } from '../../parser';
import { formatNumber, formatQty, formatTaka, parseTakaInput, toBnDigits } from '../../lib/bn';
import {
  basketFromParse,
  canSave,
  diffBaskets,
  readback,
  removeItem,
  setItemPrice,
  stepItem,
  withCredit,
  withCustomer,
  type BasketDraft,
  type ProductInfo,
} from '../basket';
import { classifyAnswer } from '../confirmWords';
import { convertQuantity, quantityStep } from '../units';

const P = (name: string, unit: ProductInfo['unit'], sell: number | null, id = name): ProductInfo => ({
  id,
  name,
  unit,
  sellPricePoisha: sell,
  costPricePoisha: null,
});
const catalog = new Map<string, ProductInfo>([
  ['চাল', P('চাল', 'kg', 6000)],
  ['ডাল', P('ডাল', 'kg', 11000)],
  ['তেল', P('তেল', 'kg', 17500)],
  ['সাবান', P('সাবান', 'piece', 4500)],
  ['ডিম', P('ডিম', 'piece', 1250)],
  ['চিনি', P('চিনি', 'kg', 12500)],
]);
const basket = (text: string, products: ReadonlyMap<string, ProductInfo> = catalog) =>
  basketFromParse(parseCommand(text, { tab: 'sale' }), products);
const lines = (b: BasketDraft) => b.items.map((i) => [i.productName, i.quantity, i.unit, i.pricePoisha, i.amountPoisha]);

describe('bn formatting', () => {
  it.each([
    [8230, '৮,২৩০'],
    [2.5, '২.৫'],
    [1234567.891, '১,২৩৪,৫৬৭.৮৯'],
    [0, '০'],
    [-500, '−৫০০'],
  ])('%d → %s', (n, s) => expect(formatNumber(n)).toBe(s));
  it('taka, qty, digits', () => {
    expect(formatTaka(823000)).toBe('৳ ৮,২৩০');
    expect(formatTaka(13750)).toBe('৳ ১৩৭.৫');
    expect(formatQty(0.5, 'kg')).toBe('০.৫ কেজি');
    expect(toBnDigits('2026')).toBe('২০২৬');
  });
  it.each([
    ['১২০', 12000],
    ['120.5', 12050],
    ['৳ ১,২০০', 120000],
    ['abc', null],
    ['', null],
  ])('taka input %s → %s', (t, v) => expect(parseTakaInput(t)).toBe(v));
});

describe('units', () => {
  it.each([
    [500, 'g', 'kg', 0.5],
    [1, 'dozen', 'piece', 12],
    [250, 'ml', 'litre', 0.25],
    [2, 'kg', 'piece', null],
  ] as const)('%d %s → %s = %s', (v, f, t, r) => expect(convertQuantity(v, f, t)).toBe(r));
  it('steps', () => expect([quantityStep('kg'), quantityStep('g'), quantityStep('piece')]).toEqual([0.5, 50, 1]));
});

describe('basketFromParse', () => {
  it('the voice-test basket: customer, baki, three lines with spoken totals', () => {
    const b = basket('করিম বাকিতে নিয়েছে দুই কেজি চাল ২০০ টাকা ৩ কেজি চাল ৪০০ টাকা ৫ কেজি তেল ৬০০ টাকা');
    expect(b).toMatchObject({ credit: true, customerName: 'করিম', totalPoisha: 120000, problems: [] });
    expect(lines(b)).toEqual([
      ['চাল', 2, 'kg', 10000, 20000],
      ['চাল', 3, 'kg', 13333, 40000],
      ['তেল', 5, 'kg', 12000, 60000],
    ]);
    // ৳100/kg and ৳133/kg vs stored ৳60 → flagged; ৳120 vs ৳175 → flagged (>20%)
    expect(b.items.map((i) => i.priceWarning)).toEqual([true, true, true]);
    expect(canSave(b)).toBe(true);
  });

  it('prices from the DB when none are spoken', () => {
    const b = basket('চাল ২ কেজি ডাল ১ কেজি সাবান ২টা');
    expect(lines(b)).toEqual([
      ['চাল', 2, 'kg', 6000, 12000],
      ['ডাল', 1, 'kg', 11000, 11000],
      ['সাবান', 2, 'piece', 4500, 9000],
    ]);
    expect(b.totalPoisha).toBe(32000);
    expect(b.items.some((i) => i.priceWarning)).toBe(false);
  });

  it('per-unit price: total = qty × unit price', () => {
    const b = basket('২০০ টাকা করে ৩ কেজি চাল');
    expect(lines(b)).toEqual([['চাল', 3, 'kg', 20000, 60000]]);
  });

  it('per-kg price for a quantity in grams', () => {
    const b = basket('৫০০ গ্রাম চাল কেজি ৬০ টাকা');
    expect(lines(b)).toEqual([['চাল', 0.5, 'kg', 6000, 3000]]);
    expect(b.items[0]!.priceWarning).toBe(false);
  });

  it('within 20% is not flagged', () => {
    expect(basket('চাল ২ কেজি ১৩০ টাকা').items[0]!.priceWarning).toBe(false); // ৳65 vs ৳60
    expect(basket('চাল ২ কেজি ১৫০ টাকা').items[0]!.priceWarning).toBe(true); // ৳75 vs ৳60
  });

  it('"১০০ টাকার চিনি" → quantity from the stored price', () => {
    expect(lines(basket('১০০ টাকার চিনি'))).toEqual([['চিনি', 0.8, 'kg', 12500, 10000]]);
  });

  it('dozen → pieces', () => {
    expect(lines(basket('এক ডজন ডিম'))).toEqual([['ডিম', 12, 'piece', 1250, 15000]]);
  });

  it('new product: spoken total sets the price; no price → asks', () => {
    expect(lines(basket('আটা ২ কেজি ১২০ টাকা'))).toEqual([['আটা', 2, 'kg', 6000, 12000]]);
    const b = basket('আটা ২ কেজি চাল ১ কেজি');
    expect(b.items[0]!.problems).toEqual(['no_price']);
    expect(b.problems).toEqual(['item']);
    expect(b.totalPoisha).toBeNull();
    expect(canSave(b)).toBe(false);
  });

  it('kg for a piece product is a mismatch', () => {
    expect(basket('ডিম ২ কেজি').items[0]!.problems).toContain('unit_mismatch');
  });

  it('credit needs a customer', () => {
    const b = withCredit(basket('চাল ১ কেজি'), true);
    expect(b.problems).toEqual(['no_customer']);
    expect(withCustomer(b, ' রহিম ').problems).toEqual([]);
  });

  it('nothing heard', () => {
    expect(basket('বিক্রি').problems).toContain('no_items');
  });
});

describe('editing', () => {
  const b0 = basket('চাল ২ কেজি ডাল ১ কেজি');

  it('± one line keeps the total in sync', () => {
    const b = stepItem(b0, b0.items[0]!.key, 1);
    expect(lines(b)[0]).toEqual(['চাল', 2.5, 'kg', 6000, 15000]);
    expect(b.totalPoisha).toBe(26000);
  });

  it('price edit clears the warning and recomputes', () => {
    const w = basket('চাল ২ কেজি ২০০ টাকা');
    expect(w.items[0]!.priceWarning).toBe(true);
    const b = setItemPrice(w, w.items[0]!.key, 6500);
    expect(b.items[0]).toMatchObject({ pricePoisha: 6500, amountPoisha: 13000, priceWarning: false });
  });

  it('remove a line', () => {
    const b = removeItem(b0, b0.items[0]!.key);
    expect(lines(b)).toEqual([['ডাল', 1, 'kg', 11000, 11000]]);
    expect(b.totalPoisha).toBe(11000);
    expect(removeItem(b, b.items[0]!.key).problems).toEqual(['no_items']);
  });

  it('stepping to zero blocks saving', () => {
    const one = basket('চাল ১ কেজি');
    const k = one.items[0]!.key;
    expect(canSave(stepItem(stepItem(one, k, -1), k, -1))).toBe(false);
  });

  it('diff names the edited lines and fields', () => {
    const b = removeItem(withCredit(stepItem(b0, b0.items[1]!.key, 1), true), b0.items[0]!.key);
    expect(diffBaskets(b0, b)).toEqual(['items[0].removed', 'items[1].quantity', 'items[1].amountPoisha', 'credit']);
    expect(diffBaskets(b0, b0)).toEqual([]);
  });
});

describe('readback', () => {
  it.each([
    ['চাল ২ কেজি', 'চাল ২ কেজি, ১২০ টাকা। ঠিক আছে?'],
    ['করিম চাল ১ কেজি বাকিতে নিল', 'করিম, বাকি। চাল ১ কেজি, ৬০ টাকা। ঠিক আছে?'],
    [
      'করিম বাকিতে নিয়েছে দুই কেজি চাল ২০০ টাকা ৩ কেজি চাল ৪০০ টাকা ৫ কেজি তেল ৬০০ টাকা',
      'করিম, বাকি। চাল ২ কেজি ২০০, চাল ৩ কেজি ৪০০, তেল ৫ কেজি ৬০০। মোট ১২০০ টাকা। ঠিক আছে?',
    ],
    [
      'চাল ১ কেজি ডাল ১ কেজি তেল ১ কেজি চিনি ১ কেজি সাবান ১টা',
      '৫টি জিনিস, মোট ৫১৫ টাকা। ঠিক আছে?',
    ],
    ['আটা ২ কেজি', 'আটা ২ কেজি। দাম কত?'],
    ['আটা ২ কেজি চাল ১ কেজি', 'আটা ২ কেজি, চাল ১ কেজি ৬০। আটা দাম কত?'],
    ['চাল বিক্রি', 'চাল। কতটুকু?'],
    ['২ কেজি', 'মালের নাম বুঝিনি। আবার বলুন।'],
    ['বিক্রি', 'কিছু বুঝিনি। আবার বলুন।'],
  ])('%s', (t, s) => expect(readback(basket(t))).toBe(s));
});

describe('classifyAnswer', () => {
  it.each([
    ['হ্যাঁ', 'yes'],
    ['হ্যাঁ ঠিক আছে', 'yes'],
    ['জি', 'yes'],
    ['না', 'no'],
    ['ঠিক না', 'no'],
    ['বাতিল', 'no'],
    ['চাল দুই কেজি', null],
    ['', null],
  ] as const)('%s → %s', (t, r) => expect(classifyAnswer(t)).toBe(r));
});
