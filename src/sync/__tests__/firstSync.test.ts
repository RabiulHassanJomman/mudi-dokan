/**
 * A phone joins a shop that is already in the cloud: the cloud's shop name and opening cash
 * stay; a Setup done offline before sign-in is replaced (corrections, nothing deleted).
 */
import { dayStart } from '../../domain/cash';
import { adoptCloudShop, cashDay, ensureDevice, getSetup, saveDeviceSetup, saveSetup, type Writer } from '../../db/repo';
import { migratedDb } from '../../db/__tests__/nodeDb';
import { SyncController } from '../controller';
import { SyncEngine } from '../engine';
import { FakeCloud } from './fakeRemote';

const D1 = '2026-11-12';
const D2 = '2026-11-14';
const at = (date: string, h: number) => dayStart(date) + h * 3_600_000;

async function phone(cloud: FakeCloud, name: string, start: number) {
  const db = await migratedDb();
  let t = start;
  let n = 0;
  const w: Writer & { set(ms: number): void } = {
    deviceId: `dev-${name}`,
    deviceName: name,
    newId: () => `${name}-${++n}`,
    now: () => (t += 1000),
    set: (ms) => {
      t = ms;
    },
  };
  await ensureDevice(db, w, 'owner');
  const engine = new SyncEngine(db, () => t);
  const notices: boolean[] = [];
  const ctl = new SyncController(engine, {
    adoptShop: (doc) => adoptCloudShop(db, w, doc),
    onFirstSync: (r) => notices.push(r.adopted),
  });
  const signIn = () => ctl.setAccount({ uid: 'uid', email: 'shop@example.com', remote: cloud.client('uid') });
  return { db, w, engine, ctl, signIn, notices };
}

/** The shop phone (A) set up on D1 with ৳5,000 and already syncing. */
async function shopInCloud(cloud: FakeCloud) {
  const a = await phone(cloud, 'A', at(D1, 8));
  await saveSetup(a.db, a.w, { shopName: 'রহিম স্টোর', deviceName: 'আব্বু', role: 'owner', openingCashPoisha: 500000 }, D1);
  await a.signIn();
  await a.ctl.syncNow();
  return a;
}

describe('joining a shop that is in the cloud', () => {
  it('sign-in first (the normal way): cloud shop and cash, nothing to replace, no notice', async () => {
    const cloud = new FakeCloud();
    const a = await shopInCloud(cloud);
    const b = await phone(cloud, 'B', at(D2, 9)); // clock later than A's: plain LWW would let B win
    await b.signIn();
    await b.ctl.syncNow();
    expect(b.ctl.current.stats?.cloudShop).toBe(true);
    expect(b.notices).toEqual([false]);
    // Setup then asks only for B's name and role
    await saveDeviceSetup(b.db, b.w, 'রফিক', 'staff');
    await b.ctl.syncNow();
    await a.ctl.syncNow();
    for (const p of [a, b]) {
      expect(await getSetup(p.db, 'dev-B')).toMatchObject({ shopName: 'রহিম স্টোর', deviceName: 'রফিক', role: 'staff', openingCashPoisha: 500000 });
      expect((await cashDay(p.db, D2)).openingPoisha).toBe(500000);
    }
    expect(cloud.docs('uid', 'shop')).toEqual([expect.objectContaining({ name: 'রহিম স্টোর', device_id: 'dev-A' })]);
    a.ctl.dispose();
    b.ctl.dispose();
  });

  it('Setup done offline before sign-in: cloud name and cash win, local opening corrected away, notice shown', async () => {
    const cloud = new FakeCloud();
    const a = await shopInCloud(cloud);
    const b = await phone(cloud, 'B', at(D2, 9));
    await saveSetup(b.db, b.w, { shopName: 'Emu Dokan', deviceName: 'Emu', role: 'staff', openingCashPoisha: 100000 }, D2);
    await b.signIn();
    await b.ctl.syncNow();
    await a.ctl.syncNow();
    expect(b.notices).toEqual([true]);
    expect(b.ctl.current.notice).toBe('shop_adopted');
    for (const p of [a, b]) {
      expect(p.db.raw.prepare('SELECT name FROM shop').get()).toEqual({ name: 'রহিম স্টোর' });
      // A's opening carries into D2; B's ৳1,000 is in history but voided
      expect(await cashDay(p.db, D2)).toMatchObject({ openingPoisha: 500000, source: 'carry' });
      expect(p.db.raw.prepare("SELECT COUNT(*) AS n FROM day_close WHERE kind = 'opening' AND device_id = 'dev-B'").get()).toEqual({ n: 2 });
      expect(p.db.raw.prepare("SELECT COUNT(*) AS n FROM v_day_close WHERE kind = 'opening'").get()).toEqual({ n: 1 });
    }
    expect(cloud.docs('uid', 'shop')).toEqual([expect.objectContaining({ name: 'রহিম স্টোর' })]);
    a.ctl.dispose();
    b.ctl.dispose();
  });

  it('the first phone of a shop (empty cloud) keeps its own shop', async () => {
    const cloud = new FakeCloud();
    const a = await shopInCloud(cloud);
    expect(a.notices).toEqual([false]);
    expect(a.ctl.current.stats?.cloudShop).toBe(false);
    expect(cloud.docs('uid', 'shop')).toEqual([expect.objectContaining({ name: 'রহিম স্টোর' })]);
    expect(a.db.raw.prepare("SELECT COUNT(*) AS n FROM v_day_close WHERE kind = 'opening'").get()).toEqual({ n: 1 });
    a.ctl.dispose();
  });
});

describe('adoptCloudShop', () => {
  it('same name and no local opening: nothing changes, returns false', async () => {
    const cloud = new FakeCloud();
    const b = await phone(cloud, 'B', at(D2, 9));
    expect(await adoptCloudShop(b.db, b.w, { id: 'shop', name: 'রহিম স্টোর', device_id: 'dev-A', created_at: 1, updated_at: 2 })).toBe(false);
    expect(b.db.raw.prepare('SELECT name, updated_at FROM shop').get()).toEqual({ name: 'রহিম স্টোর', updated_at: 2 });
  });
});
