/**
 * "এই দুইটা কি একই?" — after two phones' data meet (first sync), the same product or
 * customer may exist twice ("চাল" made on both phones, "রহিম" / "Rahim"). Pure TS.
 * Same sound (phoneticKey) = a candidate; the user decides. Short keys (চাল = "cl") also
 * need nearly the same spelling, so চিনি / চানা are not offered.
 */
import { distance } from './customers';
import { nameKey, phoneticKey } from './names';

export type MergeKind = 'product' | 'customer';

export interface MergeItem {
  id: string;
  name: string;
  createdAt: number;
  /** How many entries use it: the busier one is kept. */
  uses: number;
  /** Unit (product) or phone (customer), to tell them apart on screen. */
  detail: string | null;
}

export interface MergePair {
  kind: MergeKind;
  keep: MergeItem;
  dup: MergeItem;
  /** Same for (a, b) and (b, a): what "না" remembers. */
  key: string;
}

export const pairKey = (kind: MergeKind, a: string, b: string) => `${kind}:${[a, b].sort().join('|')}`;

const SHORT_KEY = 2;

function alike(a: string, b: string): boolean {
  const ka = phoneticKey(a);
  if (!ka || ka !== phoneticKey(b)) return false;
  if (ka.length > SHORT_KEY) return true;
  return distance(nameKey(a), nameKey(b)) <= 1;
}

/** Busier first, then older, then id: the one to keep. */
const keepFirst = (a: MergeItem, b: MergeItem) => b.uses - a.uses || a.createdAt - b.createdAt || a.id.localeCompare(b.id);

/**
 * Pairs to ask about, each duplicate against the one to keep in its group. Pairs the user
 * said "না" to (`dismissed` keys) are left out. Different phones on a customer = not the same.
 */
export function duplicatePairs(kind: MergeKind, items: readonly MergeItem[], dismissed: ReadonlySet<string> = new Set()): MergePair[] {
  const pairs: MergePair[] = [];
  const used = new Set<string>();
  const sorted = [...items].sort(keepFirst);
  for (let i = 0; i < sorted.length; i++) {
    const keep = sorted[i]!;
    if (used.has(keep.id)) continue;
    for (let j = i + 1; j < sorted.length; j++) {
      const dup = sorted[j]!;
      if (used.has(dup.id) || !alike(keep.name, dup.name)) continue;
      if (kind === 'customer' && keep.detail && dup.detail && keep.detail !== dup.detail) continue;
      const key = pairKey(kind, keep.id, dup.id);
      if (dismissed.has(key)) continue;
      used.add(dup.id);
      pairs.push({ kind, keep, dup, key });
    }
  }
  return pairs;
}

export const mergeQuestion = (p: MergePair) => `${p.keep.name} আর ${p.dup.name}, এই দুইটা কি একই?`;
