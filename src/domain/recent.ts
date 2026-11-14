/** Home "শেষ entry" list: every entry type, one line each, and what tapping it says. Pure TS. */
import { formatQty, spokenQty, toBnDigits } from '../lib/bn';
import type { Unit } from '../parser/types';

export type RecentKind = 'sale' | 'baki' | 'joma' | 'expense' | 'owner_withdrawal' | 'purchase';

/** One row of repo.recentEntries: a sale basket or one other entry. */
export interface RecentEntry {
  kind: RecentKind;
  id: string;
  /** Products ("চাল, ডাল"), the customer (বাকি/জমা), the item (খরচ) or who took cash. */
  title: string;
  /** Sale lines; 0 for other entries. */
  lines: number;
  /** One-line sale or purchase. */
  quantity: number | null;
  unit: Unit | null;
  amount_poisha: number;
  credit: number;
  /** Sale customer (cash or credit). */
  customer: string | null;
  audio_path: string | null;
  created_at: number;
}

export interface RecentLine {
  title: string;
  detail: string;
  /** Small coloured word on the right, under the amount. */
  badge: string | null;
  /** What TTS says when the row is tapped. */
  words: string;
}

const taka = (p: number) => `${toBnDigits(Math.round(p) / 100)} টাকা`;

export function recentLine(e: RecentEntry): RecentLine {
  const qty = e.quantity !== null && e.unit ? formatQty(e.quantity, e.unit) : '';
  const sayQty = e.quantity !== null && e.unit ? spokenQty(e.quantity, e.unit) : '';
  const money = taka(e.amount_poisha);
  switch (e.kind) {
    case 'sale': {
      const one = e.lines === 1;
      const who = e.customer ? `, ${e.customer}${e.credit ? ', বাকিতে' : ''}` : '';
      return {
        title: e.customer ? `${e.title} · ${e.customer}` : e.title,
        detail: one ? qty : `${toBnDigits(e.lines)}টি জিনিস`,
        badge: e.credit ? 'বাকি' : null,
        words: `বিক্রি: ${e.title}${one && sayQty ? ` ${sayQty}` : ''}${who}, ${money}।`,
      };
    }
    case 'baki':
      return { title: e.title, detail: 'বাকি', badge: 'বাকি', words: `${e.title} বাকি ${money}।` };
    case 'joma':
      return { title: e.title, detail: 'জমা দিল', badge: 'জমা', words: `${e.title} জমা দিল ${money}।` };
    case 'expense':
      return { title: e.title, detail: 'খরচ', badge: 'খরচ', words: `খরচ: ${e.title}, ${money}।` };
    case 'owner_withdrawal':
      return { title: e.title, detail: 'মালিক নিল', badge: 'মালিক নিল', words: `${e.title} নিল ${money}।` };
    case 'purchase':
      return {
        title: e.title,
        detail: qty ? `কেনা · ${qty}` : 'কেনা',
        badge: 'কেনা',
        words: `কেনা: ${e.title}${sayQty ? ` ${sayQty}` : ''}, ${money}।`,
      };
  }
}
