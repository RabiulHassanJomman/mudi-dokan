/** Shared shapes for the eval (scripts/eval-*.ts) and the app's engine comparison (pure TS). */
import type { Intent, ParseContext, Unit } from '../parser/types';

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
  /**
   * "review" = expected is only a draft (the parser's guess, or a confirmed sale the import was
   * unsure of). Not scored. Label it by ear, then delete `status` (and `review_notes`).
   */
  status?: 'review';
  /** Why it needs review, e.g. "unconfirmed: joma", "items[0].price". */
  review_notes?: string[];
}
export interface Seed {
  products: { name: string; unit: Unit; price: number }[];
  customers: string[];
  /** Spoken name → product, like the app's product_aliases. */
  aliases: Record<string, string>;
  /** device_name of the shop's মালিক phones (the app's ctx.ownerNames); "মালিক" is built in. */
  owners?: string[];
}

/** Same text + tab = same case (whitespace and Unicode form ignored). */
export const fixtureKey = (text: string, tab: string) => `${tab}|${text.normalize('NFC').replace(/\s+/g, ' ').trim()}`;
