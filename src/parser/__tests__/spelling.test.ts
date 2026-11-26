/** Words speech-to-text often spells wrong, fixed before the fixed formats read them. */
import { fixSpelling } from '../spelling';
import { parseFixed } from '../fixed';

it.each([
  ['বাকে', 'বাকি'], ['বাখি', 'বাকি'], ['বাঁকি', 'বাকি'], ['বাক্কি', 'বাকি'], ['বাকী', 'বাকি'],
  ['নগত', 'নগদ'], ['নোগদ', 'নগদ'], ['নগোদ', 'নগদ'], ['নকদ', 'নগদ'],
  ['জোমা', 'জমা'],
  ['টেকা', 'টাকা'], ['ট্যাকা', 'টাকা'], ['টাহা', 'টাকা'], ['তাকা', 'টাকা'], ['টাকে', 'টাকা'],
  ['বিকরি', 'বিক্রি'], ['বিক্কিরি', 'বিক্রি'], ['বিক্রী', 'বিক্রি'],
  ['কিন্যা', 'কেনা'],
])('%s → %s', (heard, fixed) => {
  expect(fixSpelling(heard)).toBe(fixed.normalize('NFC'));
});

it('other words stay as they are', () => {
  for (const w of ['সাজু', 'চাল', 'জামা', 'কিনা', 'বাকি', '100']) expect(fixSpelling(w)).toBe(w.normalize('NFC'));
});

describe('whole sentences', () => {
  it.each([
    ['সাজু বাকে নিয়েছে চাল ১০০ টেকা', { kind: 'baki', customer: 'সাজু', goods: ['চাল'], amount: 100 }],
    ['নগত বিকরি ১০০ টাকা', { kind: 'cash_sale', goods: [], amount: 100 }],
    ['সাজু ৫০ ট্যাকা জোমা দিসে', { kind: 'joma', customer: 'সাজু', amount: 50 }],
    ['সাজু বাকি নিসে চাল ১০০ টাকা', { kind: 'baki', customer: 'সাজু', goods: ['চাল'], amount: 100 }],
    ['সাজু বাকি নিলেন ১০০ টাকা', { kind: 'baki', customer: 'সাজু', goods: [], amount: 100 }],
  ])('%s', (said, expected) => {
    expect(parseFixed(said)).toMatchObject({ ...expected, problems: [] });
  });
});
