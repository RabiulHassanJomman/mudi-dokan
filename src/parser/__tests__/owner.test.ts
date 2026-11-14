/**
 * Owner withdrawal (মালিক/পরিবার ক্যাশ থেকে নিল) — reduces expected cash,
 * NOT an expense, excluded from profit. See docs/Plan.md feature 10.
 */
import { parseCommand } from '../parse';
import { check, type Case } from './helpers';

/** Owner names come from the phones whose role is মালিক (their device_name), plus "মালিক". */
const family = { ownerNames: ['আব্বু', 'আম্মু', 'আব্বা'] };

const withdrawals: Case[] = [
  { text: 'মালিক ৫০০ নিল', expected: { intent: 'owner_withdrawal', person: 'মালিক', amount: 500 } },
  {
    text: 'আব্বু ১০০০ নিল বাসার জন্য',
    ctx: family,
    expected: { intent: 'owner_withdrawal', person: 'আব্বু', amount: 1000, note: 'বাসার জন্য' },
  },
  { text: 'মালিক ২০০ টাকা নিল', expected: { intent: 'owner_withdrawal', person: 'মালিক', amount: 200 } },
  { text: 'মালিক নিল দুই হাজার', expected: { intent: 'owner_withdrawal', person: 'মালিক', amount: 2000 } },
  { text: 'আম্মু পাঁচশ টাকা নিয়েছে', ctx: family, expected: { intent: 'owner_withdrawal', person: 'আম্মু', amount: 500 } },
  {
    text: 'আব্বা দেড় হাজার নিল ওষুধের জন্য',
    ctx: family,
    expected: { intent: 'owner_withdrawal', person: 'আব্বা', amount: 1500, note: 'ওষুধের জন্য' },
  },
  { text: 'মালিক ৩০০', expected: { intent: 'owner_withdrawal', person: 'মালিক', amount: 300 } },
  // first person on an owner phone (staff/unset: see device-role.test.ts)
  {
    text: 'বাসার জন্য ৩০০ টাকা নিলাম',
    ctx: { deviceRole: 'owner' },
    expected: { intent: 'owner_withdrawal', amount: 300, note: 'বাসার জন্য' },
  },
  { text: 'ক্যাশ থেকে ৫০০ তুললাম', ctx: { deviceRole: 'owner' }, expected: { intent: 'owner_withdrawal', amount: 500 } },
  { text: 'মালিক নিল', expected: { intent: 'owner_withdrawal', person: 'মালিক', missing: ['amount'] } },
];

const context: Case[] = [
  {
    // device_name set on the phone ("Abbu", "Rahman")
    text: 'রহমান ১০০০ নিল',
    ctx: { ownerNames: ['রহমান'] },
    expected: { intent: 'owner_withdrawal', person: 'রহমান', amount: 1000 },
  },
];

const notWithdrawal: Case[] = [
  // owner name with a stronger keyword keeps that intent
  {
    text: 'আব্বু চাল ২ কেজি বাকিতে নিল',
    ctx: family,
    expected: { intent: 'sale', credit: true, customer: 'আব্বু', product: 'চাল', quantity: { value: 2, unit: 'kg' } },
  },
  { text: 'মালিকের দোকান ভাড়া ৫০০০ খরচ', expected: { intent: 'expense', item: 'মালিক দোকান ভাড়া', amount: 5000 } },
  { text: 'বিদ্যুৎ বিল ৫০০ টাকা খরচ', expected: { intent: 'expense', item: 'বিদ্যুৎ বিল', amount: 500 } },
  { text: 'করিম ২০০ টাকা বাকি', expected: { intent: 'baki', customer: 'করিম', amount: 200 } },
];

describe.each([
  ['owner withdrawal', withdrawals],
  ['owner names from context', context],
  ['not a withdrawal', notWithdrawal],
] as const)('%s', (_, cases) => {
  it.each(cases.map((c) => [c.text + (c.ctx ? ` ${JSON.stringify(c.ctx)}` : ''), c] as const))('%s', (_n, c) =>
    check(c),
  );
});

describe('owner cash in', () => {
  it.todo('আব্বু ক্যাশে ৫০০০ দিল / রাখল — owner deposit (increases cash, not a sale)');
});

describe('family words are not built in any more', () => {
  it.each(['আব্বু ১০০০ নিল বাসার জন্য', 'আম্মু পাঁচশ টাকা নিয়েছে', 'আব্বা ৫০০ নিল'])(
    '"%s" is no owner withdrawal unless an owner phone has that name',
    (text) => {
      expect(parseCommand(text).intent).not.toBe('owner_withdrawal');
      expect(parseCommand(text, { ownerNames: ['আব্বু', 'আম্মু', 'আব্বা'] }).intent).toBe('owner_withdrawal');
    },
  );

  it('"মালিক" always is', () => {
    expect(parseCommand('মালিক ৫০০ নিল', { ownerNames: [] })).toMatchObject({ intent: 'owner_withdrawal', person: 'মালিক', amount: 500 });
  });
});
