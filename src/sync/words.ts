/** Bangla text for the সিঙ্ক screen and the account card. Pure TS. */
import { formatNumber } from '../lib/bn';
import type { SyncPhase, SyncStatus } from './controller';
import { DAILY_WRITE_BUDGET } from './tables';

export const PHASE_BN: Record<SyncPhase, string> = {
  signed_out: 'Google অ্যাকাউন্টে ঢোকা নেই — সিঙ্ক বন্ধ',
  offline: 'ইন্টারনেট নেই — পরে সিঙ্ক হবে',
  idle: 'সিঙ্ক ঠিক আছে',
  syncing: 'সিঙ্ক হচ্ছে…',
  error: 'সিঙ্ক হয়নি — আবার চেষ্টা হবে',
  budget: 'আজকের ফ্রি সীমা শেষ — কাল আবার পাঠাবে',
};

/** "এইমাত্র", "৫ মিনিট আগে", "৩ ঘণ্টা আগে", "২ দিন আগে", "কখনো না". */
export function agoBn(ms: number | null, now = Date.now()): string {
  if (ms === null) return 'কখনো না';
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return 'এইমাত্র';
  const m = Math.floor(s / 60);
  if (m < 60) return `${formatNumber(m)} মিনিট আগে`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${formatNumber(h)} ঘণ্টা আগে`;
  return `${formatNumber(Math.floor(h / 24))} দিন আগে`;
}

/** What 🔊 reads on the সিঙ্ক screen. */
export function syncWords(s: SyncStatus, now = Date.now()): string {
  const parts = [`${PHASE_BN[s.phase]}।`];
  if (s.email) parts.push(`অ্যাকাউন্ট ${s.email}।`);
  if (s.stats) {
    parts.push(`শেষ সিঙ্ক ${agoBn(s.stats.lastSyncAt, now)}।`);
    parts.push(s.stats.pending ? `${formatNumber(s.stats.pending)}টা হিসাব পাঠানো বাকি।` : 'সব পাঠানো হয়েছে।');
    parts.push(`আজ পাঠানো ${formatNumber(s.stats.writesToday)}, সীমা ${formatNumber(DAILY_WRITE_BUDGET)}।`);
  }
  return parts.join(' ');
}
