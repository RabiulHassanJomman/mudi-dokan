/**
 * আজকের খাতা (History): every entry of a day — one row per sale basket or other entry —
 * with what a fix (correction row) changed, and undone (voided) entries struck through.
 * Pure TS: the repo gives every version of every row of the day; this keeps the latest.
 */
import { formatQty, formatTaka, toBnDigits } from '../lib/bn';
import type { Unit } from '../parser/types';
import { recentLine, type RecentEntry, type RecentKind } from './recent';

export type EntryTable = 'sales' | 'ledger' | 'expenses' | 'owner_withdrawals' | 'purchases';

/** One row of one entry table (any version), as repo.historyRows gives it. */
export interface RawEntry {
  table: EntryTable;
  id: string;
  corrects_id: string | null;
  voided: number;
  /** When it happened (a correction keeps its original's time). */
  at: number;
  created_at: number;
  /** ledger: 'baki' | 'joma'. */
  kind: string | null;
  basket_id: string | null;
  line_no: number | null;
  /** ledger: the credit sale it belongs to. */
  sale_id: string | null;
  /** Product, customer (ledger), item (খরচ) or who took cash. */
  title: string;
  quantity: number | null;
  unit: Unit | null;
  amount_poisha: number;
  credit: number;
  /** Sale customer. */
  customer: string | null;
  audio_path: string | null;
}

export interface HistoryItem extends RecentEntry {
  table: EntryTable;
  /** Undone ("ভুল হয়েছে" / ✏️ বাতিল): shown struck through, not in totals. */
  voided: boolean;
  /** Changed by a correction (blue border). */
  fixed: boolean;
  /** The first version's values, when a fix changed them. */
  oldQuantity: number | null;
  oldAmountPoisha: number | null;
}

/** Latest version of each entry, with its first version. */
function chains(rows: readonly RawEntry[]): { latest: RawEntry; root: RawEntry }[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const corrected = new Set(rows.map((r) => r.corrects_id).filter((x): x is string => !!x));
  return rows
    .filter((r) => !corrected.has(r.id))
    .map((latest) => {
      let root = latest;
      const seen = new Set<string>();
      while (root.corrects_id && byId.has(root.corrects_id) && !seen.has(root.id)) {
        seen.add(root.id);
        root = byId.get(root.corrects_id)!;
      }
      return { latest, root };
    });
}

const KIND_OF: Record<Exclude<EntryTable, 'sales' | 'ledger'>, RecentKind> = {
  expenses: 'expense',
  owner_withdrawals: 'owner_withdrawal',
  purchases: 'purchase',
};

/** Newest first. A credit sale's own baki row is shown with the sale, not on its own. */
export function buildHistory(rows: readonly RawEntry[]): HistoryItem[] {
  const out: HistoryItem[] = [];
  const tables = new Map<EntryTable, RawEntry[]>();
  for (const r of rows) tables.set(r.table, [...(tables.get(r.table) ?? []), r]);

  // sale baskets
  const baskets = new Map<string, { latest: RawEntry; root: RawEntry }[]>();
  for (const c of chains(tables.get('sales') ?? [])) {
    const key = c.latest.basket_id ?? c.root.id;
    baskets.set(key, [...(baskets.get(key) ?? []), c]);
  }
  for (const [id, lines] of baskets) {
    lines.sort((a, b) => (a.latest.line_no ?? 0) - (b.latest.line_no ?? 0));
    const live = lines.filter((l) => !l.latest.voided);
    const shown = live.length ? live : lines;
    const one = shown.length === 1 ? shown[0]! : null;
    const amount = live.reduce((s, l) => s + l.latest.amount_poisha, 0);
    const oldAmount = lines.reduce((s, l) => s + l.root.amount_poisha, 0);
    const fixed = lines.some((l) => l.latest.id !== l.root.id);
    const first = lines[0]!.latest;
    out.push({
      table: 'sales',
      kind: 'sale',
      id,
      title: shown.map((l) => l.latest.title).join(', '),
      lines: shown.length,
      quantity: one ? one.latest.quantity : null,
      unit: one ? one.latest.unit : null,
      amount_poisha: live.length ? amount : oldAmount,
      credit: shown.some((l) => l.latest.credit) ? 1 : 0,
      customer: shown.find((l) => l.latest.customer)?.latest.customer ?? null,
      audio_path: lines.find((l) => l.latest.audio_path)?.latest.audio_path ?? null,
      created_at: first.at,
      voided: !live.length,
      fixed: fixed && live.length > 0,
      oldQuantity: one && one.root.quantity !== one.latest.quantity ? one.root.quantity : null,
      oldAmountPoisha: fixed && live.length && oldAmount !== amount ? oldAmount : null,
    });
  }

  for (const table of ['ledger', 'expenses', 'owner_withdrawals', 'purchases'] as const) {
    for (const { latest, root } of chains(tables.get(table) ?? [])) {
      if (table === 'ledger' && (latest.basket_id || latest.sale_id)) continue;
      const kind: RecentKind = table === 'ledger' ? (latest.kind === 'joma' ? 'joma' : 'baki') : KIND_OF[table];
      const fixed = latest.id !== root.id && !latest.voided;
      out.push({
        table,
        kind,
        id: latest.id,
        title: latest.title,
        lines: 0,
        quantity: latest.quantity,
        unit: latest.unit,
        amount_poisha: latest.amount_poisha,
        credit: 0,
        customer: null,
        audio_path: latest.audio_path,
        created_at: latest.at,
        voided: !!latest.voided,
        fixed,
        oldQuantity: fixed && root.quantity !== latest.quantity ? root.quantity : null,
        oldAmountPoisha: fixed && root.amount_poisha !== latest.amount_poisha ? root.amount_poisha : null,
      });
    }
  }
  return out.sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id));
}

// ── filters (সব / বিক্রি / বাকি / খরচ) ─────────────────────────

export type HistoryFilter = 'all' | 'sale' | 'baki' | 'expense';

export const HISTORY_FILTERS: readonly { key: HistoryFilter; label: string }[] = [
  { key: 'all', label: 'সব' },
  { key: 'sale', label: 'বিক্রি' },
  { key: 'baki', label: 'বাকি' },
  { key: 'expense', label: 'খরচ' },
];

/** বাকি = বাকি, জমা and credit sales; খরচ = খরচ, মালিক নিল and মাল কেনা (cash out). */
export function matchesFilter(i: HistoryItem, f: HistoryFilter): boolean {
  switch (f) {
    case 'all':
      return true;
    case 'sale':
      return i.kind === 'sale';
    case 'baki':
      return i.kind === 'baki' || i.kind === 'joma' || (i.kind === 'sale' && !!i.credit);
    case 'expense':
      return i.kind === 'expense' || i.kind === 'owner_withdrawal' || i.kind === 'purchase';
  }
}

// ── one row on screen ──────────────────────────────────────────

export interface HistoryLine {
  title: string;
  detail: string;
  /** A fix: the old value (struck through) and the new one: "~~৩ কেজি~~ → ১ কেজি". */
  old: string | null;
  now: string | null;
  badge: string | null;
  words: string;
}

export function historyLine(i: HistoryItem): HistoryLine {
  const base = recentLine(i);
  let old: string | null = null;
  let now: string | null = null;
  if (i.fixed && i.oldQuantity !== null && i.quantity !== null && i.unit) {
    old = formatQty(i.oldQuantity, i.unit);
    now = formatQty(i.quantity, i.unit);
  } else if (i.fixed && i.oldAmountPoisha !== null) {
    old = formatTaka(i.oldAmountPoisha);
    now = formatTaka(i.amount_poisha);
  }
  if (i.voided) return { ...base, old: null, now: null, badge: 'বাতিল', words: `বাতিল করা: ${base.words}` };
  const was = old ? ` আগে ছিল ${old.replace('৳ ', '')}${old.startsWith('৳') ? ' টাকা' : ''}।` : i.fixed ? ' ঠিক করা হয়েছে।' : '';
  return { ...base, old, now, words: base.words + was };
}

/** 🔊 on the History screen. `title`: "আজকের খাতা", "১১ নভে-এর খাতা". */
export function historyWords(items: readonly HistoryItem[], title: string): string {
  const live = items.filter((i) => !i.voided);
  if (!live.length) return `${title}। কোনো লেখা নেই।`;
  const sales = live.filter((i) => i.kind === 'sale').reduce((s, i) => s + i.amount_poisha, 0);
  const fixed = live.filter((i) => i.fixed).length;
  return (
    `${title}। ${toBnDigits(live.length)}টি লেখা। বিক্রি ${toBnDigits(sales / 100)} টাকা।` +
    (fixed ? ` ${toBnDigits(fixed)}টি ঠিক করা হয়েছে।` : '') +
    ' শুনতে প্লে চাপুন, ঠিক করতে কলম চাপুন।'
  );
}
