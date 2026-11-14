/** Which products and customers go into the prompt. Pure TS. */
import type { Unit } from '../parser/types';
import type { PromptContext, Tab } from './prompt';

export const MAX_PRODUCTS = 15;
export const MAX_CUSTOMERS = 15;

const nfc = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim();
const bigrams = (s: string) => {
  const t = [...s.replace(/\s/g, '')];
  const out: string[] = [];
  for (let i = 0; i < t.length - 1; i++) out.push(t[i]! + t[i + 1]!);
  return out.length ? out : t;
};

/** Dice coefficient on character bigrams. */
export function dice(a: string, b: string): number {
  const A = bigrams(a);
  const pool = bigrams(b);
  const total = A.length + pool.length;
  let hit = 0;
  for (const x of A) {
    const j = pool.indexOf(x);
    if (j >= 0) {
      hit++;
      pool.splice(j, 1);
    }
  }
  return (2 * hit) / (total || 1);
}

export interface CatalogProduct {
  name: string;
  unit: Unit;
  aliases: string[];
}

/**
 * Top n products. With a hint (the Android transcript, when there is one) the closest names
 * first; ties keep the given order (most sold first). Without a hint: the given order.
 */
export function topProducts<P extends CatalogProduct>(catalog: readonly P[], hint: string | null, n = MAX_PRODUCTS): P[] {
  const text = nfc(hint ?? '');
  if (!text) return catalog.slice(0, n);
  const words = text.split(' ');
  const windows = [...words, ...words.slice(1).map((w, i) => `${words[i]} ${w}`)];
  return catalog
    .map((p, order) => {
      const score = Math.max(
        ...[p.name, ...p.aliases].map((s) => (text.includes(nfc(s)) ? 1 : Math.max(...windows.map((w) => dice(w, nfc(s)))))),
      );
      return { p, score, order };
    })
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, n)
    .map((x) => x.p);
}

export function promptContext(args: {
  tab: Tab;
  catalog: readonly CatalogProduct[];
  /** Most relevant first (most owed). */
  customers: readonly string[];
  /** Customer name → learned spellings. */
  customerAliases?: Readonly<Record<string, readonly string[]>>;
  hint: string | null;
  device?: PromptContext['device'];
}): PromptContext {
  const customers = args.customers.slice(0, MAX_CUSTOMERS);
  const aliases = Object.fromEntries(
    customers.filter((n) => args.customerAliases?.[n]?.length).map((n) => [n, [...args.customerAliases![n]!]]),
  );
  return {
    tab: args.tab,
    products: topProducts(args.catalog, args.hint).map((p) => ({ name: p.name, unit: p.unit, aliases: p.aliases })),
    customers,
    ...(Object.keys(aliases).length ? { customerAliases: aliases } : {}),
    ...(args.device ? { device: args.device } : {}),
  };
}
