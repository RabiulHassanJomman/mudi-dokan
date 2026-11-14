/** Customer names: is it someone we know, and who did STT probably mean? Pure TS. */
import { dayLabel, formatNumber } from '../lib/bn';

const norm = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim();

export type CustomerStatus = 'known' | 'unknown' | 'missing';

export function customerStatus(name: string | null | undefined, known: readonly string[]): CustomerStatus {
  const n = norm(name ?? '');
  if (!n) return 'missing';
  return known.some((k) => norm(k) === n) ? 'known' : 'unknown';
}

/** Levenshtein distance over code points (Bangla vowel signs count as one each). */
export function distance(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[y.length]!;
}

/**
 * Known names closest to an unknown one ("কোরিম" → করিম), best first, at most `n`.
 * Only names within about a third of the length are offered; others are noise.
 */
export function suggestCustomers(name: string, known: readonly string[], n = 3): string[] {
  const q = norm(name);
  if (!q) return [];
  return known
    .map((k) => {
      const d = distance(q, norm(k));
      return { k, d, score: d / Math.max([...q].length, [...norm(k)].length) };
    })
    .filter((x) => x.score <= 0.4)
    .sort((a, b) => a.d - b.d || a.score - b.score)
    .slice(0, n)
    .map((x) => x.k);
}

// Bangla marks that belong to the letter before them: vowel signs, ং ঃ ঁ, nukta, ৗ
const MARK = /[ঁ-ঃ়া-ৌৗ]/;
const VIRAMA = '্';

/** First letter for the avatar, with its conjunct and vowel sign: "শ্যামল" → "শ্যা". */
export function initialOf(name: string): string {
  const cs = [...norm(name)];
  if (!cs.length) return '?';
  let out = cs[0]!;
  let i = 1;
  while (i < cs.length) {
    if (cs[i] === VIRAMA && i + 1 < cs.length) {
      out += cs[i]! + cs[i + 1]!;
      i += 2;
    } else if (MARK.test(cs[i]!)) {
      out += cs[i]!;
      i++;
    } else break;
  }
  return out;
}

/** "করিম, পাবো ২,৩০০ টাকা।" / "অগ্রিম দিয়েছে" when the customer paid ahead. */
export const balanceWords = (name: string, balancePoisha: number): string =>
  balancePoisha > 0
    ? `${name}, পাবো ${formatNumber(balancePoisha / 100)} টাকা।`
    : balancePoisha < 0
      ? `${name}, অগ্রিম দিয়েছে ${formatNumber(-balancePoisha / 100)} টাকা।`
      : `${name}, কোনো বাকি নেই।`;

/** "মোট কত বাকি?" list: customers who owe (> 0), largest first. */
export function owedList<T extends { balance_poisha: number }>(rows: readonly T[]): T[] {
  return rows.filter((r) => r.balance_poisha > 0).sort((a, b) => b.balance_poisha - a.balance_poisha);
}

/** "মোট বাকি ৪,১৫০ টাকা, ৪ জনের কাছে।" — no names; the list is on screen. */
export function totalBakiWords(rows: readonly { balance_poisha: number }[]): string {
  const owed = owedList(rows);
  if (!owed.length) return 'কারো কাছে কোনো বাকি নেই।';
  const total = owed.reduce((s, r) => s + r.balance_poisha, 0);
  return `মোট বাকি ${formatNumber(total / 100)} টাকা, ${formatNumber(owed.length)} জনের কাছে।`;
}

/** "করিম" → "করিমের", "সুমি" → "সুমির"; non-Bangla names get " এর". */
export function genitive(name: string): string {
  const last = name.slice(-1);
  if (!/[\u0980-\u09FF]/.test(last)) return `${name} এর`;
  return /[\u0985-\u0994\u09BE-\u09CC]/.test(last) ? `${name}র` : `${name}ের`;
}

const LAST_N = ['', 'শেষটা', 'শেষ দুইটা', 'শেষ তিনটা'];

/**
 * "করিমের হিসাব দেখাও": "করিমের মোট বাকি ২,৩০০ টাকা। শেষ তিনটা: আজ চাল, ডাল বাকি ৫০০ টাকা; …"
 * rows newest first (repo.customerHistory).
 */
export function historyWords(
  name: string,
  balancePoisha: number,
  rows: readonly { kind: 'baki' | 'joma'; amount_poisha: number; created_at: number; products: string | null }[],
  now = Date.now(),
): string {
  const head =
    balancePoisha > 0
      ? `${genitive(name)} মোট বাকি ${formatNumber(balancePoisha / 100)} টাকা।`
      : balancePoisha < 0
        ? `${name} অগ্রিম দিয়েছে ${formatNumber(-balancePoisha / 100)} টাকা।`
        : `${genitive(name)} কোনো বাকি নেই।`;
  if (!rows.length) return `${head} এখনো কোনো হিসাব নেই।`;
  const last = rows.slice(0, 3).map((r) => {
    const what = r.kind === 'joma' ? 'জমা' : r.products ? `${r.products} বাকি` : 'বাকি';
    return `${dayLabel(r.created_at, now)} ${what} ${formatNumber(r.amount_poisha / 100)} টাকা`;
  });
  return `${head} ${LAST_N[last.length]}: ${last.join('; ')}।`;
}

const key = (s: string) => norm(s).toLowerCase();

/** A heard name that is a known alias → that customer's name; else unchanged. */
export function resolveCustomerAlias(name: string | undefined, aliases: Readonly<Record<string, string>>): string | undefined {
  if (!name) return name;
  const k = key(name);
  const hit = Object.entries(aliases).find(([a]) => key(a) === k);
  return hit ? hit[1] : name;
}

/**
 * After a confirmed save (or a name picked on the "বাকি কত?" card): the heard name becomes
 * an alias of the chosen customer when the user corrected it to, or picked, an existing
 * customer. Not when the chosen one is new, or the heard name is itself a customer or alias
 * (then it was a different person, not another spelling).
 */
export function customerAliasToLearn(
  heard: string | null | undefined,
  chosen: string | null | undefined,
  knownBefore: readonly string[],
  aliases: Readonly<Record<string, string>>,
): string | null {
  const h = norm(heard ?? '');
  const c = norm(chosen ?? '');
  if (!h || !c || key(h) === key(c)) return null;
  if (!knownBefore.some((k) => key(k) === key(c))) return null;
  if (knownBefore.some((k) => key(k) === key(h))) return null;
  if (Object.keys(aliases).some((a) => key(a) === key(h))) return null;
  return h;
}
