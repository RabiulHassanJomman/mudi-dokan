/**
 * ফোনগুলো in the DB: this phone's own devices row (sign-in session, model, last seen) and the
 * append-only device_events (admin on/off, remote logout). Pure TS (tested in Node).
 * A phone only ever writes its own devices row; what an admin does to another phone is an event.
 */
import type { DeviceAction, DeviceEvent, DeviceRow } from '../domain/devices';
import type { Db, Writer } from './repo';

export async function deviceRows(db: Db): Promise<DeviceRow[]> {
  return db.getAllAsync<DeviceRow>(
    'SELECT id, device_name, role, model, session_id, signed_in, last_seen_at, updated_at FROM devices',
  );
}

export async function deviceEvents(db: Db): Promise<DeviceEvent[]> {
  return db.getAllAsync<DeviceEvent>(
    'SELECT id, target_device_id, action, target_session, device_name, created_at FROM device_events ORDER BY created_at, id',
  );
}

export async function addDeviceEvent(
  db: Db,
  w: Writer,
  e: { target: string; action: DeviceAction; targetSession?: string | null },
): Promise<string> {
  const id = w.newId();
  const t = w.now();
  await db.runAsync(
    `INSERT INTO device_events (id, target_device_id, action, target_session, device_name, device_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id, e.target, e.action, e.targetSession ?? null, w.deviceName, w.deviceId, t, t,
  );
  return id;
}

/** This phone's row: made if missing (before Setup it is "এই ফোন", কর্মচারী). */
async function upsertOwn(
  db: Db,
  w: Writer,
  set: { model?: string | null; session_id?: string | null; signed_in?: 0 | 1; last_seen_at?: number },
  t = w.now(),
): Promise<void> {
  const exists = await db.getFirstAsync<{ id: string }>('SELECT id FROM devices WHERE id = ?', w.deviceId);
  if (!exists) {
    await db.runAsync(
      'INSERT INTO devices (id, device_name, role, device_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      w.deviceId, w.deviceName, 'staff', w.deviceId, t, t,
    );
  }
  const cols = Object.keys(set) as (keyof typeof set)[];
  await db.runAsync(
    `UPDATE devices SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
    ...cols.map((c) => set[c] ?? null), t, w.deviceId,
  );
}

/** Signed in to the shop account (session: a new one per sign-in, kept across restarts). */
export async function markSignedIn(db: Db, w: Writer, session: string, model: string | null): Promise<void> {
  const me = await db.getFirstAsync<{ session_id: string | null; signed_in: number | null; model: string | null }>(
    'SELECT session_id, signed_in, model FROM devices WHERE id = ?',
    w.deviceId,
  );
  if (me && me.session_id === session && me.signed_in === 1 && me.model === model) return;
  const t = w.now();
  await upsertOwn(db, w, { session_id: session, signed_in: 1, model, last_seen_at: t }, t);
}

/** লগ আউট (by hand or asked by an admin): written, and pushed, before the sign-out. */
export async function markSignedOut(db: Db, w: Writer): Promise<void> {
  await upsertOwn(db, w, { signed_in: 0 });
}

/** After a sync: "শেষ দেখা" moves on, at most every `gapMs`. Returns true if the row changed. */
export async function touchSeen(db: Db, w: Writer, gapMs: number): Promise<boolean> {
  const me = await db.getFirstAsync<{ last_seen_at: number | null }>('SELECT last_seen_at FROM devices WHERE id = ?', w.deviceId);
  const t = w.now();
  if (me?.last_seen_at != null && t - me.last_seen_at < gapMs) return false;
  await upsertOwn(db, w, { last_seen_at: t }, t);
  return true;
}
