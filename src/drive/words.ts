/** Bangla text for the Drive and ব্যাকআপ screens. Pure TS. */
import { formatNumber, toBnDigits } from '../lib/bn';
import { agoBn } from '../sync/words';

/** 0 → "০ কেবি", 1_300_000 → "১.৩ এমবি". */
export function bytesBn(n: number): string {
  if (n < 1_000_000) return `${formatNumber(Math.max(1, Math.round(n / 1000)), 0)} কেবি`;
  if (n < 1_000_000_000) return `${formatNumber(n / 1_000_000, 1)} এমবি`;
  return `${formatNumber(n / 1_000_000_000, 2)} জিবি`;
}

/** "১৪ নভেম্বর, রাত ৯:০৫" (local time). */
const MONTHS = ['জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'];
export function whenBn(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours();
  const part = h < 5 ? 'রাত' : h < 12 ? 'সকাল' : h < 15 ? 'দুপুর' : h < 18 ? 'বিকাল' : h < 20 ? 'সন্ধ্যা' : 'রাত';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${toBnDigits(d.getDate())} ${MONTHS[d.getMonth()]}, ${part} ${toBnDigits(h12)}:${toBnDigits(String(d.getMinutes()).padStart(2, '0'))}`;
}

export interface DriveWordsInput {
  signedIn: boolean;
  access: boolean | null;
  online: boolean;
  wifi: boolean;
  wifiOnly: boolean;
  pending: number;
  lastUploadAt: number | null;
  usageBytes: number | null;
}

/** One line on the state of uploads. */
export function driveStateBn(s: DriveWordsInput): string {
  if (!s.signedIn) return 'Google অ্যাকাউন্টে ঢোকা নেই — অডিও ফোনেই থাকছে';
  if (s.access === false) return 'Drive চালু নেই — অডিও ফোনেই থাকছে';
  if (!s.online) return 'ইন্টারনেট নেই — নেট এলে পাঠাবে';
  if (s.wifiOnly && !s.wifi && s.pending) return 'শুধু Wi-Fi তে পাঠাবে — Wi-Fi এলে যাবে';
  if (s.pending) return 'অডিও পাঠানো হচ্ছে';
  return 'সব অডিও Drive এ আছে';
}

/** What 🔊 reads on the Drive screen. */
export function driveWords(s: DriveWordsInput, now = Date.now()): string {
  const parts = [`${driveStateBn(s)}।`];
  if (s.usageBytes !== null) parts.push(`Drive এ অ্যাপের জায়গা ${bytesBn(s.usageBytes)}।`);
  parts.push(s.pending ? `${formatNumber(s.pending)}টা অডিও পাঠানো বাকি।` : 'পাঠানো বাকি নেই।');
  parts.push(`শেষ পাঠানো ${agoBn(s.lastUploadAt, now)}।`);
  parts.push(s.wifiOnly ? 'শুধু Wi-Fi তে পাঠায়।' : 'মোবাইল ডাটাতেও পাঠায়।');
  return parts.join(' ');
}

/** What 🔊 reads on the ব্যাকআপ screen. */
export function backupWords(lastAt: number | null, signedIn: boolean, now = Date.now()): string {
  const last = lastAt === null ? 'এখনো কোনো ব্যাকআপ নেই।' : `শেষ ব্যাকআপ ${agoBn(lastAt, now)}, ${whenBn(lastAt)}।`;
  const how = signedIn
    ? 'প্রতি রাতে আর দিন শেষ করলে Drive এ ব্যাকআপ হয়।'
    : 'Google অ্যাকাউন্টে ঢোকা নেই, তাই Drive এ ব্যাকআপ হচ্ছে না। ফাইল হিসেবে শেয়ার করে রাখুন।';
  return `${last} ${how}`;
}
