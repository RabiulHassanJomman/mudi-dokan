/**
 * "সব তথ্য মুছুন" on real SQLite with a fake Firestore: this phone, all phones + the cloud, and
 * the other phones that must ask instead of sending their data up again.
 */
import { addProductAlias, ensureDevice, findProducts, saveSetup, wipeAllData } from '../../db/repo';
import { DAY0, asNewCustomer, enter, phoneOf, sell, syncPhone, type Phone } from '../../db/__tests__/shopHelpers';
import { SYNC_TABLES } from '../../sync/tables';
import { SyncController } from '../../sync/controller';
import { FakeCloud } from '../../sync/__tests__/fakeRemote';
import { enqueueUnderstanding } from '../../queue/understand';
import { enqueueClip } from '../../drive/queue';

const SHOP_DAY = '2026-11-12';
const NOW = DAY0 + 10_000_000;

const rows = async (p: Phone, table: string) => (await p.db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`))!.n;
const cloudCount = (cloud: FakeCloud) => SYNC_TABLES.reduce((n, t) => n + cloud.docs('shop-uid', t.name).length, 0);

async function fillShop(p: Phone) {
  await saveSetup(p.db, p.w, { shopName: 'রহিম স্টোর', deviceName: 'আব্বু', role: 'owner', openingCashPoisha: 500000 }, SHOP_DAY);
  await enter(p.db, p.w, 'চাল ৫০ কেজি কিনলাম ৫০ টাকা করে', 'purchase');
  await sell(p.db, p.w, 'করিম চাল ২ কেজি বাকিতে নিল ১২০ টাকা', true);
  await enter(p.db, p.w, 'রহিম ২০০ টাকা বাকি', 'ledger', asNewCustomer);
  await addProductAlias(p.db, p.w, 'চাউল', (await findProducts(p.db, ['চাল'])).get('চাল')!.id);
}

/** A controller for a phone, with its local wipe hook like the app's. */
function controllerOf(p: Phone, cloud: FakeCloud, wiped: string[] = []) {
  const ctl = new SyncController(p.engine, {
    wipeLocal: async () => {
      wiped.push(...(await p.engine.wipeLocal(`dev-${p.name}`)));
    },
  });
  return { ctl, join: () => ctl.setAccount({ uid: 'shop-uid', email: 'shop@x', remote: cloud.client('shop-uid') }) };
}

describe('wipe this phone only (wipeAllData)', () => {
  it('everything goes except this phone; queues and sync bookkeeping are cleared; the guards are back', async () => {
    const cloud = new FakeCloud();
    const a = await phoneOf('A', cloud);
    await fillShop(a);
    await syncPhone(a);
    await ensureDevice(a.db, { ...a.w, deviceId: 'dev-other', deviceName: 'কর্মচারী' }, 'staff');
    const log = (await a.db.getFirstAsync<{ id: string }>('SELECT id FROM voice_logs LIMIT 1'))!.id;
    await enqueueUnderstanding(a.db, log, 'sale', DAY0);
    await enqueueClip(a.db, log, DAY0);
    await a.engine.setMeta('drive:folder:Mudi Dokan', 'folder-1');

    const files = await a.engine.wipeLocal('dev-A');
    expect(files).toEqual(['file:///doc/v.wav']);
    for (const t of SYNC_TABLES.map((t) => t.name).filter((n) => n !== 'devices')) expect({ t, n: await rows(a, t) }).toEqual({ t, n: 0 });
    expect(await a.db.getAllAsync('SELECT id FROM devices')).toEqual([{ id: 'dev-A' }]);
    for (const t of ['sync_state', 'sync_inbox', 'audio_queue', 'understand_queue']) expect({ t, n: await rows(a, t) }).toEqual({ t, n: 0 });
    // the account stays (so signing in again is the same shop), the rest of the cloud memory goes
    expect(await a.db.getAllAsync('SELECT key FROM sync_meta')).toEqual([{ key: 'uid' }]);
    expect((await a.db.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))!.user_version).toBeGreaterThan(12);

    await enter(a.db, a.w, 'চিনি ২ কেজি কিনলাম ১২০ টাকা করে', 'purchase');
    await expect(a.db.runAsync('DELETE FROM purchases')).rejects.toThrow(/append-only/);
    await expect(a.db.runAsync('UPDATE purchases SET quantity = 9')).rejects.toThrow(/append-only/);
    // the cloud still has everything: this wipe didn't touch it
    expect(cloudCount(cloud)).toBeGreaterThan(5);
  });

  it('a signed-out wipe leaves no cursors: signing in again is a first sync', async () => {
    const cloud = new FakeCloud();
    const a = await phoneOf('A', cloud);
    await fillShop(a);
    await syncPhone(a);
    expect(await a.engine.hasPulled()).toBe(true);
    await wipeAllData(a.db, 'dev-A', ['uid']);
    expect(await a.engine.hasPulled()).toBe(false);
  });
});

describe('wipe everywhere (Google + all phones)', () => {
  it('erases every document, leaves a tombstone, and this phone does not ask itself', async () => {
    const cloud = new FakeCloud();
    const a = await phoneOf('A', cloud, 'shop-uid', DAY0, () => NOW);
    await fillShop(a);
    await syncPhone(a);
    expect(cloudCount(cloud)).toBeGreaterThan(10);

    const calls: string[] = [];
    const { at, files } = await a.engine.wipeEverywhere('A', 'dev-A', async () => {
      calls.push(`cloud ${cloudCount(cloud)} sales ${await rows(a, 'sales')}`); // Drive step: cloud clean, phone not yet
    });
    expect(at).toBe(NOW);
    expect(calls).toEqual(['cloud 0 sales 1']);
    expect(files).toEqual(['file:///doc/v.wav']);
    expect(cloudCount(cloud)).toBe(0);
    expect(cloud.tombstones.get('shop-uid')).toEqual({ wiped_at: NOW, by: 'A' });
    expect(await rows(a, 'sales')).toBe(0);
    expect(await a.engine.getMeta('wipe_seen')).toBe(String(NOW));

    const { ctl, join } = controllerOf(a, cloud);
    await join();
    await ctl.syncNow();
    expect(ctl.current.phase).toBe('idle'); // not asked, not paused
    expect(await a.engine.wipePending()).toBeNull();
    ctl.dispose();
  });

  it('a Drive failure does not stop the wipe (the data is the point)', async () => {
    const cloud = new FakeCloud();
    const a = await phoneOf('A', cloud, 'shop-uid', DAY0, () => NOW);
    await fillShop(a);
    await syncPhone(a);
    await a.engine.wipeEverywhere('A', 'dev-A', async () => {
      throw new Error('Drive 403');
    });
    expect(cloudCount(cloud)).toBe(0);
    expect(await rows(a, 'sales')).toBe(0);
  });

  it('without internet nothing is erased, here or there', async () => {
    const cloud = new FakeCloud();
    const a = await phoneOf('A', cloud, 'shop-uid', DAY0, () => NOW);
    await fillShop(a);
    await syncPhone(a);
    const before = cloudCount(cloud);
    (a.engine as unknown as { remote: { offline: boolean } }).remote.offline = true;
    await expect(a.engine.wipeEverywhere('A', 'dev-A')).rejects.toThrow(/offline/);
    expect(cloud.tombstones.has('shop-uid')).toBe(false);
    expect(cloudCount(cloud)).toBe(before);
    expect(await rows(a, 'sales')).toBe(1);
  });
});

describe('other phones after a wipe: ask, never re-upload', () => {
  /** A and B share the shop, B then works offline; A wipes everywhere. */
  async function scene() {
    const cloud = new FakeCloud();
    const clock = { now: DAY0 };
    const a = await phoneOf('A', cloud, 'shop-uid', DAY0, () => clock.now);
    const b = await phoneOf('B', cloud, 'shop-uid', DAY0 + 500, () => clock.now);
    await fillShop(a);
    await syncPhone(a);
    await syncPhone(b);
    // B sells while offline
    await sell(b.db, b.w, 'চাল ১ কেজি ৬০ টাকা');
    await enter(b.db, b.w, 'বিদ্যুৎ বিল ৫০০ টাকা', 'expense');
    clock.now = NOW;
    const { at } = await a.engine.wipeEverywhere('A', 'dev-A');
    return { cloud, a, b, at };
  }

  it('B comes online: paused, asks, and sends NOTHING of its own', async () => {
    const { cloud, b, at } = await scene();
    const writes = cloud.writes;
    const { ctl, join } = controllerOf(b, cloud);
    await join();
    await ctl.syncNow();
    expect(ctl.current).toMatchObject({ phase: 'wiped', wipePending: at });
    expect(await b.engine.pendingCount()).toBeGreaterThan(0); // still waiting, not sent
    expect(cloud.writes).toBe(writes);
    expect(cloudCount(cloud)).toBe(0);
    // another save, another sync: still nothing goes up, nothing is fetched
    await sell(b.db, b.w, 'চাল ১ কেজি ৬০ টাকা');
    ctl.localChange();
    await ctl.syncNow();
    expect(cloud.writes).toBe(writes);
    expect(await rows(b, 'sales')).toBe(3);
    ctl.dispose();
  });

  it('না keeps the data, stays paused even after the app restarts; "আবার পাঠান" is the only way it goes up', async () => {
    const { cloud, b } = await scene();
    const first = controllerOf(b, cloud);
    await first.join();
    await first.ctl.syncNow();
    first.ctl.keepAfterWipe();
    first.ctl.dispose();
    // restart: a new controller on the same database
    const second = controllerOf(b, cloud);
    await second.join();
    await second.ctl.syncNow();
    expect(second.ctl.current.phase).toBe('wiped');
    expect(cloudCount(cloud)).toBe(0);
    // the user chooses to send this phone's data again
    await second.ctl.resumeUpload();
    await second.ctl.syncNow();
    expect(second.ctl.current).toMatchObject({ phase: 'idle', wipePending: null });
    expect(cloud.docs('shop-uid', 'sales').length).toBe(2);
    expect(cloud.docs('shop-uid', 'expenses').length).toBe(1);
    second.ctl.dispose();
  });

  it('হ্যাঁ erases B (files returned for deletion), then B is a clean phone of the same shop and works', async () => {
    const { cloud, b, at } = await scene();
    const wiped: string[] = [];
    const { ctl, join } = controllerOf(b, cloud, wiped);
    await join();
    await ctl.syncNow();
    await ctl.acceptWipe();
    expect(wiped.length).toBeGreaterThan(0);
    expect(await rows(b, 'sales')).toBe(0);
    expect(await rows(b, 'customers')).toBe(0);
    expect(await b.db.getAllAsync('SELECT id FROM devices')).toEqual([{ id: 'dev-B' }]);
    expect(await b.engine.wipePending()).toBeNull();
    expect(await b.engine.getMeta('wipe_seen')).toBe(String(at));
    expect(cloudCount(cloud)).toBe(0); // nothing came back up
    expect(ctl.current.phase).toBe('idle');

    // new work after the wipe goes up normally and is not mistaken for old data
    await enter(b.db, b.w, 'চিনি ২ কেজি কিনলাম ১২০ টাকা করে', 'purchase');
    await ctl.syncNow();
    expect(cloud.docs('shop-uid', 'purchases')).toHaveLength(1);
    expect(ctl.current.phase).toBe('idle');
    ctl.dispose();
  });

  it('a phone that is online while it happens hears it at once (realtime), without saving anything', async () => {
    const cloud = new FakeCloud();
    const clock = { now: DAY0 };
    const a = await phoneOf('A', cloud, 'shop-uid', DAY0, () => clock.now);
    const b = await phoneOf('B', cloud, 'shop-uid', DAY0 + 500, () => clock.now);
    await fillShop(a);
    await syncPhone(a);
    const { ctl, join } = controllerOf(b, cloud);
    await join();
    await ctl.syncNow();
    expect(ctl.current.phase).toBe('idle');
    expect(await rows(b, 'sales')).toBe(1);

    clock.now = NOW;
    await a.engine.wipeEverywhere('A', 'dev-A');
    await new Promise((r) => setTimeout(r, 20));
    await ctl.syncNow();
    expect(ctl.current.phase).toBe('wiped');
    expect(await rows(b, 'sales')).toBe(1);
    ctl.dispose();
  });

  it('a new phone with nothing, or whose data all came after the wipe, is not asked', async () => {
    const { cloud, a, at } = await scene();
    // C: brand new, signs in
    const c = await phoneOf('C', cloud, 'shop-uid', NOW + 1000, () => NOW + 2000);
    const cc = controllerOf(c, cloud);
    await cc.join();
    await cc.ctl.syncNow();
    expect(cc.ctl.current.phase).toBe('idle');
    expect(await c.engine.getMeta('wipe_seen')).toBe(String(at));
    // D: started over after the wipe (own data newer than wiped_at)
    const d = await phoneOf('D', cloud, 'shop-uid', NOW + 5000, () => NOW + 9000);
    await enter(d.db, d.w, 'চাল ১০ কেজি কিনলাম ৫০ টাকা করে', 'purchase');
    const dc = controllerOf(d, cloud);
    await dc.join();
    await dc.ctl.syncNow();
    expect(dc.ctl.current.phase).toBe('idle');
    expect(cloud.docs('shop-uid', 'purchases')).toHaveLength(1);
    cc.ctl.dispose();
    dc.ctl.dispose();
    expect(a).toBeTruthy();
  });

  it('the shop starts over on A; B (old data) says হ্যাঁ and then receives only the new shop', async () => {
    const { cloud, a, b } = await scene();
    const clock = NOW + 3_600_000;
    a.w.set(clock);
    await saveSetup(a.db, a.w, { shopName: 'নতুন স্টোর', deviceName: 'আব্বু', role: 'owner', openingCashPoisha: 100000 }, SHOP_DAY);
    await enter(a.db, a.w, 'ডাল ১০ কেজি কিনলাম ৯০ টাকা করে', 'purchase');
    const ac = controllerOf(a, cloud);
    await ac.join();
    await ac.ctl.syncNow();
    expect(ac.ctl.current.phase).toBe('idle');
    expect(cloud.docs('shop-uid', 'shop')).toEqual([expect.objectContaining({ name: 'নতুন স্টোর' })]);

    const bc = controllerOf(b, cloud);
    await bc.join();
    await bc.ctl.syncNow();
    expect(bc.ctl.current.phase).toBe('wiped');
    await bc.ctl.acceptWipe();
    await bc.ctl.syncNow();
    expect(await b.db.getAllAsync('SELECT name FROM shop')).toEqual([{ name: 'নতুন স্টোর' }]);
    expect((await b.db.getAllAsync<{ name: string }>('SELECT name FROM products')).map((p) => p.name)).toEqual(['ডাল']);
    expect(await rows(b, 'sales')).toBe(0); // the old shop's sales never came back
    ac.ctl.dispose();
    bc.ctl.dispose();
  });
});
