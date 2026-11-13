/**
 * First-person cash taken ("৩০০ টাকা নিলাম") depends on who holds the phone:
 * owner → owner_withdrawal, staff → expense "অগ্রিম বেতন". See docs/Plan.md feature 10.
 */
import { check, type Case } from './helpers';
import type { ParseContext } from '../types';

const owner: ParseContext = { deviceRole: 'owner', deviceName: 'আব্বু' };
const staff: ParseContext = { deviceRole: 'staff', deviceName: 'কর্মচারী ১' };

const ownerPhone: Case[] = [
  {
    text: '৩০০ টাকা নিলাম',
    ctx: owner,
    expected: { intent: 'owner_withdrawal', person: 'আব্বু', amount: 300 },
  },
  {
    text: '৫০০ তুললাম',
    ctx: { deviceRole: 'owner', deviceName: 'রহমান' },
    expected: { intent: 'owner_withdrawal', person: 'রহমান', amount: 500 },
  },
  {
    text: 'বাসার জন্য ৩০০ টাকা নিলাম',
    ctx: owner,
    expected: { intent: 'owner_withdrawal', person: 'আব্বু', amount: 300, note: 'বাসার জন্য' },
  },
  {
    text: 'ক্যাশ থেকে দুই হাজার নিয়েছি',
    ctx: owner,
    expected: { intent: 'owner_withdrawal', person: 'আব্বু', amount: 2000 },
  },
];

const staffPhone: Case[] = [
  {
    text: '৩০০ টাকা নিলাম',
    ctx: staff,
    expected: { intent: 'expense', item: 'অগ্রিম বেতন', person: 'কর্মচারী ১', amount: 300 },
  },
  {
    text: '৫০০ তুললাম',
    ctx: { deviceRole: 'staff', deviceName: 'রবি' },
    expected: { intent: 'expense', item: 'অগ্রিম বেতন', person: 'রবি', amount: 500 },
  },
  {
    text: 'বাসার জন্য ২০০ টাকা নিলাম',
    ctx: staff,
    expected: { intent: 'expense', item: 'অগ্রিম বেতন', person: 'কর্মচারী ১', amount: 200, note: 'বাসার জন্য' },
  },
];

const unchanged: Case[] = [
  // a named owner is still the owner, even when staff says it
  { text: 'মালিক ৫০০ নিল', ctx: staff, expected: { intent: 'owner_withdrawal', person: 'মালিক', amount: 500 } },
  { text: 'আব্বু ১০০০ নিল', ctx: staff, expected: { intent: 'owner_withdrawal', person: 'আব্বু', amount: 1000 } },
  // ordinary commands don't pick up the device name
  { text: 'বিদ্যুৎ বিল ৫০০ টাকা খরচ', ctx: staff, expected: { intent: 'expense', item: 'বিদ্যুৎ বিল', amount: 500 } },
  { text: 'চাল ২ কেজি', ctx: owner, expected: { intent: 'sale', product: 'চাল', quantity: { value: 2, unit: 'kg' } } },
  { text: 'করিম ৫০০ টাকা দিল', ctx: staff, expected: { intent: 'joma', customer: 'করিম', amount: 500 } },
  // role not set: owner withdrawal, person from deviceName if known
  { text: '৩০০ টাকা নিলাম', expected: { intent: 'owner_withdrawal', amount: 300 } },
  {
    text: '৩০০ টাকা নিলাম',
    ctx: { deviceName: 'আম্মু' },
    expected: { intent: 'owner_withdrawal', person: 'আম্মু', amount: 300 },
  },
];

describe.each([
  ['owner phone', ownerPhone],
  ['staff phone', staffPhone],
  ['unchanged', unchanged],
] as const)('%s', (_, cases) => {
  it.each(cases.map((c) => [c.text + (c.ctx ? ` ${JSON.stringify(c.ctx)}` : ''), c] as const))('%s', (_n, c) =>
    check(c),
  );
});
