/**
 * Sync engine on real SQLite (node:sqlite) with a fake Firestore: two or three phones of
 * one shop push, pull, listen, go offline, correct and merge.
 */
import { basketFromParse, withCustomer } from '../../domain/basket';
import { countedPoisha, dayStart } from '../../domain/cash';
import { entryFromParse, withEntryCustomer, type EntryDraft } from '../../domain/entry';
import { duplicatePairs } from '../../domain/merge';
import { parseCommand } from '../../parser';
import type { ParseContext } from '../../parser/types';
import {
  addProductAlias,
  cashDay,
  createVoiceLog,
  customerBalances,
  dismissMerge,
  dismissedMerges,
  ensureDevice,
  findProducts,
  knownNames,
  mergeItems,
  mergeRecords,
  repointMerged,
  saveBasket,
  saveDayClose,
  saveEntry,
  saveSetup,
  stockList,
  voidEntry,
  type Writer,
} from '../../db/repo';
import { migratedDb } from '../../db/__tests__/nodeDb';
import { SyncEngine, type RemoteDoc } from '../engine';
import { BATCH_SIZE, DAILY_WRITE_BUDGET, SYNC_TABLES } from '../tables';
import { FakeCloud, type FakeRemote } from './fakeRemote';

const D1 = '2026-11-12';
const at = (date: string, h: number) => dayStart(date) + h * 3_600_000;

type TestDb = Awaited<ReturnType<typeof migratedDb>>;

interface Phone {
  name: string;
  db: TestDb;
  w: Writer & { set(ms: number): void };
  engine: SyncEngine;
  remote: FakeRemote;
}

async function phone(cloud: FakeCloud, name: string, start = at(D1, 8), uid = 'shop-uid'): Promise<Phone> {
  const db = await migratedDb();
  let t = start;
  let n = 0;
  const w = {
    deviceId: `dev-${name}`,
    deviceName: name,
    newId: () => `${name}-${++n}`,
    now: () => (t += 1000),
    set: (ms: number) => {
      t = ms;
    },
  };
  await ensureDevice(db, w, 'owner');
  const engine = new SyncEngine(db, () => t);
  const remote = cloud.client(uid);
  engine.setRemote(remote);
  await engine.useAccount(uid);
  return { name, db, w, engine, remote };
}

async function sync(p: Phone) {
  await p.engine.push();
  await p.engine.pull();
  await repointMerged(p.db, p.w);
  await p.engine.push();
}

async function sell(p: Phone, text: string, opts: { newCustomer?: boolean } = {}) {
  const names = await knownNames(p.db);
  const parsed = parseCommand(text, { tab: 'sale', knownProducts: names.products, knownCustomers: names.customers });
  const products = await findProducts(p.db, (parsed.items ?? []).map((i) => i.product ?? ''));
  let b = basketFromParse(parsed, products, names.customers);
  if (opts.newCustomer && b.customerName) b = withCustomer(b, b.customerName, true);
  const logId = await createVoiceLog(p.db, p.w, { transcript: text, source: 'voice', contextTab: 'sale', audioPath: `file:///${p.name}.wav` });
  return saveBasket(p.db, p.w, b, logId, []);
}

async function enter(p: Phone, text: string, tab: ParseContext['tab'], fix: (d: EntryDraft) => EntryDraft = (d) => d) {
  const names = await knownNames(p.db);
  const parsed = parseCommand(text, { tab, knownCustomers: names.customers, knownProducts: names.products, deviceRole: 'owner', deviceName: p.name });
  const products = await findProducts(p.db, parsed.product ? [parsed.product] : []);
  const d = fix(entryFromParse(parsed, { products, knownCustomers: names.customers, tab })!);
  const logId = await createVoiceLog(p.db, p.w, { transcript: text, source: 'voice', contextTab: tab ?? 'sale' });
  return saveEntry(p.db, p.w, d, logId, []);
}
const asNew = (d: EntryDraft) => withEntryCustomer(d, d.customerName ?? '', true);

const stockOf = async (p: Phone, name: string) => (await stockList(p.db)).find((s) => s.name === name);
const count = (p: Phone, sql: string) => (p.db.raw.prepare(sql).get() as { n: number }).n;

/** Phone A sets the shop up and buys চাল. */
async function shopA(cloud: FakeCloud) {
  const a = await phone(cloud, 'A');
  await saveSetup(a.db, a.w, { shopName: 'রহিম স্টোর', deviceName: 'আব্বু', role: 'owner', openingCashPoisha: 500000 }, D1);
  await enter(a, 'চাল ৫০ কেজি কিনলাম ৫০ টাকা করে', 'purchase');
  return a;
}

describe('push', () => {
  it('first sign-in uploads every local row once, parents first, in batches', async () => {
    const cloud = new FakeCloud();
    const a = await shopA(cloud);
    await sell(a, 'চাল ২ কেজি ১২০ টাকা');
    const pending = await a.engine.pendingCount();
    expect(pending).toBeGreaterThan(5);
    const r = await a.engine.push();
    expect(r).toEqual({ pushed: pending, budgetHit: false });
    expect(cloud.writes).toBe(pending);
    expect(await a.engine.pendingCount()).toBe(0);
    expect(cloud.docs('shop-uid', 'shop')).toEqual([expect.objectContaining({ id: 'shop', name: 'রহিম স্টোর' })]);
    expect(cloud.docs('shop-uid', 'sales')).toHaveLength(1);
    // nothing new → nothing written
    expect(await a.engine.push()).toEqual({ pushed: 0, budgetHit: false });
    expect(cloud.writes).toBe(pending);
    expect((await a.engine.stats()).writesToday).toBe(pending);
  });

  it('never pushes local-only columns (root_id, rev, audio_path)', async () => {
    const cloud = new FakeCloud();
    const a = await shopA(cloud);
    await sell(a, 'চাল ২ কেজি ১২০ টাকা');
    await a.engine.push();
    for (const d of cloud.docs('shop-uid', 'sales')) {
      expect(d).not.toHaveProperty('root_id');
      expect(d).not.toHaveProperty('rev');
    }
    expect(cloud.docs('shop-uid', 'voice_logs').every((d) => !('audio_path' in d))).toBe(true);
  });

  it('pushes a changed mutable row again (updated_at > pushed)', async () => {
    const cloud = new FakeCloud();
    const a = await shopA(cloud);
    await a.engine.push();
    const before = cloud.writes;
    a.db.raw.prepare("UPDATE products SET sell_price_poisha = 6500, updated_at = ? WHERE name = 'চাল'").run(a.w.now());
    expect(await a.engine.pendingCount()).toBe(1);
    await a.engine.push();
    expect(cloud.writes).toBe(before + 1);
  });

  it('splits into batches of BATCH_SIZE', async () => {
    const cloud = new FakeCloud();
    const a = await phone(cloud, 'A');
    const ins = a.db.raw.prepare('INSERT INTO customers (id, name, device_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)');
    for (let i = 0; i < BATCH_SIZE + 10; i++) ins.run(`c${i}`, `ক্রেতা ${i}`, 'dev-A', i, i);
    await a.engine.push();
    expect(cloud.docs('shop-uid', 'customers')).toHaveLength(BATCH_SIZE + 10);
    expect(cloud.batches).toBe(3); // devices + 2 customer batches
  });

  it('stops at the daily write budget and goes on the next day', async () => {
    const cloud = new FakeCloud();
    const a = await phone(cloud, 'A');
    await a.engine.setMeta('count_day', '2026-11-12');
    await a.engine.setMeta('writes_n', DAILY_WRITE_BUDGET);
    expect(await a.engine.push()).toEqual({ pushed: 0, budgetHit: true });
    expect(await a.engine.pendingCount()).toBe(1);
    a.w.set(at('2026-11-13', 8));
    expect(await a.engine.push()).toEqual({ pushed: 1, budgetHit: false });
  });
});

describe('offline queue', () => {
  it('a failed push keeps everything pending; the next push sends it', async () => {
    const cloud = new FakeCloud();
    const a = await shopA(cloud);
    a.remote.offline = true;
    await expect(a.engine.push()).rejects.toThrow(/offline/);
    const pending = await a.engine.pendingCount();
    expect(pending).toBeGreaterThan(0);
    await sell(a, 'চাল ১ কেজি ৬০ টাকা'); // saved offline
    a.remote.offline = false;
    await a.engine.push();
    expect(await a.engine.pendingCount()).toBe(0);
    expect(cloud.docs('shop-uid', 'sales')).toHaveLength(1);
  });

  it('works without sign-in: nothing is lost, it all goes up later', async () => {
    const cloud = new FakeCloud();
    const a = await shopA(cloud);
    a.engine.setRemote(null);
    await expect(a.engine.push()).rejects.toThrow(/not signed in/);
    await sell(a, 'চাল ১ কেজি ৬০ টাকা');
    a.engine.setRemote(cloud.client('shop-uid'));
    await a.engine.push();
    expect(cloud.docs('shop-uid', 'sales')).toHaveLength(1);
  });
});

describe('pull', () => {
  it('a second phone gets everything; stock, balance and cash are recomputed there', async () => {
    const cloud = new FakeCloud();
    const a = await shopA(cloud);
    await sell(a, 'করিম চাল ২ কেজি বাকিতে নিল ১২০ টাকা', { newCustomer: true });
    await a.engine.push();

    const b = await phone(cloud, 'B');
    expect(await b.engine.hasPulled()).toBe(false);
    const applied = await b.engine.pull();
    expect(applied).toBe(cloud.writes);
    expect(await b.engine.hasPulled()).toBe(true);
    expect(await stockOf(b, 'চাল')).toMatchObject({ bought: 50, sold: 2 });
    expect(await customerBalances(b.db)).toEqual([expect.objectContaining({ name: 'করিম', balance_poisha: 12000 })]);
    expect((await cashDay(b.db, D1)).expectedPoisha).toBe((await cashDay(a.db, D1)).expectedPoisha);
    // what B pulled is not pushed back; only B's own device row is new
    expect(await b.engine.pendingCount()).toBe(1);
  });

  it('pulls only what changed since the cursor', async () => {
    const cloud = new FakeCloud();
    const a = await shopA(cloud);
    await a.engine.push();
    const b = await phone(cloud, 'B');
    await b.engine.pull();
    await sell(a, 'চাল ১ কেজি ৬০ টাকা');
    await a.engine.push();
    const reads = cloud.reads;
    await b.engine.pull();
    // the new sale, its voice log; empty tables still cost one read each
    expect(cloud.reads - reads).toBeLessThan(SYNC_TABLES.length + 4);
    expect(await stockOf(b, 'চাল')).toMatchObject({ sold: 1 });
  });

  it('the same document twice = one row (dedupe by UUID)', async () => {
    const cloud = new FakeCloud();
    const a = await shopA(cloud);
    await sell(a, 'চাল ১ কেজি ৬০ টাকা');
    await a.engine.push();
    const b = await phone(cloud, 'B');
    await b.engine.pull();
    const docs: RemoteDoc[] = cloud.fetch('shop-uid', 'sales', 0);
    await b.engine.receive('sales', docs);
    await b.engine.receive('sales', docs);
    expect(count(b, 'SELECT COUNT(*) AS n FROM sales')).toBe(1);
  });

  it("this phone's own unconfirmed writes in a snapshot are skipped", async () => {
    const cloud = new FakeCloud();
    const a = await phone(cloud, 'A');
    expect(await a.engine.receive('customers', [{ id: 'x', data: { id: 'x', name: 'y', device_id: 'd', created_at: 1, updated_at: 1 }, serverAt: null }])).toBe(0);
    expect(count(a, 'SELECT COUNT(*) AS n FROM sync_inbox')).toBe(0);
  });

  it('a sale that arrives before its product waits in the inbox, then goes in', async () => {
    const cloud = new FakeCloud();
    const a = await shopA(cloud);
    await sell(a, 'চাল ২ কেজি ১২০ টাকা');
    await a.engine.push();
    const b = await phone(cloud, 'B');
    // realtime listeners fire in any order: sales and voice logs first
    await b.engine.receive('sales', cloud.fetch('shop-uid', 'sales', 0));
    expect(count(b, 'SELECT COUNT(*) AS n FROM sales')).toBe(0);
    expect((await b.engine.stats()).waiting).toBe(1);
    await b.engine.receive('voice_logs', cloud.fetch('shop-uid', 'voice_logs', 0));
    await b.engine.receive('products', cloud.fetch('shop-uid', 'products', 0));
    expect(count(b, 'SELECT COUNT(*) AS n FROM sales')).toBe(1);
    expect((await b.engine.stats()).waiting).toBe(0);
  });

  it('a correction that arrives before the entry it corrects waits for it', async () => {
    const cloud = new FakeCloud();
    const a = await shopA(cloud);
    const e = await enter(a, 'বিদ্যুৎ বিল ৩০০ টাকা খরচ', 'expense');
    await voidEntry(a.db, a.w, 'expenses', e);
    await a.engine.push();
    const b = await phone(cloud, 'B');
    const docs = cloud.fetch('shop-uid', 'expenses', 0).reverse();
    await b.engine.receive('voice_logs', cloud.fetch('shop-uid', 'voice_logs', 0));
    await b.engine.receive('expenses', docs.slice(0, 1));
    await b.engine.receive('expenses', docs.slice(1));
    expect(count(b, 'SELECT COUNT(*) AS n FROM expenses')).toBe(2);
    expect(count(b, 'SELECT COUNT(*) AS n FROM v_expenses')).toBe(0);
    expect(b.db.raw.prepare('SELECT DISTINCT root_id FROM expenses').all()).toEqual([{ root_id: e }]);
  });

  it('keeps the local audio file path; another phone gets none', async () => {
    const cloud = new FakeCloud();
    const a = await shopA(cloud);
    await sell(a, 'চাল ১ কেজি ৬০ টাকা');
    await a.engine.push();
    await a.engine.pull(); // its own rows come back
    expect(count(a, "SELECT COUNT(*) AS n FROM voice_logs WHERE audio_path = 'file:///A.wav'")).toBe(1);
    const b = await phone(cloud, 'B');
    await b.engine.pull();
    expect(count(b, 'SELECT COUNT(*) AS n FROM voice_logs WHERE audio_path IS NOT NULL')).toBe(0);
  });

  it('realtime: a listener delivers the other phone’s sale', async () => {
    const cloud = new FakeCloud();
    const a = await shopA(cloud);
    await a.engine.push();
    const b = await phone(cloud, 'B');
    await b.engine.pull();
    const work: Promise<unknown>[] = [];
    const offs = SYNC_TABLES.map((t) => b.remote.listen(t.name, 0, (docs) => work.push(b.engine.receive(t.name, docs))));
    await Promise.all(work.splice(0));
    await sell(a, 'চাল ৩ কেজি ১৮০ টাকা');
    await a.engine.push();
    await Promise.all(work.splice(0));
    expect(await stockOf(b, 'চাল')).toMatchObject({ sold: 3 });
    offs.forEach((off) => off());
  });
});

describe('conflicts', () => {
  it('entries from two offline phones: both kept (union), stock = purchases − both sales', async () => {
    const cloud = new FakeCloud();
    const a = await shopA(cloud);
    await a.engine.push();
    const b = await phone(cloud, 'B');
    await b.engine.pull();
    await sell(a, 'চাল ২ কেজি ১২০ টাকা');
    await sell(b, 'চাল ৫ কেজি ৩০০ টাকা');
    await sync(a);
    await sync(b);
    await sync(a);
    for (const p of [a, b]) expect(await stockOf(p, 'চাল')).toMatchObject({ bought: 50, sold: 7 });
  });

  it('mutable rows: last write wins on updated_at, on both phones', async () => {
    const cloud = new FakeCloud();
    const a = await shopA(cloud);
    await a.engine.push();
    const b = await phone(cloud, 'B');
    await b.engine.pull();
    const price = (p: Phone, v: number, t: number) =>
      p.db.raw.prepare("UPDATE products SET sell_price_poisha = ?, updated_at = ? WHERE name = 'চাল'").run(v, t);
    price(b, 6200, at(D1, 10)); // earlier
    price(a, 6500, at(D1, 11)); // later
    await sync(a);
    await sync(b); // B's older price overwrites the cloud copy…
    await sync(a); // …A sees it lose against its own and sends its own again
    await sync(b);
    for (const p of [a, b]) expect((await stockOf(p, 'চাল'))?.sellPricePoisha).toBe(6500);
    // B's losing version was pushed but A's won on the server too
    expect(cloud.docs('shop-uid', 'products')[0]).toMatchObject({ sell_price_poisha: 6500 });
  });

  it('the shop name: last write wins', async () => {
    const cloud = new FakeCloud();
    const a = await shopA(cloud);
    await a.engine.push();
    const b = await phone(cloud, 'B', at(D1, 12));
    await b.engine.pull();
    await saveSetup(b.db, b.w, { shopName: 'রহিম জেনারেল স্টোর', deviceName: 'রফিক', role: 'staff', openingCashPoisha: 500000 }, D1);
    await sync(b);
    await sync(a);
    expect(a.db.raw.prepare('SELECT name FROM shop').get()).toEqual({ name: 'রহিম জেনারেল স্টোর' });
    // same opening cash → no second opening entry
    expect(count(a, "SELECT COUNT(*) AS n FROM day_close WHERE kind = 'opening'")).toBe(1);
    // both phones know both devices (মালিক names for the parser)
    expect(count(a, 'SELECT COUNT(*) AS n FROM devices')).toBe(2);
  });

  it('two phones correct the same entry offline: both in history, the later one counts', async () => {
    const cloud = new FakeCloud();
    const a = await shopA(cloud);
    const e = await enter(a, 'বিদ্যুৎ বিল ৩০০ টাকা খরচ', 'expense');
    await a.engine.push();
    const b = await phone(cloud, 'B', at(D1, 9));
    await b.engine.pull();
    a.w.set(at(D1, 12));
    await voidEntry(a.db, a.w, 'expenses', e); // later: cancel
    b.w.set(at(D1, 10));
    b.db.raw
      .prepare(
        `INSERT INTO expenses (id, item, amount_poisha, corrects_id, entry_at, device_name, device_id, created_at, updated_at)
         SELECT 'B-fix', item, 25000, id, created_at, 'B', 'dev-B', ?, ? FROM expenses WHERE id = ?`,
      )
      .run(at(D1, 10), at(D1, 10), e);
    await sync(a);
    await sync(b);
    await sync(a);
    for (const p of [a, b]) {
      expect(count(p, 'SELECT COUNT(*) AS n FROM expenses')).toBe(3);
      expect(count(p, 'SELECT COUNT(*) AS n FROM v_expenses')).toBe(0); // A's cancel is later
    }
  });

  it('day close on two phones: both kept, the latest shown, flagged; a recount clears it', async () => {
    const cloud = new FakeCloud();
    const a = await shopA(cloud);
    await a.engine.push();
    const b = await phone(cloud, 'B');
    await b.engine.pull();
    a.w.set(at(D1, 21));
    await saveDayClose(a.db, a.w, await cashDay(a.db, D1), { 1000: 2, 500: 1 }, countedPoisha({ 1000: 2, 500: 1 }));
    b.w.set(at(D1, 22));
    await saveDayClose(b.db, b.w, await cashDay(b.db, D1), { 1000: 2 }, 200000);
    await sync(a);
    await sync(b);
    await sync(a);
    for (const p of [a, b]) {
      const d = await cashDay(p.db, D1);
      expect(d.closedOnTwoPhones).toBe(true);
      expect(d.close?.counted_cash_poisha).toBe(200000);
      expect((await cashDay(p.db, '2026-11-13')).openingPoisha).toBe(200000);
    }
    a.w.set(at(D1, 23));
    await saveDayClose(a.db, a.w, await cashDay(a.db, D1), { 1000: 2, 200: 1 }, 220000);
    await sync(a);
    await sync(b);
    for (const p of [a, b]) {
      const d = await cashDay(p.db, D1);
      expect(d).toMatchObject({ closedOnTwoPhones: false, close: expect.objectContaining({ counted_cash_poisha: 220000 }) });
    }
  });
});

describe('first sync merge (এই দুইটা কি একই?)', () => {
  /** Both phones were used alone before sign-in: চাল and করিম exist twice. */
  async function twoShops() {
    const cloud = new FakeCloud();
    const a = await shopA(cloud);
    await sell(a, 'করিম চাল ২ কেজি বাকিতে নিল ১২০ টাকা', { newCustomer: true });
    const b = await phone(cloud, 'B', at(D1, 9));
    await enter(b, 'চাল ১০ কেজি কিনলাম ৫২ টাকা করে', 'purchase');
    await enter(b, 'করিম ৫০ টাকা বাকি', 'ledger', asNew);
    await sync(a);
    await sync(b);
    await sync(a);
    return { cloud, a, b };
  }

  it('merges by UUID first: nothing lost, duplicates found by sound', async () => {
    const { a, b } = await twoShops();
    for (const p of [a, b]) {
      expect(count(p, "SELECT COUNT(*) AS n FROM products WHERE name = 'চাল'")).toBe(2);
      const items = await mergeItems(p.db);
      const pairs = [...duplicatePairs('product', items.products), ...duplicatePairs('customer', items.customers)];
      expect(pairs.map((x) => [x.kind, x.keep.name, x.dup.name])).toEqual([
        ['product', 'চাল', 'চাল'],
        ['customer', 'করিম', 'করিম'],
      ]);
    }
  });

  it('"হ্যাঁ": entries re-pointed by corrections, nothing deleted, other phone follows', async () => {
    const { a, b } = await twoShops();
    const { products, customers } = await mergeItems(a.db);
    const [pp] = duplicatePairs('product', products);
    const [cp] = duplicatePairs('customer', customers);
    const entriesBefore = count(a, 'SELECT (SELECT COUNT(*) FROM sales) + (SELECT COUNT(*) FROM purchases) + (SELECT COUNT(*) FROM ledger) AS n');
    expect(await mergeRecords(a.db, a.w, 'product', pp!.keep.id, pp!.dup.id)).toBe(1);
    expect(await mergeRecords(a.db, a.w, 'customer', cp!.keep.id, cp!.dup.id)).toBe(1);
    expect(count(a, 'SELECT (SELECT COUNT(*) FROM sales) + (SELECT COUNT(*) FROM purchases) + (SELECT COUNT(*) FROM ledger) AS n')).toBe(entriesBefore + 2);
    await sync(a);
    await sync(b);
    for (const p of [a, b]) {
      expect((await stockList(p.db)).map((s) => [s.name, s.bought, s.sold])).toEqual([['চাল', 60, 2]]);
      expect(await customerBalances(p.db)).toEqual([expect.objectContaining({ name: 'করিম', balance_poisha: 17000 })]);
      expect(count(p, "SELECT COUNT(*) AS n FROM products WHERE merged_into IS NOT NULL AND archived = 1")).toBe(1);
      expect(duplicatePairs('product', (await mergeItems(p.db)).products)).toEqual([]);
    }
  });

  it('an offline phone that still uses the old one: re-pointed after it syncs', async () => {
    const { a, b } = await twoShops();
    const [pp] = duplicatePairs('product', (await mergeItems(a.db)).products);
    await mergeRecords(a.db, a.w, 'product', pp!.keep.id, pp!.dup.id);
    // B, offline, sells the duplicate চাল
    b.w.set(at(D1, 15));
    b.db.raw
      .prepare(
        `INSERT INTO sales (id, product_id, quantity, sell_price_poisha, amount_poisha, cost_price_poisha, device_name, device_id, created_at, updated_at)
         VALUES ('B-late', ?, 1, 6000, 6000, 5200, 'B', 'dev-B', ?, ?)`,
      )
      .run(pp!.dup.id, at(D1, 15), at(D1, 15));
    await sync(a);
    await sync(b);
    await sync(a);
    for (const p of [a, b]) expect((await stockList(p.db)).map((s) => [s.name, s.sold])).toEqual([['চাল', 3]]);
    // B re-pointed it (A may too, later: a fork of the same content, counted once)
    expect(count(b, `SELECT COUNT(*) AS n FROM v_sales WHERE product_id = '${pp!.dup.id}'`)).toBe(0);
  });

  it('the duplicate’s name becomes an alias of the one kept', async () => {
    const cloud = new FakeCloud();
    const a = await phone(cloud, 'A');
    await enter(a, 'চাল ৫০ কেজি কিনলাম ৫০ টাকা করে', 'purchase');
    await enter(a, 'চাউল ১০ কেজি কিনলাম ৫০ টাকা করে', 'purchase');
    await addProductAlias(a.db, a.w, 'চাউল্লা', (await findProducts(a.db, ['চাউল'])).get('চাউল')!.id);
    const ids = (await mergeItems(a.db)).products;
    const keep = ids.find((p) => p.name === 'চাল')!;
    const dup = ids.find((p) => p.name === 'চাউল')!;
    await mergeRecords(a.db, a.w, 'product', keep.id, dup.id);
    expect((await findProducts(a.db, ['চাউল', 'চাউল্লা'])).get('চাউল')?.name).toBe('চাল');
    expect((await findProducts(a.db, ['চাউল্লা'])).get('চাউল্লা')?.name).toBe('চাল');
  });

  it('"না" is remembered', async () => {
    const { a } = await twoShops();
    const [pp] = duplicatePairs('product', (await mergeItems(a.db)).products);
    await dismissMerge(a.db, pp!.key);
    expect(duplicatePairs('product', (await mergeItems(a.db)).products, await dismissedMerges(a.db))).toEqual([]);
  });
});

describe('account', () => {
  it('another account = another shop: everything goes up again, cursors reset', async () => {
    const cloud = new FakeCloud();
    const a = await shopA(cloud);
    await sync(a);
    expect(await a.engine.pendingCount()).toBe(0);
    expect(await a.engine.useAccount('shop-uid')).toBe(false);
    expect(await a.engine.useAccount('other-uid')).toBe(true);
    expect(await a.engine.hasPulled()).toBe(false);
    a.engine.setRemote(cloud.client('other-uid'));
    const pending = await a.engine.pendingCount();
    expect(pending).toBeGreaterThan(0);
    await a.engine.push();
    expect(cloud.docs('other-uid', 'products')).toHaveLength(1);
  });
});
