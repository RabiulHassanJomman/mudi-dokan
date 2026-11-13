/** Realistic variations beyond the plan examples. */
import { check, type Case } from './helpers';

const kg = (value: number) => ({ value, unit: 'kg' as const });

const sale: Case[] = [
  { text: 'আড়াই কেজি আলু', expected: { intent: 'sale', product: 'আলু', quantity: kg(2.5) } },
  { text: 'সাড়ে তিন কেজি চাল', expected: { intent: 'sale', product: 'চাল', quantity: kg(3.5) } },
  { text: 'আধা কেজি চিনি', expected: { intent: 'sale', product: 'চিনি', quantity: kg(0.5) } },
  { text: 'পৌনে দুই কেজি আলু', expected: { intent: 'sale', product: 'আলু', quantity: kg(1.75) } },
  { text: 'সোয়া কেজি পেঁয়াজ', expected: { intent: 'sale', product: 'পেঁয়াজ', quantity: kg(1.25) } },
  { text: 'দেড় লিটার তেল', expected: { intent: 'sale', product: 'তেল', quantity: { value: 1.5, unit: 'litre' } } },
  { text: '৩টা ডিম', expected: { intent: 'sale', product: 'ডিম', quantity: { value: 3, unit: 'piece' } } },
  { text: 'তিনটা ডিম', expected: { intent: 'sale', product: 'ডিম', quantity: { value: 3, unit: 'piece' } } },
  { text: 'দুটো সাবান', expected: { intent: 'sale', product: 'সাবান', quantity: { value: 2, unit: 'piece' } } },
  { text: 'এক ডজন ডিম', expected: { intent: 'sale', product: 'ডিম', quantity: { value: 1, unit: 'dozen' } } },
  { text: 'দুই হালি ডিম', expected: { intent: 'sale', product: 'ডিম', quantity: { value: 2, unit: 'hali' } } },
  { text: 'দুই প্যাকেট বিস্কুট', expected: { intent: 'sale', product: 'বিস্কুট', quantity: { value: 2, unit: 'packet' } } },
  { text: 'দুইটা প্যাকেট নুডলস', expected: { intent: 'sale', product: 'নুডলস', quantity: { value: 2, unit: 'packet' } } },
  { text: '৫০০ গ্রাম ডাল', expected: { intent: 'sale', product: 'ডাল', quantity: { value: 500, unit: 'g' } } },
  { text: '২৫০ গ্রাম জিরা', expected: { intent: 'sale', product: 'জিরা', quantity: { value: 250, unit: 'g' } } },
  { text: 'পেঁয়াজ এক পোয়া', expected: { intent: 'sale', product: 'পেঁয়াজ', quantity: kg(0.25) } },
  { text: 'পাঁচশ টাকার তেল', expected: { intent: 'sale', product: 'তেল', amount: 500 } },
  { text: 'চাল 2 কেজি', expected: { intent: 'sale', product: 'চাল', quantity: kg(2) } },
  { text: 'আটা ২ কেজি', expected: { intent: 'sale', product: 'আটা', quantity: kg(2) } },
  {
    text: 'চাল দুই কেজি একশ বিশ টাকা',
    expected: { intent: 'sale', product: 'চাল', quantity: kg(2), amount: 120 },
  },
  {
    text: 'এক কেজি চিনি একশ পঁচিশ টাকা',
    expected: { intent: 'sale', product: 'চিনি', quantity: kg(1), amount: 125 },
  },
  {
    text: 'এক লিটার সয়াবিন তেল',
    expected: { intent: 'sale', product: 'সয়াবিন তেল', quantity: { value: 1, unit: 'litre' } },
  },
  { text: 'চা পাতা এক প্যাকেট', expected: { intent: 'sale', product: 'চা পাতা', quantity: { value: 1, unit: 'packet' } } },
  { text: 'চাল বিক্রি ৫ কেজি', expected: { intent: 'sale', product: 'চাল', quantity: kg(5) } },
  {
    text: 'চাল ২ কেজি বিক্রি করলাম ১২০ টাকা',
    expected: { intent: 'sale', product: 'চাল', quantity: kg(2), amount: 120 },
  },
  { text: 'আজ চাল ৩ কেজি', expected: { intent: 'sale', product: 'চাল', quantity: kg(3), period: 'today' } },
  { text: 'চাল ২', expected: { intent: 'sale', product: 'চাল', quantity: { value: 2 } } },
  { text: 'চাল বিক্রি', expected: { intent: 'sale', product: 'চাল', missing: ['quantity'] } },
];

const purchase: Case[] = [
  { text: '২ বস্তা চাল কিনলাম', expected: { intent: 'purchase', product: 'চাল', quantity: { value: 2, unit: 'bosta' } } },
  {
    text: 'তেল ২০ লিটার কেনা ১৬০ বেচা ১৭০',
    expected: { intent: 'purchase', product: 'তেল', quantity: { value: 20, unit: 'litre' }, buyPrice: 160, sellPrice: 170 },
  },
  {
    text: 'নতুন সাবান ১২ পিস কেনা ৩০ বেচা ৩৫',
    expected: {
      intent: 'purchase', isNewProduct: true, product: 'সাবান',
      quantity: { value: 12, unit: 'piece' }, buyPrice: 30, sellPrice: 35,
    },
  },
  {
    text: 'চিনি ৫০ কেজি কিনলাম কেনা দাম ১২০ টাকা',
    expected: { intent: 'purchase', product: 'চিনি', quantity: kg(50), buyPrice: 120 },
  },
  { text: 'মসুর ডাল ২৫ কেজি এনেছি', expected: { intent: 'purchase', product: 'মসুর ডাল', quantity: kg(25) } },
  {
    text: 'নতুন বিস্কুট ২০ প্যাকেট',
    expected: {
      intent: 'purchase', isNewProduct: true, product: 'বিস্কুট',
      quantity: { value: 20, unit: 'packet' }, missing: ['buyPrice', 'sellPrice'],
    },
  },
  {
    text: '২ বস্তা চাল কিনলাম ৩০০০ টাকায়',
    expected: { intent: 'purchase', product: 'চাল', quantity: { value: 2, unit: 'bosta' }, amount: 3000 },
  },
];

const creditSale: Case[] = [
  {
    text: 'রহিম দুইটা সাবান বাকিতে নিল',
    expected: { intent: 'sale', credit: true, customer: 'রহিম', product: 'সাবান', quantity: { value: 2, unit: 'piece' } },
  },
  {
    text: 'সালমা আধা কেজি চিনি বাকিতে নিয়েছে',
    expected: { intent: 'sale', credit: true, customer: 'সালমা', product: 'চিনি', quantity: kg(0.5) },
  },
  {
    text: 'করিম ১০০ টাকার চাল বাকিতে নিল',
    expected: { intent: 'sale', credit: true, customer: 'করিম', product: 'চাল', amount: 100 },
  },
  {
    text: 'করিম দুই কেজি আলু বাকি নিল',
    expected: { intent: 'sale', credit: true, customer: 'করিম', product: 'আলু', quantity: kg(2) },
  },
];

const baki: Case[] = [
  { text: 'রহিম পাঁচশ টাকা বাকি', expected: { intent: 'baki', customer: 'রহিম', amount: 500 } },
  { text: 'জামাল দেড় হাজার টাকা বাকি', expected: { intent: 'baki', customer: 'জামাল', amount: 1500 } },
  { text: 'করিমের ৩০০ টাকা বাকি', expected: { intent: 'baki', customer: 'করিম', amount: 300 } },
  { text: 'রহিম ধার ২৫০', expected: { intent: 'baki', customer: 'রহিম', amount: 250 } },
  { text: 'করিম 200 টাকা বাকী', expected: { intent: 'baki', customer: 'করিম', amount: 200 } },
  { text: '৫০০ টাকা বাকি', expected: { intent: 'baki', amount: 500, missing: ['customer'] } },
  { text: 'করিম ২০০ টাকা বাকিতে নিল', expected: { intent: 'baki', customer: 'করিম', amount: 200 } },
];

const joma: Case[] = [
  { text: 'করিম দুই হাজার জমা দিল', expected: { intent: 'joma', customer: 'করিম', amount: 2000 } },
  { text: 'রহিম ৫০০ টাকা শোধ করেছে', expected: { intent: 'joma', customer: 'রহিম', amount: 500 } },
  { text: 'সাড়ে তিনশ টাকা জমা', expected: { intent: 'joma', amount: 350, missing: ['customer'] } },
  { text: '১,২০০ টাকা জমা করিম', expected: { intent: 'joma', customer: 'করিম', amount: 1200 } },
  { text: 'করিম ৫০০ টাকা দিল', expected: { intent: 'joma', customer: 'করিম', amount: 500 } },
  { text: 'জামাল ৳৩০০ জমা', expected: { intent: 'joma', customer: 'জামাল', amount: 300 } },
  { text: 'করিম জমা', expected: { intent: 'joma', customer: 'করিম', missing: ['amount'] } },
];

const queries: Case[] = [
  { text: 'আলু কত আছে', expected: { intent: 'stock_query', product: 'আলু' } },
  { text: 'তেলের স্টক কত', expected: { intent: 'stock_query', product: 'তেল' } },
  { text: 'ডিম আছে কত?', expected: { intent: 'stock_query', product: 'ডিম' } },
  { text: 'চাল কতটুকু আছে', expected: { intent: 'stock_query', product: 'চাল' } },
  { text: 'কত আছে', expected: { intent: 'stock_query', missing: ['product'] } },
  { text: 'আজকের লাভ কত', expected: { intent: 'profit_query', period: 'today' } },
  { text: 'আজকে লাভ কত হলো', expected: { intent: 'profit_query', period: 'today' } },
  { text: 'লাভ কত', expected: { intent: 'profit_query' } },
];

const context: Case[] = [
  {
    text: 'চাল ৫০ কেজি',
    ctx: { tab: 'purchase' },
    expected: { intent: 'purchase', product: 'চাল', quantity: kg(50) },
  },
  { text: 'চাল', ctx: { tab: 'stock' }, expected: { intent: 'stock_query', product: 'চাল' } },
  {
    text: 'করিম ৫০০',
    ctx: { tab: 'ledger' },
    expected: { intent: 'unknown', customer: 'করিম', amount: 500, missing: ['intent'] },
  },
  {
    // keyword beats the open tab
    text: 'করিম ৫০০ টাকা বাকি',
    ctx: { tab: 'sale' },
    expected: { intent: 'baki', customer: 'করিম', amount: 500 },
  },
  {
    text: 'আব্দুল করিম চাল ১ কেজি বাকিতে নিল',
    ctx: { knownCustomers: ['আব্দুল করিম'] },
    expected: { intent: 'sale', credit: true, customer: 'আব্দুল করিম', product: 'চাল', quantity: kg(1) },
  },
  {
    text: 'চাল ১ কেজি করিম বাকিতে নিল',
    ctx: { knownProducts: ['চাল'] },
    expected: { intent: 'sale', credit: true, customer: 'করিম', product: 'চাল', quantity: kg(1) },
  },
  {
    text: 'করিম মিনিকেট চাল ২ কেজি বাকিতে নিল',
    ctx: { knownProducts: ['মিনিকেট চাল', 'চাল'] },
    expected: { intent: 'sale', credit: true, customer: 'করিম', product: 'মিনিকেট চাল', quantity: kg(2) },
  },
];

const noise: Case[] = [
  { text: '  চাল   ২কেজি । ', expected: { intent: 'sale', product: 'চাল', quantity: kg(2) } },
  { text: 'ভাই চাল ২ কেজি দাও', expected: { intent: 'sale', product: 'চাল', quantity: kg(2) } },
  { text: 'হ্যালো কেমন আছেন', expected: { intent: 'unknown' } },
  { text: '', expected: { intent: 'unknown' } },
];

const groups: [string, Case[]][] = [
  ['sale', sale],
  ['purchase', purchase],
  ['credit sale', creditSale],
  ['baki', baki],
  ['joma', joma],
  ['queries', queries],
  ['context & known names', context],
  ['noise', noise],
];

describe.each(groups)('%s', (_, cases) => {
  it.each(cases.map((c) => [c.text + (c.ctx ? ` ${JSON.stringify(c.ctx)}` : ''), c] as const))('%s', (_n, c) =>
    check(c),
  );
});
