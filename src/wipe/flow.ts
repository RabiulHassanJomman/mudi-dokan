/**
 * "সব তথ্য মুছুন": the strict confirmation, step by step. Pure TS (the screen is src/app/wipe.tsx).
 *
 *   scope → backup (a JSON copy is made and shared first) → type the shop name exactly →
 *   hold the button 5 seconds → a last spoken warning + হ্যাঁ → wipe.
 * Each step opens only when the ones before are done; changing the scope or the name
 * closes the later ones again.
 */

export type WipeScope = 'phone' | 'everywhere';

export const HOLD_MS = 5_000;
/** What to type when the shop has no name yet. */
export const FALLBACK_WORD = 'মুছুন';

export type Step = 'scope' | 'backup' | 'name' | 'hold' | 'final' | 'ready';

export interface WipeFlow {
  scope: WipeScope | null;
  /** The JSON copy was made and the share sheet shown. */
  backedUp: boolean;
  typed: string;
  /** The 5 s hold completed. */
  held: boolean;
  /** The final warning was answered হ্যাঁ. */
  confirmed: boolean;
}

export const START: WipeFlow = { scope: null, backedUp: false, typed: '', held: false, confirmed: false };

/** Letters as typed, but the same text however the keyboard composed it (NFC); spaces at the ends don't count. */
const norm = (s: string) => s.normalize('NFC').trim().replace(/\s+/g, ' ');

export const wordToType = (shopName: string | null) => (shopName && norm(shopName) ? norm(shopName) : FALLBACK_WORD);

export const nameMatches = (typed: string, shopName: string | null) => norm(typed) === wordToType(shopName);

export function step(f: WipeFlow, shopName: string | null): Step {
  if (!f.scope) return 'scope';
  if (!f.backedUp) return 'backup';
  if (!nameMatches(f.typed, shopName)) return 'name';
  if (!f.held) return 'hold';
  if (!f.confirmed) return 'final';
  return 'ready';
}

/** Choosing another scope starts the later steps again (the backup copy stays valid). */
export const chooseScope = (f: WipeFlow, scope: WipeScope): WipeFlow => (f.scope === scope ? f : { ...START, scope, backedUp: f.backedUp });

/** Typing again after the hold or the final answer: they must be done again. */
export const typeName = (f: WipeFlow, typed: string): WipeFlow => ({ ...f, typed, held: false, confirmed: false });

/** Progress of the press-and-hold, 0..1; releasing early starts over. */
export const holdProgress = (heldMs: number): number => Math.max(0, Math.min(1, heldMs / HOLD_MS));
export const holdDone = (heldMs: number): boolean => heldMs >= HOLD_MS;

export interface Counts {
  entries: number;
  customers: number;
  products: number;
}

/** The last warning, read aloud (TTS) and shown before হ্যাঁ. */
export function finalWarning(scope: WipeScope, shopName: string | null, c: Counts): string {
  const what = `${shopName ? `“${shopName}”-এর ` : ''}${c.entries}টা হিসাব, ${c.customers} জন ক্রেতা আর ${c.products}টা মাল`;
  return scope === 'everywhere'
    ? `সাবধান! ${what} এই ফোন, দোকানের সব ফোন, Google এর ডাটাবেস আর Drive এর “Mudi Dokan” ফোল্ডার থেকে চিরদিনের জন্য মুছে যাবে। আর ফেরত আনা যাবে না, শুধু আপনার রাখা ব্যাকআপ ফাইল থেকে ছাড়া। সত্যিই মুছবেন?`
    : `সাবধান! ${what} এই ফোন থেকে চিরদিনের জন্য মুছে যাবে, ফোনটা লগ আউট হবে। অন্য ফোন আর Google এ থাকা হিসাব থাকবে। সত্যিই মুছবেন?`;
}

export type WipeStatus = 'ok' | 'no_account' | 'offline' | 'cloud_failed';

export const WIPE_FAIL_BN: Record<Exclude<WipeStatus, 'ok'>, string> = {
  no_account: 'Google অ্যাকাউন্টে ঢোকা নেই। শুধু এই ফোন থেকে মুছুন, অথবা আগে ঢুকুন।',
  offline: 'ইন্টারনেট নেই। সব ফোন থেকে মুছতে নেট লাগবে। কিছু মোছা হয়নি।',
  cloud_failed: 'Google থেকে মোছা গেল না। ফোনের কিছু মোছা হয়নি। আবার চেষ্টা করুন।',
};
