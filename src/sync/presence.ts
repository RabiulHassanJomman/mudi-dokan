/**
 * After every sync and every batch of rows from other phones: did an admin log this phone's
 * session out? (then its row says লগ আউট, to be pushed before the sign-out) Otherwise "শেষ
 * দেখা" moves on, at most hourly. Pure TS; the app does the push, sign-out and notice.
 */
import { deviceEvents, markSignedOut, touchSeen } from '../db/devices';
import type { Db, Writer } from '../db/repo';
import { logoutRequested } from '../domain/devices';

export const SEEN_GAP_MS = 60 * 60_000;

export type Presence = 'logout' | 'touched' | 'none';

export async function checkPresence(db: Db, w: Writer, session: string | null): Promise<Presence> {
  if (!session) return 'none';
  if (logoutRequested(await deviceEvents(db), w.deviceId, session)) {
    await markSignedOut(db, w);
    return 'logout';
  }
  return (await touchSeen(db, w, SEEN_GAP_MS)) ? 'touched' : 'none';
}
