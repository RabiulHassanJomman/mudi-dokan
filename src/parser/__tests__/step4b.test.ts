/**
 * Build step 4b: "করিমের বাকি কত?" (balance question) and the customer's name in a
 * cash sale ("করিম চাল ২ কেজি নিল" — known bug: it was dropped or became the product).
 */
import { check, type Case } from './helpers';
import { parseCommand } from '../parse';
import type { ParseContext } from '../types';

const ctx: ParseContext = {
  tab: 'sale',
  knownProducts: ['চাল', 'ডাল', 'তেল', 'চিনি', 'সাবান'],
  knownCustomers: ['করিম', 'হাসান', 'সুমি'],
};
const kg = (value: number) => ({ value, unit: 'kg' as const });

describe('balance question: "<name> বাকি কত?"', () => {
  const cases: Case[] = [
    { text: 'করিমের বাকি কত?', expected: { intent: 'balance_query', customer: 'করিম' } },
    { text: 'করিমের বাকি কত', ctx, expected: { intent: 'balance_query', customer: 'করিম' } },
    { text: 'রহিম কত টাকা বাকি', expected: { intent: 'balance_query', customer: 'রহিম' } },
    { text: 'করিমের কাছে কত পাবো', expected: { intent: 'balance_query', customer: 'করিম' } },
    { text: 'সুমি আপুর বাকি কতো', ctx, expected: { intent: 'balance_query', customer: 'সুমি' } },
    { text: 'হাসান ভাইয়ের কাছে কত বাকি আছে', ctx, expected: { intent: 'balance_query', customer: 'হাসান' } },
  ];
  it.each(cases.map((c) => [c.text, c] as const))('%s', (_n, c) => check(c));

  it('a বাকি with an amount is still an entry, not a question', () => {
    expect(parseCommand('করিম ২০০ টাকা বাকি', ctx)).toMatchObject({ intent: 'baki', customer: 'করিম', amount: 200 });
    expect(parseCommand('করিম কত টাকা বাকি নিল ২০০', ctx).intent).not.toBe('balance_query');
  });

  it('on the বাকি tab too', () => {
    expect(parseCommand('করিমের বাকি কত', { tab: 'ledger' })).toMatchObject({ intent: 'balance_query', customer: 'করিম' });
  });

  it('a named customer with "মোট" is still that customer', () => {
    expect(parseCommand('করিমের মোট বাকি কত', ctx)).toMatchObject({ intent: 'balance_query', customer: 'করিম' });
  });

  it('stock questions are unchanged', () => {
    expect(parseCommand('চাল কত আছে?', ctx)).toMatchObject({ intent: 'stock_query', product: 'চাল', confidence: 'high' });
    expect(parseCommand('চিনি কতটুকু আছে')).toMatchObject({ intent: 'stock_query', product: 'চিনি' });
  });
});

describe('customer name in a cash sale', () => {
  it('a known customer, no verb', () => {
    expect(parseCommand('করিম চাল ২ কেজি', ctx)).toMatchObject({
      intent: 'sale',
      customer: 'করিম',
      items: [{ product: 'চাল', quantity: kg(2) }],
    });
  });

  it('an unknown name before a known product, with নিল', () => {
    const r = parseCommand('রহিম চাল ২ কেজি নিল', ctx);
    expect(r).toMatchObject({ intent: 'sale', customer: 'রহিম', items: [{ product: 'চাল', quantity: kg(2) }] });
    expect(r.credit).toBeUndefined();
  });

  it('honorific after the name (no products known)', () => {
    expect(parseCommand('রহিম ভাই দুই কেজি চাল নিলেন', { tab: 'sale' })).toMatchObject({
      customer: 'রহিম',
      items: [{ product: 'চাল', quantity: kg(2) }],
    });
  });

  it('"… দিলাম হাসান কে" and "করিমকে …"', () => {
    expect(parseCommand('চাল ২ কেজি দিলাম রহিম কে', { tab: 'sale' })).toMatchObject({
      customer: 'রহিম',
      items: [{ product: 'চাল', quantity: kg(2) }],
    });
    expect(parseCommand('রহিমকে এক কেজি চিনি দিলাম', ctx)).toMatchObject({
      customer: 'রহিম',
      items: [{ product: 'চিনি', quantity: kg(1) }],
    });
  });

  it('several lines, customer first', () => {
    expect(parseCommand('রহিম নিল চাল ২ কেজি আর ডাল ১ কেজি', ctx)).toMatchObject({
      customer: 'রহিম',
      items: [
        { product: 'চাল', quantity: kg(2) },
        { product: 'ডাল', quantity: kg(1) },
      ],
    });
  });

  it.each([
    ['লাক্স সাবান দুইটা আশি টাকা', ctx],
    ['চাল ২ কেজি ১২০ টাকা', ctx],
    ['চাল নিল ২ কেজি', { tab: 'sale' } as ParseContext],
    ['সয়াবিন তেল ২ লিটার', { tab: 'sale' } as ParseContext],
  ])('no name, no customer: %s', (t, c) => {
    const r = parseCommand(t, c);
    expect(r.intent).toBe('sale');
    expect(r.customer).toBeUndefined();
    expect(r.items?.every((i) => i.product)).toBe(true);
  });
});

describe('total বাকি question: no name = all customers', () => {
  it.each([
    'মোট কত বাকি',
    'মোট কত বাকি?',
    'সবার বাকি কত',
    'সবার বাকি কতো?',
    'বাকি কত টাকা পাওনা',
    'সব মিলিয়ে বাকি কত',
    'বাকি কত',
    'কে কে বাকি আছে',
    'কারা বাকি আছে',
    'বাকির লিস্ট',
    'বাকির লিস্ট দেখাও',
    'বাকির তালিকা',
  ])('%s', (text) => {
    for (const c of [{}, ctx, { tab: 'ledger' as const }]) {
      expect(parseCommand(text, c)).toMatchObject({ intent: 'total_baki_query', missing: [], confidence: 'high' });
      expect(parseCommand(text, c).customer).toBeUndefined();
    }
  });

  it('with an amount it is an entry, not a question', () => {
    expect(parseCommand('সবার ২০০ টাকা বাকি', ctx).intent).not.toBe('total_baki_query');
  });
});

describe('all stock question: every product', () => {
  it.each(['সব মাল কত আছে', 'মালের লিস্ট', 'কি কি মাল আছে', 'স্টক দেখাও', 'সব মালের স্টক', 'মালের তালিকা দেখাও'])('%s', (text) => {
    for (const c of [{}, ctx, { tab: 'stock' as const }, { tab: 'ledger' as const }]) {
      expect(parseCommand(text, c)).toMatchObject({ intent: 'all_stock_query', missing: [], confidence: 'high' });
      expect(parseCommand(text, c).product).toBeUndefined();
    }
  });

  it('one product stays a single question', () => {
    expect(parseCommand('চাল কত আছে', ctx)).toMatchObject({ intent: 'stock_query', product: 'চাল' });
    expect(parseCommand('চালের স্টক দেখাও', ctx)).toMatchObject({ intent: 'stock_query', product: 'চাল' });
  });

  it('a purchase with "মাল" and numbers is not a question', () => {
    expect(parseCommand('নতুন মাল চাল ৫০ কেজি কেনা ৫৫', ctx).intent).toBe('purchase');
  });

  it('বাকি lists are not stock lists', () => {
    expect(parseCommand('কে কে বাকি আছে', ctx).intent).toBe('total_baki_query');
  });
});

describe('customer history: "করিমের হিসাব দেখাও"', () => {
  it.each([
    'করিমের হিসাব দেখাও',
    'করিম কি কি বাকিতে নিয়েছে',
    'করিমের খাতা',
    'করিমের বাকির লিস্ট',
    'করিমের হিসেব',
    'করিম ভাইয়ের খাতাটা দেখান',
  ])('%s', (text) => {
    for (const c of [{}, ctx, { tab: 'ledger' as const }]) {
      expect(parseCommand(text, c)).toMatchObject({ intent: 'customer_history_query', customer: 'করিম', missing: [], confidence: 'high' });
    }
  });

  it('a known name is matched', () => {
    expect(parseCommand('সুমি আপুর খাতা', ctx)).toMatchObject({ intent: 'customer_history_query', customer: 'সুমি' });
  });

  it('no name is not a history question', () => {
    expect(parseCommand('বাকির লিস্ট', ctx).intent).toBe('total_baki_query');
    expect(parseCommand('হিসাব দেখাও', ctx).intent).not.toBe('customer_history_query');
  });

  it('balance and entries are unchanged', () => {
    expect(parseCommand('করিমের বাকি কত', ctx)).toMatchObject({ intent: 'balance_query', customer: 'করিম' });
    expect(parseCommand('করিম চাল ২ কেজি বাকিতে নিল', ctx)).toMatchObject({ intent: 'sale', credit: true, customer: 'করিম' });
    expect(parseCommand('করিমের খাতায় ২০০ টাকা বাকি', ctx).intent).toBe('baki');
  });
});
