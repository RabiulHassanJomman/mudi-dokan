import { wordSet } from './util';

export const PROFIT = wordSet(['লাভ', 'লাভের', 'লাভটা', 'মুনাফা', 'প্রফিট']);
export const TODAY = wordSet(['আজ', 'আজকে', 'আজকের', 'আজকা']);

export const STOCK = wordSet(['আছে', 'স্টক', 'মজুদ']);
/** "how much" — with বাকি/পাবো and no number, a balance question. */
export const HOW_MUCH = wordSet(['কত', 'কতো']);
/** "(I) will get" — what a customer owes the shop. */
export const OWED = wordSet(['পাবো', 'পাব', 'পাওনা']);
/**
 * Summary-question words, NOT in ALL_KEYWORDS (dropped only inside the query rules):
 * a বাকি / স্টক question with nothing else left = all customers / all products.
 */
export const EVERY = wordSet(['মোট', 'সবার', 'সব', 'সবাই', 'সবাইকে', 'সকলের', 'সকল', 'টোটাল', 'সবমিলিয়ে', 'মিলিয়ে']);
export const LIST = wordSet(['লিস্ট', 'লিষ্ট', 'লিস্টটা', 'তালিকা', 'তালিকাটা']);
/** "কে কে বাকি আছে", "কারা বাকি". */
export const WHO = wordSet(['কে', 'কারা', 'কাদের', 'কার']);
/** "বাকির লিস্ট": বাকি in the genitive (not a ledger keyword). */
export const BAKI_OF = wordSet(['বাকির', 'বাকিদের', 'ধারের', 'বকেয়ার']);
/** A customer's ledger: "করিমের হিসাব", "করিমের খাতা". */
export const HISTORY = wordSet(['হিসাব', 'হিসেব', 'হিসাবটা', 'হিসেবটা', 'খাতা', 'খাতাটা', 'লেনদেন']);
/**
 * Undo the last entry: "ভুল হয়েছে", "বাতিল করো", "শেষটা মুছে দাও". NOT in ALL_KEYWORDS.
 * Only with no number and nothing else left (UNDO_EXTRA + fillers).
 */
export const UNDO = wordSet(['ভুল', 'বাতিল', 'ক্যান্সেল', 'ক্যানসেল', 'মুছে', 'মুছো', 'মুছুন', 'মুছেন', 'মোছো', 'মুছ', 'কাটো', 'কেটে']);
export const UNDO_EXTRA = wordSet([
  'শেষটা', 'শেষেরটা', 'শেষের', 'শেষ', 'আগেরটা', 'আগের', 'এটা', 'ওটা', 'এন্ট্রি', 'এন্ট্রিটা', 'লেখাটা',
  'ফেলো', 'ফেলেন', 'ফেলুন', 'ফেল', 'ছিল', 'ছিলো', 'হয়ে', 'হইয়া', 'কর', 'করেন', 'করুন', 'দেন', 'দিন',
]);
/** The day as a whole: "আজ সারাদিনের হিসাব". NOT in ALL_KEYWORDS. */
export const WHOLE_DAY = wordSet(['সারাদিনের', 'সারাদিন', 'দিনের', 'দিন']);
/** Cash in hand: "ক্যাশে কত আছে", "হাতে কত টাকা". NOT in ALL_KEYWORDS. */
export const CASH_HELD = wordSet(['ক্যাশে', 'ক্যাশ', 'ক্যাশের', 'হাতে', 'ড্রয়ারে', 'ক্যাশবাক্সে']);
/** "goods" — "সব মাল", "মালের লিস্ট", "কি কি মাল আছে". */
export const GOODS = wordSet(['মাল', 'মালের', 'মালামাল', 'মালগুলো', 'পণ্য', 'পণ্যের', 'জিনিস', 'জিনিসের', 'স্টকের', 'মজুদের']);
export const SHOW = wordSet(['দেখাও', 'দেখান', 'দেখি', 'দেখাও', 'দেখাবেন', 'বলো', 'বলেন', 'শোনাও', 'শোনান']);
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

export const EXPENSE = wordSet(['খরচ', 'খরচা', 'খরছ']);
/**
 * Words that name an expense without saying "খরচ": "ভাড়া দিলাম ২০০০".
 * NOT in ALL_KEYWORDS — they stay in the item name.
 */
export const EXPENSE_HINT = wordSet(['ভাড়া', 'বিল', 'বেতন', 'মজুরি', 'নাস্তা']);
/** Fused forms: "গাড়িভাড়া", "কারেন্টবিল". */
export const EXPENSE_HINT_SUFFIXES = ['ভাড়া', 'বিল'].map((s) => s.normalize('NFC'));

/**
 * Owner/family taking cash out — not an expense, excluded from profit.
 * NOT in ALL_KEYWORDS — the name stays as `person`.
 */
export const OWNER = wordSet(['মালিক']);
/** "I took" — with money, an owner withdrawal by whoever holds this phone. */
export const SELF_TAKE = wordSet(['নিলাম', 'নিয়েছি', 'নিছি', 'তুললাম', 'তুলেছি']);
/** "from the cash box" — context words, dropped from the note. */
export const CASH_BOX = wordSet(['ক্যাশ', 'ক্যাশে', 'ক্যাশের', 'থেকে', 'ড্রয়ার']);

export const MONEY = wordSet(['টাকা', 'টাকার', 'টাকায়', 'tk']);

/** Said after a name ("সুমি আপু", "রহিম ভাই"): dropped, never a product line. */
export const HONORIFIC = [
  'ভাই', 'ভাইয়া', 'ভাইয়ের', 'ভাইজান', 'আপা', 'আপু', 'আপার', 'সাহেব', 'সাহেবের', 'চাচা', 'চাচার',
  'মামা', 'খালা', 'কাকা', 'ভাবি', 'ভাবী', 'দাদা', 'দিদি', 'বুবু', 'মিয়া',
  // genitive forms ("সুমি আপুর বাকি")
  'আপুর', 'ভাইয়ার', 'মামার', 'খালার', 'কাকার', 'ভাবির', 'ভাবীর', 'দাদার', 'দিদির',
];

export const HONORIFIC_SET = wordSet(HONORIFIC);

export const FILLER = wordSet([
  'করলাম', 'করেছি', 'করেছে', 'করল', 'করলো', 'করে', 'করছে', 'করো', 'করলেন', 'করেছেন', 'করছেন',
  'হলো', 'হল', 'হয়েছে', 'হইছে', 'হবে',
  'দিলাম', 'দিয়েছি', 'দিছি', 'দিয়ে', 'দাও', 'দেন',
  'গেল', 'গেলো', 'গেছে',
  'আর', 'মোট', 'প্রতি', 'এর', 'কাছে', 'আমি', 'তো', 'আমার',
  // item separators in a basket ("চাল ২ কেজি আর ডাল ১ কেজি")
  'এবং', 'সাথে', 'সঙ্গে', 'একই', 'একসাথে', 'আরো', 'আরও', 'তারপর',
  // object particle spoken apart ("হাসান কে"), ledger phrasing ("করিমের নামে বাকি লেখেন")
  'কে', 'রে', 'নামে', 'লেখেন', 'লিখেন', 'লেখো', 'লিখো', 'লিখে', 'রাখেন', 'রাখো', 'রাখলাম',
  ...HONORIFIC,
]);

/** "<price> করে" = per unit. */
export const EACH = wordSet(['করে', 'কইরা']);
/** "প্রতি কেজি", "কেজি প্রতি" = per unit. */
export const PER = wordSet(['প্রতি']);

export const ALL_KEYWORDS: ReadonlySet<string> = new Set([
  ...PROFIT, ...TODAY, ...STOCK, ...QUESTION, ...PURCHASE, ...NEW,
  ...BUY_MARKER, ...SELL_MARKER, ...DAM, ...SALE, ...BAKI, ...CREDIT,
  ...TAKE, ...OWED, ...JOMA, ...GAVE, ...EXPENSE, ...SELF_TAKE, ...CASH_BOX, ...MONEY, ...FILLER, ...EACH, ...PER,
]);
