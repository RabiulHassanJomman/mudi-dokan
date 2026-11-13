import { parseCommand } from '../../parser';
import { classifyAnswer } from '../confirmWords';
import {
  canSave,
  diffDrafts,
  draftFromParse,
  readback,
  stepQuantity,
  withCredit,
  withCustomer,
  withPrice,
  type ProductInfo,
} from '../saleDraft';
import { convertQuantity, quantityStep } from '../units';
import { formatNumber, formatQty, formatTaka, parseTakaInput, toBnDigits } from '../../lib/bn';

const rice: ProductInfo = { id: 'p1', name: 'চাল', unit: 'kg', sellPricePoisha: 6000, costPricePoisha: 5500 };
const egg: ProductInfo = { id: 'p2', name: 'ডিম', unit: 'piece', sellPricePoisha: 1250, costPricePoisha: 1100 };
const p = (t: string) => parseCommand(t, { tab: 'sale' });

describe('bn formatting', () => {
  it.each([
    [8230, '৮,২৩০'],
    [120, '১২০'],
    [2.5, '২.৫'],
    [1234567.891, '১,২৩৪,৫৬৭.৮৯'],
    [0, '০'],
    [-500, '−৫০০'],
  ])('%d → %s', (n, s) => expect(formatNumber(n)).toBe(s));

  it('formats taka from poisha', () => {
    expect(formatTaka(12000)).toBe('৳ ১২০');
    expect(formatTaka(823000)).toBe('৳ ৮,২৩০');
    expect(formatTaka(13750)).toBe('৳ ১৩৭.৫');
  });
  it('formats quantity', () => expect(formatQty(0.5, 'kg')).toBe('০.৫ কেজি'));
  it('converts digits', () => expect(toBnDigits('2026')).toBe('২০২৬'));
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
    [1.5, 'kg', 'g', 1500],
    [1, 'dozen', 'piece', 12],
    [2, 'hali', 'piece', 8],
    [250, 'ml', 'litre', 0.25],
    [2, 'kg', 'piece', null],
  ] as const)('%d %s → %s = %s', (v, f, t, r) => expect(convertQuantity(v, f, t)).toBe(r));
  it('steps', () => {
    expect(quantityStep('kg')).toBe(0.5);
    expect(quantityStep('g')).toBe(50);
    expect(quantityStep('piece')).toBe(1);
  });
});

describe('draftFromParse', () => {
  it('price × quantity for a known product', () => {
    const d = draftFromParse(p('চাল ২ কেজি'), rice);
    expect(d).toMatchObject({ productName: 'চাল', quantity: 2, unit: 'kg', pricePoisha: 6000, amountPoisha: 12000 });
    expect(canSave(d)).toBe(true);
  });

  it('converts grams to the product unit', () => {
    expect(draftFromParse(p('৫০০ গ্রাম চাল'), rice)).toMatchObject({ quantity: 0.5, unit: 'kg', amountPoisha: 3000 });
  });

  it('dozen eggs → pieces', () => {
    expect(draftFromParse(p('এক ডজন ডিম'), egg)).toMatchObject({ quantity: 12, unit: 'piece', amountPoisha: 15000 });
  });

  it('"১০০ টাকার চিনি" → quantity from the price', () => {
    const sugar: ProductInfo = { ...rice, id: 'p3', name: 'চিনি', sellPricePoisha: 12500 };
    expect(draftFromParse(p('১০০ টাকার চিনি'), sugar)).toMatchObject({ quantity: 0.8, amountPoisha: 10000 });
  });

  it('spoken total wins and sets the unit price', () => {
    expect(draftFromParse(p('চাল ২ কেজি ১৩০ টাকা'), rice)).toMatchObject({ amountPoisha: 13000, pricePoisha: 6500 });
  });

  it('new product with a spoken total is saveable', () => {
    const d = draftFromParse(p('আটা ২ কেজি ১২০ টাকা'), null);
    expect(d).toMatchObject({ product: null, productName: 'আটা', unit: 'kg', pricePoisha: 6000, amountPoisha: 12000 });
    expect(canSave(d)).toBe(true);
  });

  it('new product without a price asks for it', () => {
    const d = draftFromParse(p('আটা ২ কেজি'), null);
    expect(d.problems).toEqual(['no_price']);
    expect(readback(d)).toBe('আটা ২ কেজি। দাম কত?');
    const fixed = withPrice(d, 6000);
    expect(fixed).toMatchObject({ amountPoisha: 12000, problems: [] });
  });

  it('kg spoken for a piece product is a mismatch', () => {
    expect(draftFromParse(p('ডিম ২ কেজি'), egg).problems).toContain('unit_mismatch');
  });

  it('no product name', () => {
    expect(draftFromParse(p('২ কেজি'), null).problems).toContain('no_product');
  });

  it('credit sale needs a customer', () => {
    const d = draftFromParse(p('করিম চাল ১ কেজি বাকিতে নিল'), rice);
    expect(d).toMatchObject({ credit: true, customerName: 'করিম', amountPoisha: 6000, problems: [] });
    const noName = withCredit(draftFromParse(p('চাল ১ কেজি'), rice), true);
    expect(noName.problems).toEqual(['no_customer']);
    expect(withCustomer(noName, ' রহিম ').problems).toEqual([]);
  });

  it('stepper keeps amount in sync', () => {
    const d = stepQuantity(draftFromParse(p('চাল ২ কেজি'), rice), 1);
    expect(d).toMatchObject({ quantity: 2.5, amountPoisha: 15000 });
    expect(stepQuantity(stepQuantity(stepQuantity(d, -1), -1), -1)).toMatchObject({ quantity: 1 });
  });

  it('stepping to zero blocks saving', () => {
    const d = stepQuantity(stepQuantity(draftFromParse(p('চাল ১ কেজি'), rice), -1), -1);
    expect(d.quantity).toBe(0);
    expect(canSave(d)).toBe(false);
  });
});

describe('readback', () => {
  it.each([
    ['চাল ২ কেজি', rice, 'চাল ২ কেজি, ১২০ টাকা। ঠিক আছে?'],
    ['করিম চাল ১ কেজি বাকিতে নিল', rice, 'চাল ১ কেজি, ৬০ টাকা, করিম-এর বাকি। ঠিক আছে?'],
    ['চাল বিক্রি', rice, 'চাল। কতটুকু?'],
    ['২ কেজি', null, 'মালের নাম বুঝিনি। আবার বলুন।'],
  ] as const)('%s', (t, prod, s) => {
    expect(readback(draftFromParse(p(t), prod))).toBe(s);
  });
});

describe('diffDrafts', () => {
  it('lists changed fields', () => {
    const a = draftFromParse(p('চাল ২ কেজি'), rice);
    const b = withCredit(stepQuantity(a, 1), true);
    expect(diffDrafts(a, b)).toEqual(['quantity', 'amountPoisha', 'credit']);
    expect(diffDrafts(a, a)).toEqual([]);
  });
});

describe('classifyAnswer', () => {
  it.each([
    ['হ্যাঁ', 'yes'],
    ['হ্যাঁ ঠিক আছে', 'yes'],
    ['জি', 'yes'],
    ['ঠিক আছে', 'yes'],
    ['না', 'no'],
    ['না ভুল', 'no'],
    ['ঠিক না', 'no'],
    ['বাতিল', 'no'],
    ['চাল দুই কেজি', null],
    ['', null],
  ] as const)('%s → %s', (t, r) => expect(classifyAnswer(t)).toBe(r));
});
