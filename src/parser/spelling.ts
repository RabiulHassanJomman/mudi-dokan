/**
 * Words speech-to-text (Ridmik voice typing) often writes wrong → the spelling the fixed
 * formats know. One word at a time, exact matches only: names and goods are never touched.
 * Add new ones here as the shop finds them (docs/PLAN.md › A5). Pure TS.
 */
import { wordMap } from './util';

const FIX = wordMap<string>({
  // বাকি
  বাকে: 'বাকি', বাখি: 'বাকি', বাঁকি: 'বাকি', বাক্কি: 'বাকি', বাকী: 'বাকি', বাকিই: 'বাকি',
  বাকীতে: 'বাকিতে', বাকেতে: 'বাকিতে',
  // নগদ
  নগত: 'নগদ', নোগদ: 'নগদ', নগোদ: 'নগদ', নকদ: 'নগদ', নগদি: 'নগদ', নোগোদ: 'নগদ',
  // জমা
  জোমা: 'জমা', জমাা: 'জমা',
  // টাকা
  টেকা: 'টাকা', ট্যাকা: 'টাকা', টাহা: 'টাকা', তাকা: 'টাকা', টাকে: 'টাকা', টাকাা: 'টাকা', টেহা: 'টাকা',
  টেকার: 'টাকার', ট্যাকার: 'টাকার', তাকার: 'টাকার',
  // বিক্রি
  বিকরি: 'বিক্রি', বিক্কিরি: 'বিক্রি', বিক্রী: 'বিক্রি', বিক্রিই: 'বিক্রি', বেক্রি: 'বিক্রি',
  // কেনা
  কিন্যা: 'কেনা', ক্যানা: 'কেনা',
  // spoken verb forms ("নিসে" = নিয়েছে)
  নিসে: 'নিয়েছে', নিসেন: 'নিয়েছেন', নিছেন: 'নিয়েছেন', নিয়াছে: 'নিয়েছে',
  দিসে: 'দিয়েছে', দিসেন: 'দিয়েছেন', দিছেন: 'দিয়েছেন', দিয়াছে: 'দিয়েছে',
});

/** One normalized token → its fixed spelling (or itself, NFC). */
export const fixSpelling = (token: string): string => {
  const t = token.normalize('NFC');
  return FIX.get(t) ?? t;
};
