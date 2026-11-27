/**
 * Android mode (docs/PLAN.md › Android parsing): the shopkeeper speaks with the Ridmik
 * keyboard's voice typing into a text box; the fixed formats read it. Pure TS.
 */
import { parseFixed, type FixedCommand, type FixedContext } from '../parser/fixed';
import { distance } from './customers';
import { nameKey, phoneticKey } from './names';

export type VoiceTab = 'sale' | 'purchase' | 'ledger' | 'expense';

export interface Carry {
  customer?: string;
  kind?: string;
}

export type VoiceRoute =
  | { pathname: '/say'; params: { tab: VoiceTab } & Carry }
  | { pathname: '/confirm'; params: { text: ''; tab: 'expense' } };

/** Where 🎤 goes. There is no খরচ sentence, so খরচ opens the number pad. */
export function voiceRoute(tab: VoiceTab, carry: Carry = {}): VoiceRoute {
  const params = { tab, ...(carry.customer ? { customer: carry.customer } : {}), ...(carry.kind ? { kind: carry.kind } : {}) };
  if (tab === 'expense') return { pathname: '/confirm', params: { text: '', tab: 'expense' } };
  return { pathname: '/say', params };
}

/** Shown (and read by 🔊) above the text box, the tab's own format first. */
export const EXAMPLE_BN: Readonly<Record<Exclude<VoiceTab, 'expense'>, readonly string[]>> = {
  sale: ['নগদ বিক্রি আদা, চাল ১০০ টাকা', 'সাজু বাকি নিয়েছে আদা, চাল, আটা ১০০ টাকা'],
  purchase: ['১০০০ টাকার আলু কেনা হয়েছে'],
  ledger: ['সাজু বাকি নিয়েছে আদা, চাল, আটা ১০০ টাকা', 'সাজু ৫০ টাকা জমা দিয়েছে'],
};

// "সাজুর", "সাজুকে": the name is the stem
const CASE_ENDINGS = ['কে', 'ের', 'র'].map((e) => e.normalize('NFC'));
/** A close spelling: edits ≤ this share of the longer name. */
const CLOSE = 0.34;

/**
 * The heard customer name → the shop's customer it most likely is (the list was imported):
 * a learned alias, the same name, the same name without a case ending, the same sound
 * (শাজু = সাজু), or the one clearly closest spelling. Kept as heard when no one, or two
 * equally, fit: the card then asks (closest names or নতুন ক্রেতা).
 */
export function matchCustomer(heard: string | undefined, known: readonly string[], aliases: Readonly<Record<string, string>>): string | undefined {
  if (!heard?.trim() || !known.length) return heard;
  const h = nameKey(heard);
  const stems = [h, ...CASE_ENDINGS.filter((e) => h.length > e.length + 1 && h.endsWith(e)).map((e) => h.slice(0, -e.length))];
  const byKey = new Map(known.map((k) => [nameKey(k), k]));
  const byAlias = new Map(Object.entries(aliases).map(([a, k]) => [nameKey(a), k]));
  for (const st of stems) {
    const hit = byAlias.get(st) ?? byKey.get(st);
    if (hit) return hit;
  }
  const one = (found: string[]) => (new Set(found).size === 1 ? found[0] : undefined);
  for (const st of stems) {
    const sound = phoneticKey(st);
    const same = sound.length >= 2 ? one(known.filter((k) => phoneticKey(k) === sound)) : undefined;
    if (same) return same;
  }
  let best: { k: string; score: number } | null = null;
  let tie = false;
  for (const st of stems) {
    for (const k of known) {
      const kk = nameKey(k);
      const score = distance(st, kk) / Math.max([...st].length, [...kk].length);
      if (score > CLOSE) continue;
      if (!best || score < best.score) {
        best = { k, score };
        tie = false;
      } else if (score === best.score && k !== best.k) tie = true;
    }
  }
  return best && !tie ? best.k : heard;
}

/**
 * The typed text → the command, its customer matched to the list (matchCustomer). From a
 * customer screen (জমা নিন / বাকি দিন) the customer is known, so a বাকি / জমা without a name
 * gets that one.
 */
export function readKeyboardText(
  text: string,
  ctx: FixedContext,
  defaults: { customer?: string } = {},
  customerAliases: Readonly<Record<string, string>> = {},
): FixedCommand {
  const parsed = parseFixed(text, ctx);
  // ctx.knownCustomers may carry alias spellings too (they help the parser find the name)
  const customers = (ctx.knownCustomers ?? []).filter((k) => !Object.hasOwn(customerAliases, k));
  const matched = matchCustomer(parsed.customer, customers, customerAliases);
  const cmd = matched ? { ...parsed, customer: matched } : parsed;
  const name = defaults.customer?.trim();
  if (!name || cmd.customer || !cmd.problems.includes('no_customer')) return cmd;
  return { ...cmd, customer: name, problems: cmd.problems.filter((p) => p !== 'no_customer') };
}

/** What to tell the shopkeeper (screen + 🔊); '' when the sentence is complete. */
export function fixedProblemWords(cmd: FixedCommand): string {
  const out: string[] = [];
  for (const p of cmd.problems) {
    if (p === 'no_match') out.push('বুঝিনি। বাকি, নগদ, কেনা বা জমা — কোনটা? নমুনার মতো বলুন।');
    else if (p === 'two_types') out.push('একসাথে দুই রকম বলেছেন। বাকি, নগদ, কেনা বা জমা — একটা বলুন।');
    else if (p === 'no_customer') out.push('কার নাম বলুন।');
    else if (p === 'no_goods') out.push('কী কী মাল, বলুন।');
    else if (p === 'many_goods') out.push('একবারে একটা মাল কেনা বলুন।');
    else if (p === 'no_amount') out.push('কত টাকা বলুন। যেমন: ১০০ টাকা।');
    else out.push('টাকা একবার বলুন: সব মিলিয়ে মোট কত।');
  }
  return out.join(' ');
}

const TRY_AGAIN = 'মাইক চেপে আবার বলুন।';

/** Recognizer error code → what the screen shows and says ('' = say nothing: the user stopped it). */
export function heardErrorWords(code: string): string {
  switch (code) {
    case 'aborted':
      return '';
    case 'no-speech':
    case 'speech-timeout':
      return `কিছু শুনিনি। ${TRY_AGAIN}`;
    case 'not-allowed':
      return 'মাইকের অনুমতি নেই। অনুমতি দিন, অথবা কিবোর্ডের মাইকে বলুন।';
    case 'service-not-allowed':
    case 'language-not-supported':
      return 'এই ফোনে কথা শোনার ব্যবস্থা নেই। লেখার ঘরে চেপে কিবোর্ডের মাইকে বলুন।';
    case 'network':
      return `ইন্টারনেট নেই। ${TRY_AGAIN}`;
    default:
      return `শোনা গেল না। ${TRY_AGAIN}`;
  }
}

/**
 * Where expo-speech-recognition writes a recording (resolveFilePathFromConfig: folder without
 * file:// and trailing /, then /name), as the file:// uri its audioend event reports.
 */
export const clipUri = (dir: string, name: string): string => `file://${dir.replace(/^file:\/\//, '').replace(/\/+$/, '')}/${name}`;
