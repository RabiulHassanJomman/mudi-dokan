/** Every example command that appears in docs/Plan.md. */
import { check, type Case } from './helpers';

const cases: Case[] = [
  {
    text: 'করিম চাল এক কেজি বাকিতে নিল',
    expected: { intent: 'sale', credit: true, customer: 'করিম', product: 'চাল', quantity: { value: 1, unit: 'kg' } },
  },
  {
    text: 'এক হাজার পাঁচশ টাকা জমা',
    expected: { intent: 'joma', amount: 1500, missing: ['customer'] },
  },
  {
    text: 'দুইটা সাবান',
    expected: { intent: 'sale', product: 'সাবান', quantity: { value: 2, unit: 'piece' } },
  },
  {
    text: 'নতুন চাল ৫০ কেজি কেনা ৫৫ বেচা ৬০',
    expected: {
      intent: 'purchase',
      isNewProduct: true,
      product: 'চাল',
      quantity: { value: 50, unit: 'kg' },
      buyPrice: 55,
      sellPrice: 60,
    },
  },
  {
    text: 'চাল ২ কেজি',
    expected: { intent: 'sale', product: 'চাল', quantity: { value: 2, unit: 'kg' } },
  },
  {
    text: '১০০ টাকার চিনি',
    expected: { intent: 'sale', product: 'চিনি', amount: 100 },
  },
  {
    text: 'করিম ২০০ টাকা বাকি',
    expected: { intent: 'baki', customer: 'করিম', amount: 200 },
  },
  {
    text: 'করিম ১০০ জমা',
    expected: { intent: 'joma', customer: 'করিম', amount: 100 },
  },
  {
    text: 'করিম চাল ১ কেজি বাকিতে নিল',
    expected: { intent: 'sale', credit: true, customer: 'করিম', product: 'চাল', quantity: { value: 1, unit: 'kg' } },
  },
  {
    text: 'চাল কত আছে?',
    expected: { intent: 'stock_query', product: 'চাল' },
  },
  {
    text: 'আজ লাভ কত?',
    expected: { intent: 'profit_query', period: 'today' },
  },
  {
    // the TTS readback in the plan, typed back in
    text: 'চাল ২ কেজি, ১২০ টাকা',
    expected: { intent: 'sale', product: 'চাল', quantity: { value: 2, unit: 'kg' }, amount: 120 },
  },
  {
    // Sale tab: "শুধু 'চাল ২ কেজি' বললেই হবে"
    text: 'চাল ২ কেজি',
    ctx: { tab: 'sale' },
    expected: { intent: 'sale', product: 'চাল', quantity: { value: 2, unit: 'kg' } },
  },
];

describe('docs/Plan.md examples', () => {
  it.each(cases.map((c) => [c.text + (c.ctx ? ` [${c.ctx.tab}]` : ''), c] as const))('%s', (_, c) => check(c));

  it.todo('Phase 3: রহিম ট্রেডার্স থেকে ৫০ কেজি চাল বাকিতে কিনলাম (supplier baki)');
  it.todo('Phase 3: আজকের হিসাব (daily cash summary)');
  it.todo('Phase 2: ভুল হয়েছে / বাতিল (voice undo)');
});
