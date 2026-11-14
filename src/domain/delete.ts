/**
 * মুছুন: what deleting an entry, a customer or a product means. Pure TS.
 *
 * - An entry is never removed: a correction row with voided = 1 (synced), hidden from every
 *   list and total; History can show it struck through.
 * - A customer or product has a row other tables point at (voided entries still do), and
 *   rows never leave the synced tables, so "delete" = archived (hidden everywhere, synced).
 *   Only with no live entries; otherwise it can only be hidden, and a customer who still
 *   owes (or is owed) can't even be hidden: that would lose the baki.
 */
import type { HistoryItem } from './history';
import type { RecentEntry } from './recent';
import { recentLine } from './recent';
import { formatTaka } from '../lib/bn';

/** The live (not voided) entries that point at a customer or product, and the customer's baki. */
export interface DeleteCheck {
  entries: number;
  balancePoisha: number;
}

export type DeletePlan = 'delete' | 'hide' | 'blocked';

/** No entries → delete; entries but nothing owed → only hide; baki either way → no. */
export function customerPlan(c: DeleteCheck): DeletePlan {
  if (c.balancePoisha !== 0) return 'blocked';
  return c.entries === 0 ? 'delete' : 'hide';
}

export const productPlan = (c: Pick<DeleteCheck, 'entries'>): DeletePlan => (c.entries === 0 ? 'delete' : 'hide');

/** The confirm text (also read aloud); null for 'blocked' (see blockedText). */
export function partyDeleteText(kind: 'customer' | 'product', name: string, plan: DeletePlan): string | null {
  const what = kind === 'customer' ? 'ক্রেতা' : 'মাল';
  if (plan === 'delete') return `${what} “${name}” মুছবেন?`;
  if (plan === 'hide') {
    return `“${name}”-এর হিসাব খাতায় আছে, তাই মোছা যাবে না। ${kind === 'customer' ? 'তালিকা' : 'মালের ঘর'} থেকে লুকিয়ে রাখবেন? খাতার লেখা থাকবে।`;
  }
  return null;
}

export function blockedText(name: string, balancePoisha: number): string {
  return `“${name}”-এর ${balancePoisha > 0 ? `বাকি ${formatTaka(balancePoisha)} আছে` : `জমা ${formatTaka(-balancePoisha)} আছে`}। আগে হিসাব মেটান, তারপর মুছুন।`;
}

/** What the confirm card says for an entry: the entry itself (its spoken line), then what হ্যাঁ does. */
export const deleteWords = (words: string): string => `মুছবেন? ${words} হ্যাঁ বললে খাতা থেকে আর হিসাব থেকে মুছে যাবে।`;

export const entryDeleteText = (e: RecentEntry | HistoryItem): string => deleteWords(recentLine(e).words);

/** History: voided entries only when "মোছা গুলো দেখুন" is on. */
export const visibleHistory = <T extends { voided: boolean }>(items: readonly T[], showVoided: boolean): T[] =>
  showVoided ? [...items] : items.filter((i) => !i.voided);

/** "মোছা গুলো দেখুন" shows how many there are; null when there are none (no toggle). */
export const voidedCount = (items: readonly { voided: boolean }[]): number => items.filter((i) => i.voided).length;
