/**
 * Multi-item sales (items[]) and per-unit prices ("করে", "প্রতি", "টাকা কেজি").
 * Every sale has items[]; each item carries unitPrice and total when they can be worked out.
 */
import { check, type Case } from './helpers';

const kg = (value: number) => ({ value, unit: 'kg' as const });

const multi: Case[] = [
  {
    text: 'করিম বাকিতে নিয়েছে দুই কেজি চাল ২০০ টাকা ৩ কেজি চাল ৪০০ টাকা ৫ কেজি তেল ৬০০ টাকা',
    expected: {
      intent: 'sale',
      credit: true,
      customer: 'করিম',
      amount: 1200,
      items: [
        { product: 'চাল', quantity: kg(2), unitPrice: 100, total: 200 },
        { product: 'চাল', quantity: kg(3), unitPrice: 133.33, total: 400 },
        { product: 'তেল', quantity: kg(5), unitPrice: 120, total: 600 },
      ],
    },
  },
  {
    // prices come from the DB later; parser leaves them out
    text: 'চাল ২ কেজি ডাল ১ কেজি সাবান ২টা',
    expected: {
      intent: 'sale',
      items: [
        { product: 'চাল', quantity: kg(2) },
        { product: 'ডাল', quantity: kg(1) },
        { product: 'সাবান', quantity: { value: 2, unit: 'piece' } },
      ],
    },
  },
  {
    text: 'চাল ২ কেজি ১২০ টাকা ডাল ১ কেজি',
    expected: {
      intent: 'sale',
      items: [
        { product: 'চাল', quantity: kg(2), unitPrice: 60, total: 120 },
        { product: 'ডাল', quantity: kg(1) },
      ],
    },
  },
  {
    text: '২ কেজি চাল ১ কেজি ডাল ১১০ টাকা',
    expected: {
      intent: 'sale',
      items: [
        { product: 'চাল', quantity: kg(2) },
        { product: 'ডাল', quantity: kg(1), unitPrice: 110, total: 110 },
      ],
    },
  },
  {
    text: '১০০ টাকার চিনি ২০০ টাকার চাল',
    expected: {
      intent: 'sale',
      amount: 300,
      items: [
        { product: 'চিনি', total: 100 },
        { product: 'চাল', total: 200 },
      ],
    },
  },
  {
    // same product twice stays two lines
    text: 'চাল ১ কেজি চাল ২ কেজি',
    expected: { intent: 'sale', items: [{ product: 'চাল', quantity: kg(1) }, { product: 'চাল', quantity: kg(2) }] },
  },
  {
    text: 'এক লিটার সয়াবিন তেল দুই প্যাকেট বিস্কুট',
    expected: {
      intent: 'sale',
      items: [
        { product: 'সয়াবিন তেল', quantity: { value: 1, unit: 'litre' } },
        { product: 'বিস্কুট', quantity: { value: 2, unit: 'packet' } },
      ],
    },
  },
];

const separators: Case[] = [
  {
    text: 'চাল ২ কেজি আর ডাল ১ কেজি',
    expected: { intent: 'sale', items: [{ product: 'চাল', quantity: kg(2) }, { product: 'ডাল', quantity: kg(1) }] },
  },
  {
    text: 'চাল ২ কেজি এবং ডাল এক কেজি একসাথে',
    expected: { intent: 'sale', items: [{ product: 'চাল', quantity: kg(2) }, { product: 'ডাল', quantity: kg(1) }] },
  },
  {
    text: 'চাল ২ কেজি সাথে একই ডাল ১ কেজি',
    expected: { intent: 'sale', items: [{ product: 'চাল', quantity: kg(2) }, { product: 'ডাল', quantity: kg(1) }] },
  },
  {
    // a separator splits two names with no number between them
    text: 'চা আর বিস্কুট ২ প্যাকেট',
    expected: {
      intent: 'sale',
      missing: ['quantity'],
      items: [{ product: 'চা' }, { product: 'বিস্কুট', quantity: { value: 2, unit: 'packet' } }],
    },
  },
];

const perUnit: Case[] = [
  {
    text: '২০০ টাকা করে ৩ কেজি চাল',
    expected: {
      intent: 'sale',
      product: 'চাল',
      quantity: kg(3),
      amount: 600,
      items: [{ product: 'চাল', quantity: kg(3), unitPrice: 200, priceUnit: 'kg', total: 600 }],
    },
  },
  {
    text: 'চাল ৩ কেজি, কেজি ২০০ করে',
    expected: {
      intent: 'sale',
      product: 'চাল',
      quantity: kg(3),
      amount: 600,
      items: [{ product: 'চাল', quantity: kg(3), unitPrice: 200, priceUnit: 'kg', total: 600 }],
    },
  },
  {
    // no করে: the number is the line total
    text: '৩ কেজি চাল ২০০ টাকা',
    expected: {
      intent: 'sale',
      product: 'চাল',
      quantity: kg(3),
      amount: 200,
      items: [{ product: 'চাল', quantity: kg(3), unitPrice: 66.67, total: 200 }],
    },
  },
  {
    text: 'চাল ৩ কেজি ২০০ টাকা কেজি',
    expected: { intent: 'sale', product: 'চাল', quantity: kg(3), amount: 600, items: [{ unitPrice: 200, total: 600 }] },
  },
  {
    text: 'চাল ৩ কেজি প্রতি কেজি ২০০ টাকা',
    expected: { intent: 'sale', product: 'চাল', quantity: kg(3), amount: 600, items: [{ unitPrice: 200, total: 600 }] },
  },
  {
    text: 'চাল ৩ কেজি কেজি প্রতি ২০০',
    expected: { intent: 'sale', product: 'চাল', quantity: kg(3), amount: 600, items: [{ unitPrice: 200, total: 600 }] },
  },
  {
    text: 'ডিম ১২টা ১২ টাকা করে',
    expected: {
      intent: 'sale',
      product: 'ডিম',
      quantity: { value: 12, unit: 'piece' },
      amount: 144,
      items: [{ unitPrice: 12, total: 144 }],
    },
  },
  {
    // price per kg, quantity in grams
    text: '৫০০ গ্রাম চাল কেজি ৬০ টাকা',
    expected: {
      intent: 'sale',
      product: 'চাল',
      quantity: { value: 500, unit: 'g' },
      amount: 30,
      items: [{ product: 'চাল', quantity: { value: 500, unit: 'g' }, unitPrice: 60, priceUnit: 'kg', total: 30 }],
    },
  },
  {
    text: 'চাল ২০০ টাকা করে',
    expected: { intent: 'sale', product: 'চাল', missing: ['quantity'], items: [{ product: 'চাল', unitPrice: 200 }] },
  },
  {
    text: 'চাল ২ কেজি ৬০ টাকা করে ডাল ১ কেজি ১১০ টাকা করে',
    expected: {
      intent: 'sale',
      amount: 230,
      items: [
        { product: 'চাল', quantity: kg(2), unitPrice: 60, total: 120 },
        { product: 'ডাল', quantity: kg(1), unitPrice: 110, total: 110 },
      ],
    },
  },
  {
    text: 'করিম ২০০ টাকা করে ৩ কেজি চাল বাকিতে নিল',
    expected: {
      intent: 'sale',
      credit: true,
      customer: 'করিম',
      product: 'চাল',
      quantity: kg(3),
      amount: 600,
      items: [{ product: 'চাল', quantity: kg(3), unitPrice: 200, total: 600 }],
    },
  },
];

const singles: Case[] = [
  // a one-item sale still fills product/quantity/amount and has items[1]
  {
    text: 'চাল ২ কেজি',
    expected: { intent: 'sale', product: 'চাল', quantity: kg(2), items: [{ product: 'চাল', quantity: kg(2) }] },
  },
  {
    text: 'চাল ২ কেজি ১২০ টাকা',
    expected: {
      intent: 'sale',
      product: 'চাল',
      quantity: kg(2),
      amount: 120,
      items: [{ product: 'চাল', quantity: kg(2), unitPrice: 60, total: 120 }],
    },
  },
  {
    text: 'করিম চাল ১ কেজি বাকিতে নিল',
    expected: {
      intent: 'sale',
      credit: true,
      customer: 'করিম',
      product: 'চাল',
      quantity: kg(1),
      items: [{ product: 'চাল', quantity: kg(1) }],
    },
  },
];

describe.each([
  ['multi-item', multi],
  ['separators', separators],
  ['per-unit price', perUnit],
  ['single item', singles],
] as const)('%s', (_, cases) => {
  it.each(cases.map((c) => [c.text, c] as const))('%s', (_n, c) => check(c));
});
