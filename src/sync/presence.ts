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

export interface RemoteLogoutSteps {
  /** Send everything unsent (throws when it can't). */
  push(): Promise<void>;
  /** Rows still not sent after the push (offline, daily limit). */
  pending(): Promise<number>;
  /** Stop syncing and sign out of the shop account. */
  signOut(): Promise<void>;
  /** Erase this phone's data and files (its own devices row stays). */
  wipe(): Promise<void>;
}

/**
 * An admin logged this phone out: its data goes, but never before the cloud has all of it
 * (what was sold on this phone stays in the shop). So: push → nothing left unsent → sign out
 * (no listener can bring rows back) → erase. Returns false when something is still unsent:
 * nothing is erased, and the next sync tries again (the event is still there).
 */
export async function remoteLogout(s: RemoteLogoutSteps): Promise<boolean> {
  try {
    await s.push();
  } catch {
    return false;
  }
  if ((await s.pending()) > 0) return false;
  await s.signOut();
  await s.wipe();
  return true;
}
