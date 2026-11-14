import { blockedText, customerPlan, entryDeleteText, partyDeleteText, productPlan, visibleHistory, voidedCount } from '../delete';
import type { HistoryItem } from '../history';

const item = (over: Partial<HistoryItem>): HistoryItem => ({
  table: 'sales', kind: 'sale', id: 'b1', title: 'চাল', lines: 1, quantity: 2, unit: 'kg', amount_poisha: 12000, credit: 0,
  customer: null, audio_path: null, created_at: 1, voided: false, fixed: false, oldQuantity: null, oldAmountPoisha: null, ...over,
});

describe('delete plans', () => {
  it('a customer with no entries is deleted; with old entries only hidden; owing: not at all', () => {
    expect(customerPlan({ entries: 0, balancePoisha: 0 })).toBe('delete');
    expect(customerPlan({ entries: 4, balancePoisha: 0 })).toBe('hide');
    expect(customerPlan({ entries: 4, balancePoisha: 5000 })).toBe('blocked');
    expect(customerPlan({ entries: 4, balancePoisha: -200 })).toBe('blocked'); // we owe him
  });
  it('a product with no entries is deleted, otherwise hidden', () => {
    expect(productPlan({ entries: 0 })).toBe('delete');
    expect(productPlan({ entries: 3 })).toBe('hide');
  });
  it('words', () => {
    expect(partyDeleteText('customer', 'করিম', 'delete')).toBe('ক্রেতা “করিম” মুছবেন?');
    expect(partyDeleteText('product', 'চাল', 'hide')).toMatch(/মোছা যাবে না.*লুকিয়ে রাখবেন/);
    expect(partyDeleteText('customer', 'করিম', 'blocked')).toBeNull();
    expect(blockedText('করিম', 230000)).toBe('“করিম”-এর বাকি ৳ ২,৩০০ আছে। আগে হিসাব মেটান, তারপর মুছুন।');
    expect(blockedText('করিম', -5000)).toMatch(/জমা ৳ ৫০ আছে/);
  });
  it('the entry confirm text shows the entry itself', () => {
    expect(entryDeleteText(item({ customer: 'করিম', credit: 1 }))).toBe(
      'মুছবেন? বিক্রি: চাল ২ কেজি, করিম, বাকিতে, ১২০ টাকা। হ্যাঁ বললে খাতা থেকে আর হিসাব থেকে মুছে যাবে।',
    );
  });
});

describe('History: মোছা গুলো দেখুন', () => {
  it('voided entries only when the toggle is on', () => {
    const items = [item({ id: 'a' }), item({ id: 'b', voided: true }), item({ id: 'c' })];
    expect(visibleHistory(items, false).map((i) => i.id)).toEqual(['a', 'c']);
    expect(visibleHistory(items, true).map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(voidedCount(items)).toBe(1);
  });
});
