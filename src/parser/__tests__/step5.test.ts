/**
 * Build step 5: voice undo ("ভুল হয়েছে") and the day summary ("আজকের হিসাব").
 * "আজ লাভ কত?" was already profit_query (plan-examples, variations).
 */
import { parseCommand } from '../parse';
import type { ParseContext } from '../types';

const ctx: ParseContext = {
  tab: 'sale',
  knownProducts: ['চাল', 'ডাল', 'তেল', 'চিনি', 'সাবান'],
  knownCustomers: ['করিম', 'হাসান', 'সুমি'],
};
const TABS: ParseContext[] = [{}, ctx, { ...ctx, tab: 'ledger' }, { ...ctx, tab: 'purchase' }, { ...ctx, tab: 'expense' }];

describe('undo: "ভুল হয়েছে" / "বাতিল" / "শেষটা মুছে দাও"', () => {
  it.each([
    'ভুল হয়েছে',
    'ভুল হইছে',
    'ভুল হয়ে গেছে',
    'বাতিল',
    'বাতিল করো',
    'বাতিল কর',
    'শেষটা মুছে দাও',
    'শেষেরটা মুছে দাও',
    'মুছে দাও',
    'শেষটা বাতিল করো',
    'আগেরটা ভুল ছিল',
    'শেষের এন্ট্রি মুছে ফেলো',
    'ক্যান্সেল করো',
  ])('%s', (text) => {
    for (const c of TABS) expect(parseCommand(text, c)).toMatchObject({ intent: 'undo', missing: [], confidence: 'high' });
  });

  it('an entry that mentions ভুল/বাতিল with a number is not an undo', () => {
    expect(parseCommand('চাল ২ কেজি', ctx).intent).toBe('sale');
    expect(parseCommand('করিম ২০০ টাকা জমা', ctx).intent).toBe('joma');
    expect(parseCommand('বাতিল ২০০ টাকা', ctx).intent).not.toBe('undo');
  });

  it('a name with ভুল is not an undo ("করিমের হিসাব ভুল" asks for the history)', () => {
    expect(parseCommand('করিমের বাকি কত', ctx).intent).toBe('balance_query');
  });
});

describe('day summary: "আজকের হিসাব"', () => {
  it.each([
    'আজকের হিসাব',
    'আজকের হিসাব বলো',
    'আজকের হিসেব শোনাও',
    'আজ কি হিসাব',
    'আজকের খাতা',
    'হিসাব দেখাও',
    'হিসাব বলো',
    'ক্যাশে কত আছে',
    'ক্যাশে কত টাকা আছে',
    'হাতে কত টাকা আছে',
    'আজ সারাদিনের হিসাব',
  ])('%s', (text) => {
    for (const c of TABS) expect(parseCommand(text, c)).toMatchObject({ intent: 'day_summary_query', missing: [], confidence: 'high' });
  });

  it('a name keeps it a customer history question', () => {
    expect(parseCommand('করিমের হিসাব দেখাও', ctx)).toMatchObject({ intent: 'customer_history_query', customer: 'করিম' });
    expect(parseCommand('আজ করিমের হিসাব', ctx)).toMatchObject({ intent: 'customer_history_query', customer: 'করিম' });
  });

  it('stock and profit questions are unchanged', () => {
    expect(parseCommand('চাল কত আছে', ctx)).toMatchObject({ intent: 'stock_query', product: 'চাল' });
    expect(parseCommand('আজ লাভ কত', ctx)).toMatchObject({ intent: 'profit_query', period: 'today' });
    expect(parseCommand('সব মাল কত আছে', ctx).intent).toBe('all_stock_query');
  });

  it('cash taken with an amount is still an entry', () => {
    expect(parseCommand('ক্যাশ থেকে ৫০০ টাকা নিলাম', { ...ctx, deviceRole: 'owner', deviceName: 'রফিক' }).intent).toBe('owner_withdrawal');
  });
});
