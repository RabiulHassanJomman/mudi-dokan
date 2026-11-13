/** খরচ (expense) intent — MVP, see docs/Plan.md feature 7. */
import { check, type Case } from './helpers';

const explicit: Case[] = [
  { text: 'বিদ্যুৎ বিল ৫০০ টাকা খরচ', expected: { intent: 'expense', item: 'বিদ্যুৎ বিল', amount: 500 } },
  { text: 'চা নাস্তা ৫০ খরচ', expected: { intent: 'expense', item: 'চা নাস্তা', amount: 50 } },
  { text: 'চা-নাস্তা ৭০ টাকা খরচ', expected: { intent: 'expense', item: 'চা নাস্তা', amount: 70 } },
  { text: '১,২০০ টাকা খরচ ভ্যান ভাড়া', expected: { intent: 'expense', item: 'ভ্যান ভাড়া', amount: 1200 } },
  { text: 'পলিথিন ব্যাগ একশ টাকা খরচা', expected: { intent: 'expense', item: 'পলিথিন ব্যাগ', amount: 100 } },
  { text: 'খরচ ৩০০ টাকা', expected: { intent: 'expense', amount: 300, missing: ['item'] } },
  { text: 'বিদ্যুৎ বিল খরচ', expected: { intent: 'expense', item: 'বিদ্যুৎ বিল', missing: ['amount'] } },
];

const implicit: Case[] = [
  // no "খরচ" word: a known expense word + money, no product quantity
  { text: 'ভাড়া দিলাম ২০০০', expected: { intent: 'expense', item: 'ভাড়া', amount: 2000 } },
  { text: 'ভাড়া ২০০০', expected: { intent: 'expense', item: 'ভাড়া', amount: 2000 } },
  { text: 'দোকান ভাড়া পাঁচ হাজার টাকা দিলাম', expected: { intent: 'expense', item: 'দোকান ভাড়া', amount: 5000 } },
  { text: 'কর্মচারীর বেতন আট হাজার দিলাম', expected: { intent: 'expense', item: 'কর্মচারীর বেতন', amount: 8000 } },
  { text: 'কারেন্ট বিল দিলাম সাড়ে সাতশ টাকা', expected: { intent: 'expense', item: 'কারেন্ট বিল', amount: 750 } },
  { text: 'গাড়িভাড়া ১৫০', expected: { intent: 'expense', item: 'গাড়িভাড়া', amount: 150 } },
  { text: 'মালিক ২০০ টাকা নিল', expected: { intent: 'expense', item: 'মালিক', amount: 200 } },
];

const context: Case[] = [
  // Cash screen "খরচ বলুন" button
  { text: 'পানি ২০', ctx: { tab: 'expense' }, expected: { intent: 'expense', item: 'পানি', amount: 20 } },
  { text: 'মোমবাতি ৩০ টাকা', ctx: { tab: 'expense' }, expected: { intent: 'expense', item: 'মোমবাতি', amount: 30 } },
];

const regressions: Case[] = [
  // "দিল" (he gave) is still a joma, "দিলাম" with a product is still a sale
  { text: 'করিম ৫০০ টাকা দিল', expected: { intent: 'joma', customer: 'করিম', amount: 500 } },
  {
    text: 'চাল ২ কেজি দিলাম',
    expected: { intent: 'sale', product: 'চাল', quantity: { value: 2, unit: 'kg' } },
  },
  { text: 'বিস্কুট ১০০ টাকার', expected: { intent: 'sale', product: 'বিস্কুট', amount: 100 } },
];

describe.each([
  ['explicit খরচ', explicit],
  ['implicit expense words', implicit],
  ['expense tab', context],
  ['regressions', regressions],
] as const)('%s', (_, cases) => {
  it.each(cases.map((c) => [c.text + (c.ctx ? ` ${JSON.stringify(c.ctx)}` : ''), c] as const))('%s', (_n, c) =>
    check(c),
  );
});

describe('expense queries', () => {
  it.todo('আজকের খরচ কত — needs an expense_query intent (Cash screen reads it out)');
});
