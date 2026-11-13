import { wordSet } from './util';

export const PROFIT = wordSet(['লাভ', 'লাভের', 'লাভটা', 'মুনাফা', 'প্রফিট']);
export const TODAY = wordSet(['আজ', 'আজকে', 'আজকের', 'আজকা']);

export const STOCK = wordSet(['আছে', 'স্টক', 'মজুদ']);
export const QUESTION = wordSet(['কত', 'কতো', 'কি', 'কী', 'কতটুকু', 'কয়টা', 'কয়', 'কতগুলো', 'এখন', 'দোকানে']);

export const PURCHASE = wordSet(['কেনা', 'কিনলাম', 'কিনেছি', 'কিনছি', 'এনেছি', 'আনলাম', 'আনছি', 'ক্রয়']);
export const NEW = wordSet(['নতুন']);

/** Words before a number that make it a per-unit price. */
export const BUY_MARKER = wordSet(['কেনা', 'ক্রয়']);
export const SELL_MARKER = wordSet(['বেচা', 'বিক্রি', 'বিক্রয়']);
export const DAM = wordSet(['দাম', 'দর', 'রেট']);

export const SALE = wordSet(['বিক্রি', 'বিক্রয়', 'বেচা', 'বেচলাম', 'বেচছি', 'বেচেছি']);

export const BAKI = wordSet(['বাকি', 'ধার', 'বকেয়া']);
/** "on credit" — with a product this is a credit sale. */
export const CREDIT = wordSet(['বাকিতে', 'ধারে']);
export const TAKE = wordSet(['নিল', 'নিলো', 'নিয়েছে', 'নিছে', 'নিলেন', 'নিয়েছেন', 'নিয়ে']);

export const JOMA = wordSet(['জমা', 'শোধ', 'পরিশোধ']);
/** "gave" — with only an amount, a payment (joma). */
export const GAVE = wordSet(['দিল', 'দিলো', 'দিয়েছে', 'দিছে', 'দিলেন', 'দিয়েছেন']);

export const MONEY = wordSet(['টাকা', 'টাকার', 'টাকায়', 'tk']);

export const FILLER = wordSet([
  'করলাম', 'করেছি', 'করেছে', 'করল', 'করলো', 'করে', 'করছে', 'করো',
  'হলো', 'হল', 'হয়েছে', 'হইছে', 'হবে',
  'দিলাম', 'দিয়ে', 'দাও', 'দেন',
  'গেল', 'গেলো', 'গেছে',
  'আর', 'মোট', 'প্রতি', 'এর', 'কাছে', 'আমি', 'ভাই', 'তো', 'আমার',
]);

export const ALL_KEYWORDS: ReadonlySet<string> = new Set([
  ...PROFIT, ...TODAY, ...STOCK, ...QUESTION, ...PURCHASE, ...NEW,
  ...BUY_MARKER, ...SELL_MARKER, ...DAM, ...SALE, ...BAKI, ...CREDIT,
  ...TAKE, ...JOMA, ...GAVE, ...MONEY, ...FILLER,
]);
