/** Shared shapes for the offline eval (scripts/eval-*.ts). Mac-only, never bundled. */
import type { Intent, ParseContext, Unit } from '../src/parser/types';

export type Tab = NonNullable<ParseContext['tab']>;
/** new = hand-written, tests = from the unit tests, pilot = imported from a shop's pilot log (held out). */
export type Source = 'new' | 'tests' | 'pilot';

/** The fields we compare; same names as ParsedCommand. */
export interface ExpectedItem {
  product?: string;
  quantity?: { value: number; unit?: Unit };
  unitPrice?: number;
  total?: number;
}
export interface Expected {
  intent: Intent;
  customer?: string;
  credit?: boolean;
  amount?: number;
  items?: ExpectedItem[];
  item?: string;
  person?: string;
}
export interface Fixture {
  text: string;
  tab: Tab;
  source: Source;
  expected: Expected;
  /** pilot only: voice_logs.id, so a re-import skips it. */
  pilot_id?: string;
  /** pilot only: the shopkeeper changed something on the confirm card (the parser was wrong then). */
  edited?: boolean;
  /** pilot only: things the import could not be sure of; check by ear before trusting the case. */
  review?: string[];
}
export interface Seed {
  products: { name: string; unit: Unit; price: number }[];
  customers: string[];
  /** Spoken name → product, like the app's product_aliases. */
  aliases: Record<string, string>;
}

/** Same text + tab = same case (whitespace and Unicode form ignored). */
export const fixtureKey = (text: string, tab: string) => `${tab}|${text.normalize('NFC').replace(/\s+/g, ' ').trim()}`;
