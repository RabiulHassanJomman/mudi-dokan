/**
 * Android mode (docs/PLAN.md › Android parsing): the shopkeeper speaks with the Ridmik
 * keyboard's voice typing into a text box; the fixed formats read it. Pure TS.
 */
import { parseFixed, type FixedCommand, type FixedContext } from '../parser/fixed';

export type VoiceMode = 'android' | 'gemini';
export type VoiceTab = 'sale' | 'purchase' | 'ledger' | 'expense';

/** The setting (null = never set) → the mode in use. Gemini needs a key in the build. */
export const effectiveMode = (setting: VoiceMode | null, hasKey: boolean): VoiceMode =>
  setting === 'gemini' && hasKey ? 'gemini' : 'android';

export interface Carry {
  customer?: string;
  kind?: string;
}

export type VoiceRoute =
  | { pathname: '/say' | '/listening'; params: { tab: VoiceTab } & Carry }
  | { pathname: '/confirm'; params: { text: ''; tab: 'expense' } };

/** Where 🎤 goes. Android mode has no খরচ sentence, so খরচ opens the number pad. */
export function voiceRoute(mode: VoiceMode, tab: VoiceTab, carry: Carry = {}): VoiceRoute {
  const params = { tab, ...(carry.customer ? { customer: carry.customer } : {}), ...(carry.kind ? { kind: carry.kind } : {}) };
  if (mode === 'gemini') return { pathname: '/listening', params };
  if (tab === 'expense') return { pathname: '/confirm', params: { text: '', tab: 'expense' } };
  return { pathname: '/say', params };
}

/** Shown (and read by 🔊) above the text box, the tab's own format first. */
export const EXAMPLE_BN: Readonly<Record<Exclude<VoiceTab, 'expense'>, readonly string[]>> = {
  sale: ['নগদ বিক্রি আদা, চাল ১০০ টাকা', 'সাজু বাকি নিয়েছে আদা, চাল, আটা ১০০ টাকা'],
  purchase: ['১০০০ টাকার আলু কেনা হয়েছে'],
  ledger: ['সাজু বাকি নিয়েছে আদা, চাল, আটা ১০০ টাকা', 'সাজু ৫০ টাকা জমা দিয়েছে'],
};

/**
 * The typed text → the command. From a customer screen (জমা নিন / বাকি দিন) the customer is
 * known, so a বাকি / জমা without a name gets that one.
 */
export function readKeyboardText(text: string, ctx: FixedContext, defaults: { customer?: string } = {}): FixedCommand {
  const cmd = parseFixed(text, ctx);
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
