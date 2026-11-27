/**
 * অ্যাপ শেখা: the first-time tutorial (slides). Shown once after the first Setup, and again from ⚙.
 * Each page: one big icon, a short title, a few lines, maybe an example sentence; read aloud on
 * open. Pure TS (the screen is src/app/tutorial.tsx).
 */
import type { FixedKind } from '../parser/fixed';
import { toBnDigits } from '../lib/bn';
import { EXAMPLE_BN, LOOKUP_EXAMPLE_BN } from './keyboard';

/** Icons the screen draws (a subset of components/Icon's names). */
export type TutorialIcon = 'mic' | 'cart' | 'book' | 'cash' | 'box' | 'check' | 'wallet' | 'speaker' | 'settings';
/** Color family from theme/tokens: sale = green, baki = orange, stock = blue. */
export type TutorialTone = 'sale' | 'baki' | 'stock';

export interface TutorialPage {
  key: string;
  icon: TutorialIcon;
  tone: TutorialTone;
  title: string;
  lines: readonly string[];
  /** A sentence to say into 🎤 (must read as `kind` with parseFixed). */
  example?: string;
  kind?: FixedKind;
}

const [CASH_SALE, BAKI] = EXAMPLE_BN.sale as readonly [string, string];
const JOMA = EXAMPLE_BN.ledger[1]!;
const PURCHASE = EXAMPLE_BN.purchase[0]!;

export const TUTORIAL_PAGES: readonly TutorialPage[] = [
  {
    key: 'welcome',
    icon: 'speaker',
    tone: 'sale',
    title: 'মুদি দোকানে স্বাগতম',
    lines: ['লিখতে হবে না, কথা বলে হিসাব রাখুন।', 'প্রতিটি পাতায় 🔊 চাপলে অ্যাপ পড়ে শোনাবে।'],
  },
  {
    key: 'mic',
    icon: 'mic',
    tone: 'sale',
    title: 'বড় 🎤 চাপুন',
    lines: ['টুং শব্দের পর কথা বলুন।', 'কথা থামালে কার্ড খুলবে।', 'মাঝে থামতে ⏸ বিরতি, আবার বলতে ▶ চালিয়ে যান।', 'ইন্টারনেট লাগবে।'],
  },
  {
    key: 'cash_sale',
    icon: 'cart',
    tone: 'sale',
    title: 'নগদ বিক্রি',
    lines: ['প্রথমে “নগদ বিক্রি”, তারপর মালের নাম, শেষে মোট টাকা।'],
    example: CASH_SALE,
    kind: 'cash_sale',
  },
  {
    key: 'baki',
    icon: 'book',
    tone: 'baki',
    title: 'বাকি',
    lines: ['ক্রেতার নাম, তারপর “বাকি নিয়েছে”, মালের নাম, মোট টাকা।'],
    example: BAKI,
    kind: 'baki',
  },
  {
    key: 'joma',
    icon: 'wallet',
    tone: 'baki',
    title: 'জমা',
    lines: ['বাকির টাকা ফেরত দিলে: ক্রেতার নাম, টাকা, তারপর “জমা দিয়েছে”।'],
    example: JOMA,
    kind: 'joma',
  },
  {
    key: 'purchase',
    icon: 'box',
    tone: 'stock',
    title: 'মাল কেনা',
    lines: ['দোকানের জন্য মাল কিনলে: কত টাকার, কোন মাল, তারপর “কেনা হয়েছে”।'],
    example: PURCHASE,
    kind: 'purchase',
  },
  {
    key: 'confirm',
    icon: 'check',
    tone: 'sale',
    title: 'হ্যাঁ চাপলে রাখা হবে',
    lines: ['কার্ডে যা বুঝেছি দেখাবে আর শোনাবে।', 'ঠিক থাকলে ✅ হ্যাঁ, ভুল হলে না।', 'হ্যাঁ না চাপলে কিছুই রাখা হয় না।'],
  },
  {
    key: 'stock_tab',
    icon: 'box',
    tone: 'stock',
    title: 'মাল পাতা',
    lines: ['নিচে “মাল” চাপুন।', 'দোকানের সব মাল আর কত টাকার কেনা হয়েছে দেখাবে।', '“নতুন মাল বলুন” চেপে কেনা মাল বলুন।'],
  },
  {
    key: 'baki_tab',
    icon: 'book',
    tone: 'baki',
    title: 'বাকি পাতা',
    lines: ['নিচে “বাকি” চাপুন।', 'কে কত বাকি আর মোট কত পাবেন দেখাবে।', `নাম চাপলে, বা “${LOOKUP_EXAMPLE_BN}” বললে, তার পুরো হিসাব শোনাবে।`],
  },
  {
    key: 'cash',
    icon: 'cash',
    tone: 'sale',
    title: 'হাতে ক্যাশ',
    lines: ['বিক্রি পাতার উপরে “হাতে ক্যাশ” চাপুন।', 'ক্যাশে কত টাকা থাকার কথা, আজকের খরচ দেখাবে।', '“খরচ বলুন” দিয়ে খরচ লিখুন, দিন শেষে “গুনে মিলান”।'],
  },
  {
    key: 'done',
    icon: 'settings',
    tone: 'sale',
    title: 'শুরু করুন',
    lines: ['আবার দেখতে ⚙ চাপুন, তারপর “অ্যাপ শেখা”।'],
  },
];

/** What the page says aloud: title, lines, then the example ("যেমন বলুন: …"). */
export function tutorialSpeech(p: TutorialPage): string {
  // 🎤 is said as মাইক; the other symbols only point at a button whose name follows
  const strip = (s: string) =>
    s.replace(/🎤\uFE0F?/gu, 'মাইক').replace(/[🔊⏸▶✅⚙]\uFE0F?\s*/gu, '').replace(/[“”]/g, '');
  const parts = [p.title, ...p.lines].map((s) => strip(s).trim().replace(/[।.!?]$/, ''));
  if (p.example) parts.push(`যেমন বলুন: ${p.example}`);
  return parts.join('। ') + '।';
}

/** "৩ / ১১" style position, Bangla digits. */
export const tutorialPosition = (i: number, total = TUTORIAL_PAGES.length) =>
  `${toBnDigits(i + 1)} / ${toBnDigits(total)}`;
