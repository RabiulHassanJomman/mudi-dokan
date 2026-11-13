/**
 * Fixes from the Gemini eval (eval/fixtures.jsonl): aliases, "<name> <product> <qty> বাকি",
 * and three basket splits that went wrong.
 */
import { parseCommand } from '../parse';
import type { ParseContext } from '../types';

const ctx: ParseContext = {
  tab: 'sale',
  knownProducts: ['চাল', 'ডাল', 'তেল', 'চিনি', 'ডিম', 'সাবান', 'পেঁয়াজ', 'রসুন', 'দুধ'],
  knownCustomers: ['করিম', 'হাসান', 'সুমি'],
  productAliases: {
    চাউল: 'চাল',
    পিয়াজ: 'পেঁয়াজ',
    পিঁয়াজ: 'পেঁয়াজ',
    'লাক্স সাবান': 'সাবান',
    'সয়াবিন তেল': 'তেল',
  },
};
const kg = (value: number) => ({ value, unit: 'kg' as const });
const p = (t: string, c: ParseContext = ctx) => parseCommand(t, c);

describe('product aliases (ctx.productAliases, from product_aliases)', () => {
  it('চাউল → চাল', () => {
    expect(p('চাউল পাঁচ কেজি').items).toEqual([{ product: 'চাল', quantity: kg(5) }]);
  });
  it('পিয়াজ → পেঁয়াজ, next to a known product', () => {
    expect(p('পিয়াজ এক কেজি আর রসুন আড়াইশো গ্রাম').items).toEqual([
      { product: 'পেঁয়াজ', quantity: kg(1) },
      { product: 'রসুন', quantity: { value: 250, unit: 'g' } },
    ]);
  });
  it('brand + product: লাক্স সাবান → সাবান', () => {
    expect(p('লাক্স সাবান দুইটা আশি টাকা')).toMatchObject({
      amount: 80,
      items: [{ product: 'সাবান', quantity: { value: 2, unit: 'piece' }, total: 80 }],
    });
  });
  it('stock query uses the alias too', () => {
    expect(p('চাউল কত আছে')).toMatchObject({ intent: 'stock_query', product: 'চাল' });
  });
  it('no aliases given: the spoken name stays', () => {
    expect(p('চাউল পাঁচ কেজি', { tab: 'sale' }).items).toEqual([{ product: 'চাউল', quantity: kg(5) }]);
  });
});

describe('"<name> <product> <qty> বাকি" is a credit sale, not a ledger entry', () => {
  it.each([
    ['করিম চাল দশ কেজি বাকি', ctx, 'করিম', 'চাল', 10],
    ['রহিম ডাল ২ কেজি বাকি', { tab: 'sale' } as ParseContext, 'রহিম', 'ডাল', 2],
  ])('%s', (t, c, customer, product, q) => {
    expect(p(t, c)).toMatchObject({ intent: 'sale', credit: true, customer, items: [{ product, quantity: kg(q) }] });
  });
  it('still a ledger entry without goods', () => {
    expect(p('করিম ২০০ টাকা বাকি')).toMatchObject({ intent: 'baki', customer: 'করিম', amount: 200 });
    expect(p('জামাল ভাইয়ের নামে তিনশো টাকা বাকি লেখেন', { tab: 'ledger' })).toMatchObject({
      intent: 'baki',
      customer: 'জামাল',
      amount: 300,
    });
  });
});

describe('basket splits', () => {
  it('"… হাসান কে": the separate কে is not a product line', () => {
    expect(p('বাকিতে দুই লিটার সয়াবিন তেল দিলাম হাসান কে')).toMatchObject({
      intent: 'sale',
      credit: true,
      customer: 'হাসান',
      items: [{ product: 'তেল', quantity: { value: 2, unit: 'litre' } }],
    });
    expect(p('বাকিতে দুই লিটার সয়াবিন তেল দিলাম হাসান কে', { tab: 'sale' })).toMatchObject({
      customer: 'হাসান',
      items: [{ product: 'সয়াবিন তেল', quantity: { value: 2, unit: 'litre' } }],
    });
  });

  it('honorific after the name (সুমি আপু) is not a product line', () => {
    const t = 'সুমি আপু বাকিতে নিছে ডিম এক হালি পঞ্চাশ টাকা আর দুধ এক লিটার আশি টাকা';
    const want = {
      intent: 'sale',
      credit: true,
      customer: 'সুমি',
      amount: 130,
      items: [
        { product: 'ডিম', quantity: { value: 1, unit: 'hali' }, total: 50 },
        { product: 'দুধ', quantity: { value: 1, unit: 'litre' }, total: 80 },
      ],
    };
    expect(p(t)).toMatchObject(want);
    expect(p(t, { tab: 'sale', knownProducts: ctx.knownProducts })).toMatchObject(want);
  });

  it('"চাল পাঁচ কেজি, কেজি বাহান্ন টাকা করে": বাহান্ন is 52, a per-kg price', () => {
    expect(p('চাল পাঁচ কেজি, কেজি বাহান্ন টাকা করে')).toMatchObject({
      amount: 260,
      items: [{ product: 'চাল', quantity: kg(5), unitPrice: 52, total: 260, priceKind: 'unit' }],
    });
  });

  it.each([
    ['বাহান্ন টাকা জমা', 52],
    ['তেপ্পান্ন টাকা জমা', 53],
  ])('%s', (t, n) => expect(p(t, { tab: 'ledger' }).amount).toBe(n));
});
