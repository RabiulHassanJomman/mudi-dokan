import { parseCommand } from '../parse';
import type { ParseContext, ParsedCommand } from '../types';

type Expected = Partial<Omit<ParsedCommand, 'raw' | 'normalized'>>;

/** NFC every string in the expectation so য়/ড় spellings in test source don't matter. */
const nfcDeep = (v: unknown): unknown => {
  if (typeof v === 'string') return v.normalize('NFC');
  if (Array.isArray(v)) return v.map(nfcDeep);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, nfcDeep(x)]));
  }
  return v;
};

export interface Case {
  text: string;
  expected: Expected;
  ctx?: ParseContext;
}

/** Fields absent from `expected` that must also be absent from the result. */
const CHECKED: (keyof ParsedCommand)[] = [
  'product', 'item', 'customer', 'person', 'note', 'quantity', 'amount', 'buyPrice', 'sellPrice', 'credit', 'isNewProduct',
];

export function check({ text, expected, ctx }: Case): void {
  const r = parseCommand(text, ctx);
  expect(r).toMatchObject(nfcDeep({ missing: [], ...expected }) as object);
  for (const k of CHECKED) {
    if (!(k in expected)) expect({ [k]: r[k] }).toEqual({ [k]: undefined });
  }
}
