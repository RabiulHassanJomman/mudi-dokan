/**
 * Field-by-field comparison of a parse with an expected (confirmed) result. Pure TS.
 * Used by the offline eval (scripts/eval-gemini.ts) and by the app's pilot log
 * (Android vs Gemini: which one matched what the shopkeeper confirmed).
 */
import type { Intent, ParsedCommand } from '../parser/types';
import { draftFromParse, fixtureFromLog, type PilotLog } from './pilot-fixtures';
import type { Expected, ExpectedItem } from './types';

/** The compared shape of any parse (rule parser or Gemini, both as ParsedCommand). */
export interface Norm {
  intent: Intent;
  customer: string | null;
  credit: boolean;
  amount: number | null;
  items: ExpectedItem[];
  item: string | null;
  person: string | null;
}

const clean = <T>(o: T): T => JSON.parse(JSON.stringify(o)) as T; // drops undefined
export const nfc = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim();

export function normParse(p: ParsedCommand): Norm {
  return {
    intent: p.intent,
    customer: p.customer || null,
    credit: p.credit === true,
    amount: p.amount ?? null,
    items: (p.intent === 'sale' ? p.items ?? [] : []).map((i) =>
      clean({ product: i.product, quantity: i.quantity, unitPrice: i.unitPrice, total: i.total }),
    ),
    item: p.item || null,
    person: p.person || null,
  };
}

const near = (a: number | null | undefined, b: number | null | undefined) =>
  (a ?? null) === null || (b ?? null) === null ? (a ?? null) === (b ?? null) : Math.abs(a! - b!) < 0.011;
const sameName = (a?: string | null, b?: string | null) => nfc(a ?? '') === nfc(b ?? '');

/**
 * Failed fields. Always compared: intent, customer, credit (baki), items, amount — an
 * absent expected value must be absent in the output too (no invented prices or names).
 * item/person only when expected gives them; unitPrice only when expected.
 */
export function diff(e: Expected, n: Norm): string[] {
  const bad: string[] = [];
  if (e.intent !== n.intent) bad.push('intent');
  if (!sameName(e.customer, n.customer)) bad.push('customer');
  if ((e.credit === true) !== n.credit) bad.push('credit');
  if (!near(e.amount, n.amount)) bad.push('amount');
  const ei = e.items ?? [];
  if (ei.length !== n.items.length) bad.push('items.length');
  else
    ei.forEach((x, k) => {
      const y = n.items[k]!;
      if (!sameName(x.product, y.product)) bad.push(`items[${k}].product`);
      if (!near(x.quantity?.value, y.quantity?.value) || (x.quantity?.unit ?? null) !== (y.quantity?.unit ?? null))
        bad.push(`items[${k}].quantity`);
      if (!near(x.total, y.total)) bad.push(`items[${k}].total`);
      if (x.unitPrice !== undefined && !near(x.unitPrice, y.unitPrice)) bad.push(`items[${k}].unitPrice`);
    });
  if (e.item !== undefined && !sameName(e.item, n.item)) bad.push('item');
  if (e.person !== undefined && !sameName(e.person, n.person)) bad.push('person');
  return bad;
}

/** Two parses say the same thing (Android vs Gemini agreement). */
export const agree = (a: ParsedCommand, b: ParsedCommand): boolean => diff(draftFromParse(a), normParse(b)).length === 0;

/**
 * What the shopkeeper confirmed, in the eval's terms (the pilot import's rules: an untouched
 * field keeps the shown parse's value, an edited one takes the saved value). null when there
 * is no confirmed result to score against (cancelled, a question, or an unsure label).
 * `log.parsed` must be the parse the confirm card showed.
 */
export function confirmedExpected(log: PilotLog): Expected | null {
  // transcript/stt_ok only gate the text eval; here the clip was heard by either engine
  const c = fixtureFromLog({ ...log, transcript: log.transcript?.trim() || '-', stt_ok: undefined });
  if (!('fixture' in c) || c.fixture.status === 'review') return null;
  return c.fixture.expected;
}

/** Did this parse match the confirmed result? null = nothing to score against. */
export function matchesConfirmed(expected: Expected | null, p: ParsedCommand | null): boolean | null {
  if (!expected || !p) return null;
  return diff(expected, normParse(p)).length === 0;
}
