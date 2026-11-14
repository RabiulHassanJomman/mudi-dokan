/** What the Listening screen does with a Gemini answer that is not an answer. Pure TS. */
import type { Verdict } from './understand';
import { backoffMs } from './understand';

/** Read aloud when the clip goes to the queue. */
export const QUEUED_BN = 'রেখে দিলাম। ইন্টারনেট এলে বুঝে নেব।';

/**
 * Where a clip that Gemini couldn't answer waits: no internet → as soon as the network is
 * back (a run starts then anyway); 429 / overload → a minute; anything else → the backoff.
 */
export function queueNext(v: Extract<Verdict, { kind: 'retry' }>, now: number): number {
  if (v.stop === 'offline') return 0;
  return now + (v.waitMs ?? backoffMs(1));
}
