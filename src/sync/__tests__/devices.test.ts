/** ফোনগুলো across two phones: admin claimed on one, seen on the other; remote logout of a session. */
import { addDeviceEvent, deviceEvents, deviceRows, markSignedIn } from '../../db/devices';
import { createVoiceLog, ensureDevice, type Writer } from '../../db/repo';
import { migratedDb } from '../../db/__tests__/nodeDb';
import { adminIds, deviceCards } from '../../domain/devices';
import { SyncEngine } from '../engine';
import { checkPresence, remoteLogout, SEEN_GAP_MS } from '../presence';
import { FakeCloud } from './fakeRemote';

async function phone(cloud: FakeCloud, name: string, role: 'owner' | 'staff') {
  const db = await migratedDb();
  let t = 1_794_000_000_000;
  let n = 0;
  const w: Writer & { skip(ms: number): void } = {
    deviceId: `dev-${name}`,
    deviceName: name,
    newId: () => `${name}-${++n}`,
    now: () => (t += 1000),
    skip: (ms) => {
      t += ms;
    },
  };
  await ensureDevice(db, w, role);
  const engine = new SyncEngine(db, () => t);
  engine.setRemote(cloud.client('uid'));
  const sync = async () => {
    await engine.push();
    await engine.pull();
  };
  return { db, w, engine, sync };
}

it('the Pixel claims admin, makes Rafiq admin, logs out Rafiq’s session; Rafiq signs out and both phones agree', async () => {
  const cloud = new FakeCloud();
  const pixel = await phone(cloud, 'pixel', 'owner');
  const rafiq = await phone(cloud, 'rafiq', 'staff');
  await markSignedIn(pixel.db, pixel.w, 'p-1', 'Pixel 7');
  await markSignedIn(rafiq.db, rafiq.w, 'r-1', 'Galaxy A15');
  await pixel.sync();
  await rafiq.sync();
  await pixel.sync();

  // the Pixel sees both phones, signed in
  expect(deviceCards(await deviceRows(pixel.db), [], 'dev-pixel').map((c) => [c.id, c.model, c.state])).toEqual([
    ['dev-pixel', 'Pixel 7', 'in'],
    ['dev-rafiq', 'Galaxy A15', 'in'],
  ]);

  await addDeviceEvent(pixel.db, pixel.w, { target: 'dev-pixel', action: 'admin_on' });
  await addDeviceEvent(pixel.db, pixel.w, { target: 'dev-rafiq', action: 'admin_on' });
  await pixel.sync();
  await rafiq.sync();
  expect([...adminIds(await deviceEvents(rafiq.db))].sort()).toEqual(['dev-pixel', 'dev-rafiq']);

  // the Pixel logs out the session it sees on Rafiq's phone
  const target = (await deviceRows(pixel.db)).find((r) => r.id === 'dev-rafiq')!;
  await addDeviceEvent(pixel.db, pixel.w, { target: target.id, action: 'logout', targetSession: target.session_id });
  await pixel.sync();
  expect(deviceCards(await deviceRows(pixel.db), await deviceEvents(pixel.db), 'dev-pixel')[1]!.state).toBe('leaving');

  // Rafiq's phone gets it and marks itself লগ আউট (the app pushes that, then signs out)
  await rafiq.sync();
  expect(await checkPresence(rafiq.db, rafiq.w, 'r-1')).toBe('logout');
  await rafiq.engine.push();
  await pixel.sync();
  expect(deviceCards(await deviceRows(pixel.db), await deviceEvents(pixel.db), 'dev-pixel')[1]!.state).toBe('out');
  // the Pixel stays signed in; its own check finds nothing
  expect(await checkPresence(pixel.db, pixel.w, 'p-1')).toBe('none');

  // Rafiq signs in again: a new session, the old logout doesn't touch it
  await markSignedIn(rafiq.db, rafiq.w, 'r-2', 'Galaxy A15');
  rafiq.w.skip(SEEN_GAP_MS);
  expect(await checkPresence(rafiq.db, rafiq.w, 'r-2')).toBe('touched');
  await rafiq.sync();
  await pixel.sync();
  expect(deviceCards(await deviceRows(pixel.db), await deviceEvents(pixel.db), 'dev-pixel')[1]!.state).toBe('in');
});

it('not signed in (no session): nothing to check', async () => {
  const a = await phone(new FakeCloud(), 'a', 'owner');
  expect(await checkPresence(a.db, a.w, null)).toBe('none');
});

describe('remote logout erases the phone, after everything is sent', () => {
  it('Rafiq’s unsent entry reaches the Pixel first; then Rafiq’s phone is empty except its own row', async () => {
    const cloud = new FakeCloud();
    const pixel = await phone(cloud, 'pixel', 'owner');
    const rafiq = await phone(cloud, 'rafiq', 'staff');
    await markSignedIn(rafiq.db, rafiq.w, 'r-1', null);
    await rafiq.sync();
    await pixel.sync();
    await addDeviceEvent(pixel.db, pixel.w, { target: 'dev-rafiq', action: 'admin_on' });
    // the Pixel logs Rafiq out while Rafiq says something new (not sent yet)
    await addDeviceEvent(pixel.db, pixel.w, { target: 'dev-rafiq', action: 'logout', targetSession: 'r-1' });
    await pixel.sync();
    await createVoiceLog(rafiq.db, rafiq.w, { transcript: 'সাজু বাকি ৫০ টাকা', source: 'voice', contextTab: 'ledger' });
    await rafiq.engine.pull();
    expect(await checkPresence(rafiq.db, rafiq.w, 'r-1')).toBe('logout');

    const order: string[] = [];
    const ok = await remoteLogout({
      push: async () => {
        order.push('push');
        await rafiq.engine.push();
      },
      pending: () => rafiq.engine.pendingCount(),
      signOut: async () => {
        order.push('signOut');
        rafiq.engine.setRemote(null);
      },
      wipe: async () => {
        order.push('wipe');
        await rafiq.engine.wipeLocal('dev-rafiq');
      },
    });
    expect(ok).toBe(true);
    expect(order).toEqual(['push', 'signOut', 'wipe']);
    // the entry is safe on the Pixel; Rafiq's phone kept only its own (লগ আউট) row
    await pixel.sync();
    expect((await pixel.db.getAllAsync<{ transcript: string }>('SELECT transcript FROM voice_logs')).map((r) => r.transcript)).toContain('সাজু বাকি ৫০ টাকা');
    expect(deviceCards(await deviceRows(pixel.db), await deviceEvents(pixel.db), 'dev-pixel').find((c) => c.id === 'dev-rafiq')!.state).toBe('out');
    expect(await rafiq.db.getAllAsync('SELECT id FROM voice_logs')).toEqual([]);
    expect(await deviceEvents(rafiq.db)).toEqual([]);
    expect((await deviceRows(rafiq.db)).map((r) => [r.id, r.signed_in])).toEqual([['dev-rafiq', 0]]);
  });

  it('offline or something left unsent: nothing is erased, no sign-out (the next sync tries again)', async () => {
    const steps = (push: () => Promise<void>, left: number) => {
      const done: string[] = [];
      return {
        done,
        s: {
          push,
          pending: async () => left,
          signOut: async () => void done.push('signOut'),
          wipe: async () => void done.push('wipe'),
        },
      };
    };
    const offline = steps(async () => {
      throw new Error('unavailable');
    }, 3);
    expect(await remoteLogout(offline.s)).toBe(false);
    expect(offline.done).toEqual([]);
    const budget = steps(async () => undefined, 2);
    expect(await remoteLogout(budget.s)).toBe(false);
    expect(budget.done).toEqual([]);
  });
});
