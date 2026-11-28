import { addDeviceEvent, deviceEvents, deviceRows, markSignedIn, markSignedOut, touchSeen } from '../devices';
import { ensureDevice, wipeAllData } from '../repo';
import { migratedDb, testWriter } from './nodeDb';

describe('own devices row', () => {
  it('sign-in writes session, model, signed in and last seen; the same again writes nothing', async () => {
    const db = await migratedDb();
    const w = testWriter();
    await ensureDevice(db, w, 'owner');
    await markSignedIn(db, w, 'sess-1', 'Pixel 7');
    const [r] = await deviceRows(db);
    expect(r).toMatchObject({ id: 'dev-1', device_name: 'আব্বু', role: 'owner', model: 'Pixel 7', session_id: 'sess-1', signed_in: 1 });
    expect(r!.last_seen_at).toBe(r!.updated_at);
    await markSignedIn(db, w, 'sess-1', 'Pixel 7');
    expect((await deviceRows(db))[0]!.updated_at).toBe(r!.updated_at);
  });

  it('a phone without a row yet (before Setup) gets one as কর্মচারী', async () => {
    const db = await migratedDb();
    await markSignedIn(db, testWriter(), 's', null);
    expect(await deviceRows(db)).toEqual([expect.objectContaining({ role: 'staff', signed_in: 1, session_id: 's', model: null })]);
  });

  it('sign-out keeps the session (for the list) and says লগ আউট', async () => {
    const db = await migratedDb();
    const w = testWriter();
    await markSignedIn(db, w, 's', 'Pixel 7');
    await markSignedOut(db, w);
    expect((await deviceRows(db))[0]).toMatchObject({ signed_in: 0, session_id: 's' });
  });

  it('last seen moves at most once per gap', async () => {
    const db = await migratedDb();
    let t = 1_000_000;
    const w = { ...testWriter(), now: () => t };
    await markSignedIn(db, w, 's', null);
    t += 30 * 60_000;
    expect(await touchSeen(db, w, 60 * 60_000)).toBe(false);
    t += 31 * 60_000;
    expect(await touchSeen(db, w, 60 * 60_000)).toBe(true);
    expect((await deviceRows(db))[0]!.last_seen_at).toBe(t);
  });
});

describe('device_events', () => {
  it('append-only: no update, no delete', async () => {
    const db = await migratedDb();
    const w = testWriter();
    const id = await addDeviceEvent(db, w, { target: 'dev-2', action: 'logout', targetSession: 's2' });
    expect(await deviceEvents(db)).toEqual([
      { id, target_device_id: 'dev-2', action: 'logout', target_session: 's2', device_name: 'আব্বু', created_at: expect.any(Number) },
    ]);
    await expect(db.runAsync("UPDATE device_events SET action = 'admin_on'")).rejects.toThrow(/append-only/);
    await expect(db.runAsync('DELETE FROM device_events')).rejects.toThrow(/append-only/);
    await expect(addDeviceEvent(db, w, { target: 'dev-2', action: 'boss' as never })).rejects.toThrow(/CHECK/);
  });

  it('সব তথ্য মুছুন clears them (admin starts over) and keeps the guard', async () => {
    const db = await migratedDb();
    const w = testWriter();
    await ensureDevice(db, w, 'owner');
    await addDeviceEvent(db, w, { target: 'dev-1', action: 'admin_on' });
    await wipeAllData(db, 'dev-1');
    expect(await deviceEvents(db)).toEqual([]);
    expect(await deviceRows(db)).toHaveLength(1);
    await addDeviceEvent(db, w, { target: 'dev-1', action: 'admin_on' });
    await expect(db.runAsync('DELETE FROM device_events')).rejects.toThrow(/append-only/);
  });
});
