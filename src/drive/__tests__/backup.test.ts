/**
 * Backup → restore round trip on real SQLite (node:sqlite): a shop phone with every kind of
 * row (corrections, voided entries, aliases, a credit sale), exported to JSON, restored into
 * an empty phone and into one that already has part of it; then sync sends only what the
 * cloud is missing.
 */
import { basketFromParse, withCustomer } from '../../domain/basket';
import { dayStart } from '../../domain/cash';
import { entryFromParse, withEntryCustomer, type EntryDraft } from '../../domain/entry';
import { parseCommand } from '../../parser';
import type { ParseContext } from '../../parser/types';
import {
  addProductAlias,
  createVoiceLog,
  customerBalances,
  ensureDevice,
  findProducts,
  knownNames,
  saveBasket,
  saveEntry,
  saveSetup,
  stockList,
  voidEntry,
  type Writer,
} from '../../db/repo';
import { SCHEMA_VERSION } from '../../db/migrations';
import { migratedDb } from '../../db/__tests__/nodeDb';
import { SyncEngine } from '../../sync/engine';
import { SyncController } from '../../sync/controller';
import { SYNC_TABLES } from '../../sync/tables';
import { FakeCloud } from '../../sync/__tests__/fakeRemote';
import { BACKUP_FORMAT, backupName, backupsToDelete, exportBackup, nightlyDue, parseBackup, restoreBackup } from '../backup';

const D1 = '2026-11-12';
const at = (date: string, h: number) => dayStart(date) + h * 3_600_000;
type TestDb = Awaited<ReturnType<typeof migratedDb>>;

function writer(name: string, start = at(D1, 8)): Writer & { set(ms: number): void } {
  let t = start;
  let n = 0;
  return {
    deviceId: `dev-${name}`,
    deviceName: name,
    newId: () => `${name}-${++n}`,
    now: () => (t += 1000),
    set: (ms: number) => {
      t = ms;
    },
  };
}

async function sell(db: TestDb, w: Writer, text: string, newCustomer = false) {
  const names = await knownNames(db);
  const parsed = parseCommand(text, { tab: 'sale', knownProducts: names.products, knownCustomers: names.customers });
  const products = await findProducts(db, (parsed.items ?? []).map((i) => i.product ?? ''));
  let b = basketFromParse(parsed, products, names.customers);
  if (newCustomer && b.customerName) b = withCustomer(b, b.customerName, true);
  const logId = await createVoiceLog(db, w, { transcript: text, source: 'voice', contextTab: 'sale', audioPath: 'file:///doc/v.wav' });
  return saveBasket(db, w, b, logId, []);
}

async function enter(db: TestDb, w: Writer, text: string, tab: ParseContext['tab'], fix: (d: EntryDraft) => EntryDraft = (d) => d) {
  const names = await knownNames(db);
  const parsed = parseCommand(text, { tab, knownCustomers: names.customers, knownProducts: names.products, deviceRole: 'owner', deviceName: 'আব্বু' });
  const products = await findProducts(db, parsed.product ? [parsed.product] : []);
  const d = fix(entryFromParse(parsed, { products, knownCustomers: names.customers, tab })!);
  const logId = await createVoiceLog(db, w, { transcript: text, source: 'voice', contextTab: tab ?? 'sale' });
  return saveEntry(db, w, d, logId, []);
}

/** A pilot shop phone: setup, buying, cash and credit sales, joma, expense, an undo, an alias. */
async function shopPhone() {
  const db = await migratedDb();
  const w = writer('A');
  await ensureDevice(db, w, 'owner');
  await saveSetup(db, w, { shopName: 'রহিম স্টোর', deviceName: 'আব্বু', role: 'owner', openingCashPoisha: 500000 }, D1);
  await enter(db, w, 'চাল ৫০ কেজি কিনলাম ৫০ টাকা করে', 'purchase');
  await enter(db, w, 'ডাল ২০ কেজি কিনলাম ৯০ টাকা করে', 'purchase');
  await sell(db, w, 'চাল ২ কেজি ১২০ টাকা');
  await sell(db, w, 'করিম চাল ২ কেজি বাকিতে নিল ১২০ টাকা', true);
  await enter(db, w, 'করিম ১০০ টাকা দিল', 'ledger');
  const exp = await enter(db, w, 'বিদ্যুৎ বিল ৫০০ টাকা', 'expense');
  await voidEntry(db, w, 'expenses', exp);
  await enter(db, w, 'চা নাস্তা ৫০ টাকা খরচ', 'expense');
  await addProductAlias(db, w, 'চাউল', (await findProducts(db, ['চাল'])).get('চাল')!.id);
  return { db, w };
}

const dump = async (db: TestDb) => {
  const out: Record<string, unknown[]> = {};
  for (const t of SYNC_TABLES) {
    const rows = await db.getAllAsync<Record<string, unknown>>(`SELECT * FROM ${t.name} ORDER BY id`);
    out[t.name] = rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'audio_path')));
  }
  return out;
};
const views = async (db: TestDb) => ({
  stock: await stockList(db),
  balances: await customerBalances(db),
  expenses: await db.getAllAsync('SELECT id, amount_poisha FROM v_expenses ORDER BY id'),
  sales: await db.getAllAsync('SELECT id, quantity FROM v_sales ORDER BY id'),
});
const asText = async (db: TestDb, now = at(D1, 21)) => JSON.stringify(await exportBackup(db, { deviceId: 'dev-A', deviceName: 'আব্বু' }, now));

describe('backup → restore', () => {
  it('round trip into an empty phone: every row, version and total comes back the same', async () => {
    const a = await shopPhone();
    const text = await asText(a.db);
    const parsed = parseBackup(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.backup).toMatchObject({ format: BACKUP_FORMAT, schema: SCHEMA_VERSION, shop_name: 'রহিম স্টোর', device_name: 'আব্বু' });
    // no phone-local columns or bookkeeping in the file
    expect(text).not.toContain('audio_path');
    expect(text).not.toContain('"root_id"');
    expect(Object.keys(parsed.backup.tables)).toEqual(SYNC_TABLES.map((t) => t.name));

    const b = await migratedDb();
    const r = await restoreBackup(b, parsed.backup);
    const rows = Object.values(parsed.backup.tables).reduce((n, t) => n + t.length, 0);
    expect(r).toEqual({ added: rows, updated: 0, same: 0 });
    expect(await dump(b)).toEqual(await dump(a.db)); // incl. root_id/rev refilled by the triggers
    expect(await views(b)).toEqual(await views(a.db));
    expect((await customerBalances(b))[0]).toMatchObject({ name: 'করিম' });
    // still append-only after a restore
    await expect(b.runAsync("UPDATE sales SET quantity = 9 WHERE id = (SELECT id FROM sales LIMIT 1)")).rejects.toThrow(/append-only/);
  });

  it('restoring twice changes nothing the second time', async () => {
    const a = await shopPhone();
    const p = parseBackup(await asText(a.db));
    if (!p.ok) throw new Error('parse');
    const b = await migratedDb();
    await restoreBackup(b, p.backup);
    const before = await dump(b);
    const r = await restoreBackup(b, p.backup);
    expect(r.added + r.updated).toBe(0);
    expect(await dump(b)).toEqual(before);
  });

  it('merge, never delete: newer edits on the phone win, entries made after the backup stay', async () => {
    const a = await shopPhone();
    const p = parseBackup(await asText(a.db));
    if (!p.ok) throw new Error('parse');
    // after the backup: a new sale, and চাল's price changed
    a.w.set(at(D1, 22));
    await sell(a.db, a.w, 'চাল ১ কেজি ৬৫ টাকা');
    await a.db.runAsync("UPDATE products SET sell_price_poisha = 6500, updated_at = ? WHERE name = 'চাল'", a.w.now());
    const before = await dump(a.db);
    const r = await restoreBackup(a.db, p.backup);
    expect(r).toMatchObject({ added: 0, updated: 0 });
    expect(await dump(a.db)).toEqual(before);
  });

  it('an older edit on the phone is replaced by the backup (last write wins, like sync)', async () => {
    const a = await shopPhone();
    await a.db.runAsync("UPDATE shop SET name = 'রহিম জেনারেল স্টোর', updated_at = ?", at(D1, 20));
    const p = parseBackup(await asText(a.db));
    if (!p.ok) throw new Error('parse');
    await a.db.runAsync("UPDATE shop SET name = 'পুরনো নাম', updated_at = ?", at(D1, 19));
    expect(await restoreBackup(a.db, p.backup)).toMatchObject({ updated: 1 });
    expect(await a.db.getFirstAsync('SELECT name FROM shop')).toEqual({ name: 'রহিম জেনারেল স্টোর' });
  });

  it('refuses a file that is not a backup, or from a newer app', () => {
    expect(parseBackup('hello')).toEqual({ ok: false, reason: 'not_backup' });
    expect(parseBackup('{"format":"x","tables":{}}')).toEqual({ ok: false, reason: 'not_backup' });
    expect(parseBackup(JSON.stringify({ format: BACKUP_FORMAT, version: 1, schema: SCHEMA_VERSION + 1, tables: {} }))).toEqual({
      ok: false,
      reason: 'newer_app',
    });
  });

  it('a backup from an older schema (fewer columns) still restores', async () => {
    const a = await shopPhone();
    const p = parseBackup(await asText(a.db));
    if (!p.ok) throw new Error('parse');
    const old = { ...p.backup, schema: 9, tables: { ...p.backup.tables } };
    old.tables.customers = old.tables.customers!.map(({ merged_into: _m, ...c }) => c);
    const b = await migratedDb();
    await restoreBackup(b, old);
    expect(await b.getFirstAsync('SELECT name, merged_into FROM customers')).toEqual({ name: 'করিম', merged_into: null });
  });
});

describe('restore + sync: only what the cloud is missing goes up', () => {
  it('phone lost: new phone restores the last backup; sync re-pushes only rows made after the last sync', async () => {
    const cloud = new FakeCloud();
    const a = await shopPhone();
    const ea = new SyncEngine(a.db, () => at(D1, 21));
    ea.setRemote(cloud.client('uid'));
    await ea.useAccount('uid');
    await ea.firstSync();
    await ea.push();
    // offline after the last sync: two more entries, then the backup at দিন শেষ, then the phone is lost
    await enter(a.db, a.w, 'রহিম ২০০ টাকা বাকি', 'ledger', (d) => withEntryCustomer(d, 'রহিম', true));
    const text = await asText(a.db);

    const b = await migratedDb();
    const wb = writer('B', at(D1, 23));
    await ensureDevice(b, wb, 'owner');
    const eb = new SyncEngine(b, () => at(D1, 23));
    eb.setRemote(cloud.client('uid'));
    await eb.useAccount('uid');
    const ctl = new SyncController(eb);
    await ctl.setAccount({ uid: 'uid', email: 'shop@x', remote: cloud.client('uid') });
    await ctl.syncNow(); // first sync done (B's own device row went up)
    const p = parseBackup(text);
    if (!p.ok) throw new Error('parse');
    await restoreBackup(b, p.backup);
    const writes = cloud.writes;
    await ctl.restored();
    // the new customer + baki row (+ its voice log) only — not the whole shop again
    expect(cloud.writes - writes).toBe(3);
    expect(await eb.pendingCount()).toBe(0);
    expect(cloud.docs('uid', 'customers').map((c) => c.name).sort()).toEqual(['করিম', 'রহিম']);
    ctl.dispose();
  });
});

describe('backup housekeeping', () => {
  it('keeps the newest 30 on Drive', () => {
    const files = Array.from({ length: 33 }, (_, i) => ({ id: `f${i}`, name: backupName(at(D1, 0) + i * 86_400_000), size: 10, createdTime: i }));
    expect(backupsToDelete([...files, { id: 'x', name: 'notes.txt', size: 1, createdTime: -1 }])).toEqual(['f2', 'f1', 'f0']);
    expect(backupName(at(D1, 21) + 5 * 60_000)).toBe('mudi-dokan-backup-2026-11-12_2105.json');
  });

  it('nightly: due once after 9 pm, and catches up a missed night', () => {
    const nine = at(D1, 21);
    expect(nightlyDue(null, at(D1, 10))).toBe(true);
    expect(nightlyDue(nine - 3_600_000 * 20, at(D1, 20))).toBe(false); // last night's 9:xx pm backup, now 8 pm
    expect(nightlyDue(nine - 3_600_000 * 25, at(D1, 20))).toBe(true); // missed last night
    expect(nightlyDue(at(D1, 15), nine + 60_000)).toBe(true); // 9:01 pm, last at 3 pm
    expect(nightlyDue(nine + 60_000, nine + 7_200_000)).toBe(false); // already done tonight
  });
});
