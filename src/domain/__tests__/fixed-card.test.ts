/** Android parsing on the screens: what the confirm card, lists and মাল show. */
import { parseFixed } from '../../parser/fixed';
import { entryFromFixed, entryReadback, fixedAsParsed, setEntryNote } from '../entry';
import { recentLine, type RecentEntry } from '../recent';
import { stockQtyText, type StockView } from '../stock';

const draft = (said: string) => entryFromFixed(parseFixed(said), { products: new Map(), knownCustomers: [] })!;

describe('the voice log keeps the Android parse', () => {
  it.each([
    ['সাজু বাকি নিয়েছে চাল ১০০ টাকা', { intent: 'baki', customer: 'সাজু', amount: 100, note: 'চাল' }],
    ['নগদ বিক্রি চাল, ডাল ১০০ টাকা', { intent: 'sale', amount: 100, note: 'চাল, ডাল' }],
    ['নগদ বিক্রি ১০০ টাকা', { intent: 'sale', amount: 100 }],
    ['১০০০ টাকার আলু কেনা হয়েছে', { intent: 'purchase', product: 'আলু', amount: 1000 }],
    ['সাজু ৫০ টাকা জমা দিয়েছে', { intent: 'joma', customer: 'সাজু', amount: 50 }],
    ['সাজু বাকি ১০০ টাকা', { intent: 'baki', customer: 'সাজু', amount: 100 }],
  ])('%s', (said, expected) => {
    expect(fixedAsParsed(parseFixed(said))).toMatchObject({ ...expected, missing: [], confidence: 'high', raw: said });
  });

  it('an incomplete sentence is unknown', () => {
    expect(fixedAsParsed(parseFixed('নগদ বিক্রি চাল'))).toMatchObject({ intent: 'unknown' });
    expect(fixedAsParsed(parseFixed('কিছু একটা'))).toMatchObject({ intent: 'unknown' });
  });
});

describe('editing the goods', () => {
  it('a নগদ sale may be left without goods; the readback follows', () => {
    const d = draft('নগদ বিক্রি চাল ১০০ টাকা');
    expect(entryReadback(setEntryNote(d, 'চাল, ডাল'))).toBe('নগদ বিক্রি: চাল, ডাল, ১০০ টাকা। ঠিক আছে?');
    expect(setEntryNote(d, '  ')).toMatchObject({ note: null, problems: [] });
    expect(entryReadback(setEntryNote(d, ''))).toBe('নগদ বিক্রি, ১০০ টাকা। ঠিক আছে?');
  });
  it('a বাকি may be left without goods', () => {
    const d = draft('সাজু বাকি নিয়েছে চাল ১০০ টাকা');
    expect(setEntryNote(d, '')).toMatchObject({ note: null });
    expect(setEntryNote(d, '').problems).toEqual(d.problems);
  });
});

describe('lists', () => {
  it('a goods sale says নগদ বিক্রি where the quantity would be', () => {
    const e: RecentEntry = {
      kind: 'sale', id: 'x', title: 'চাল, ডাল', lines: 1, quantity: null, unit: null, amount_poisha: 10000, credit: 0,
      customer: null, audio_path: null, created_at: 0,
    };
    expect(recentLine(e).detail).toBe('নগদ বিক্রি');
  });

  const view = (over: Partial<StockView>): StockView => ({
    id: 'p', name: 'আলু', unit: 'kg', sellPricePoisha: null, costPricePoisha: null, stock: null, known: false, low: false, spentPoisha: 0, ...over,
  });
  it('মাল shows money spent, a quantity, শেষ, or that nothing was bought', () => {
    expect(stockQtyText(view({ spentPoisha: 100000 }))).toBe('খরচ ৳ ১,০০০');
    expect(stockQtyText(view({ stock: 5, known: true, spentPoisha: 100000 }))).toBe('৫ কেজি');
    expect(stockQtyText(view({ stock: 0, known: true }))).toBe('শেষ');
    expect(stockQtyText(view({}))).toBe('কেনা লেখা নেই');
  });
});
