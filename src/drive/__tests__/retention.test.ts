import { migratedDb } from '../../db/__tests__/nodeDb';
import { DAY_MS, RETENTION_DAYS, clipsToExpire, runRetention } from '../retention';
import { getMetaNumber } from '../meta';
import { FakeDrive } from './fakeDrive';

const NOW = 1_780_000_000_000;
const OLD = NOW - (RETENTION_DAYS + 1) * DAY_MS;
const NEW = NOW - 10 * DAY_MS;

type Db = Awaited<ReturnType<typeof migratedDb>>;
type Bind = string | number | null;

async function insert(db: Db, table: string, v: Record<string, Bind>) {
  const cols = Object.keys(v);
  await db.runAsync(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, ...Object.values(v));
}
const row = (id: string, at: number) => ({ id, device_id: 'd1', created_at: at, updated_at: at });
const entry = (id: string, at: number) => ({ ...row(id, at), device_name: 'আব্বু' });

/**
 * করিম owes ৳ 100 (old baki by voice v-karim), রহিম paid back in full (old baki v-rahim +
 * old joma), an old cash sale (v-cash), a new one (v-new), an old one already expired on
 * another phone with a copy cached here (v-exp), and a merged customer who owes (v-merged).
 */
async function shop() {
  const db = await migratedDb();
  const drive = new FakeDrive();
  const disk = drive.disk;
  const folder = await drive.folder(['Mudi Dokan', 'Audio', '2026-08']);
  const clip = async (id: string, at: number, opts: { local?: boolean; drive?: boolean; status?: string } = {}) => {
    const path = opts.local === false ? null : `file:///doc/${id}.aac`;
    if (path) disk.set(path, 'aac');
    const up = opts.drive === false ? null : await drive.uploadText('aac', `${id}.aac`, 'audio/aac', folder);
    await insert(db, 'voice_logs', {
      ...row(id, at), transcript: id, device_name: 'আব্বু', audio_path: path, drive_file_id: up?.id ?? null,
      audio_status: opts.status ?? (up ? 'uploaded' : 'local'),
    });
  };
  await insert(db, 'products', { ...row('p1', OLD), name: 'চাল', unit: 'kg' });
  for (const [id, name] of [['c-karim', 'করিম'], ['c-rahim', 'রহিম'], ['c-old', 'জসিম'], ['c-kept', 'জসিম ভাই']] as const) {
    await insert(db, 'customers', { ...row(id, OLD), name });
  }
  await db.runAsync("UPDATE customers SET merged_into = 'c-kept', archived = 1 WHERE id = 'c-old'");

  await clip('v-karim', OLD);
  await insert(db, 'sales', {
    ...entry('s1', OLD), product_id: 'p1', quantity: 2, sell_price_poisha: 5000, amount_poisha: 10000, cost_price_poisha: 4500,
    credit: 1, customer_id: 'c-karim', voice_log_id: 'v-karim',
  });
  await insert(db, 'ledger', { ...entry('l1', OLD), party_id: 'c-karim', kind: 'baki', amount_poisha: 10000, sale_id: 's1', voice_log_id: 'v-karim' });

  await clip('v-rahim', OLD);
  await insert(db, 'ledger', { ...entry('l2', OLD), party_id: 'c-rahim', kind: 'baki', amount_poisha: 5000, voice_log_id: 'v-rahim' });
  await insert(db, 'ledger', { ...entry('l3', NEW), party_id: 'c-rahim', kind: 'joma', amount_poisha: 5000 });

  await clip('v-cash', OLD, { local: false }); // made on the other phone: only on Drive
  await insert(db, 'sales', {
    ...entry('s2', OLD), product_id: 'p1', quantity: 1, sell_price_poisha: 5000, amount_poisha: 5000, cost_price_poisha: 4500, voice_log_id: 'v-cash',
  });
  await clip('v-new', NEW);
  await clip('v-exp', OLD, { drive: false, status: 'expired' });
  await clip('v-merged', OLD);
  // the baki was given to the duplicate, which was merged into c-kept (re-pointed, still owed)
  await insert(db, 'ledger', { ...entry('l4', OLD), party_id: 'c-old', kind: 'baki', amount_poisha: 2000, voice_log_id: 'v-merged' });
  return { db, drive, disk };
}

const statuses = async (db: Db) =>
  Object.fromEntries(
    (await db.getAllAsync<{ id: string; audio_status: string; audio_path: string | null }>('SELECT id, audio_status, audio_path FROM voice_logs ORDER BY id')).map(
      (r) => [r.id, `${r.audio_status}${r.audio_path ? '+local' : ''}`],
    ),
  );

describe('clipsToExpire (pure)', () => {
  const owes = new Map([['c1', 100]]);
  it('older than 90 days goes, unless a customer of it still owes', () => {
    expect(
      clipsToExpire(
        [
          { id: 'a', created_at: OLD, audio_status: 'uploaded', customer_ids: [] },
          { id: 'b', created_at: OLD, audio_status: 'uploaded', customer_ids: ['c1'] },
          { id: 'c', created_at: OLD, audio_status: 'local', customer_ids: ['c2'] },
          { id: 'd', created_at: NEW, audio_status: 'local', customer_ids: [] },
          { id: 'e', created_at: NEW, audio_status: 'expired', customer_ids: ['c1'] },
        ],
        owes,
        NOW,
      ),
    ).toEqual(['a', 'c', 'e']);
  });
  it('exactly 90 days is kept', () => {
    expect(clipsToExpire([{ id: 'a', created_at: NOW - RETENTION_DAYS * DAY_MS, audio_status: 'local', customer_ids: [] }], owes, NOW)).toEqual([]);
  });
});

describe('runRetention', () => {
  it('deletes old clips on the phone and Drive, keeps the proof of an unpaid baki', async () => {
    const { db, drive, disk } = await shop();
    const before = drive.files.size;
    const r = await runRetention({ db, api: drive, removeFile: async (u) => void disk.delete(u), now: () => NOW });
    expect(r).toEqual({ expired: 2, localDeleted: 2, driveDeleted: 2, keptForBaki: 2 });
    expect(await statuses(db)).toEqual({
      'v-cash': 'expired',
      'v-exp': 'expired',
      'v-karim': 'uploaded+local', // করিম still owes
      'v-merged': 'uploaded+local', // owed by the merged customer
      'v-new': 'uploaded+local',
      'v-rahim': 'expired', // paid back
    });
    expect(drive.files.size).toBe(before - 2);
    expect(disk.has('file:///doc/v-rahim.aac')).toBe(false);
    expect(disk.has('file:///doc/v-exp.aac')).toBe(false);
    expect(disk.has('file:///doc/v-karim.aac')).toBe(true);
    expect(await getMetaNumber(db, 'drive:retention_at')).toBe(NOW);
    // expired is synced: updated_at moved
    expect((await db.getFirstAsync<{ updated_at: number }>("SELECT updated_at FROM voice_logs WHERE id = 'v-rahim'"))!.updated_at).toBe(NOW);
  });

  it('when করিম pays, the next daily run deletes his clip', async () => {
    const { db, drive, disk } = await shop();
    await runRetention({ db, api: drive, removeFile: async (u) => void disk.delete(u), now: () => NOW });
    await insert(db, 'ledger', { ...entry('l9', NOW), party_id: 'c-karim', kind: 'joma', amount_poisha: 10000 });
    await runRetention({ db, api: drive, removeFile: async (u) => void disk.delete(u), now: () => NOW + DAY_MS });
    expect((await statuses(db))['v-karim']).toBe('expired');
  });

  it('offline / not signed in: only the phone copy goes; Drive is retried next time', async () => {
    const { db, drive, disk } = await shop();
    const r = await runRetention({ db, api: null, removeFile: async (u) => void disk.delete(u), now: () => NOW });
    expect(r).toMatchObject({ expired: 0, driveDeleted: 0 });
    expect((await statuses(db))['v-rahim']).toBe('uploaded'); // copy gone, Drive still has it
    drive.failNext = 99;
    await runRetention({ db, api: drive, removeFile: async (u) => void disk.delete(u), now: () => NOW });
    expect((await statuses(db))['v-rahim']).toBe('uploaded');
    drive.failNext = 0;
    const r2 = await runRetention({ db, api: drive, removeFile: async (u) => void disk.delete(u), now: () => NOW });
    expect(r2).toMatchObject({ expired: 2, driveDeleted: 2 });
  });

  it('a clip never uploaded (no account) just expires', async () => {
    const db = await migratedDb();
    await insert(db, 'voice_logs', { ...row('v1', OLD), transcript: 'x', device_name: 'আব্বু', audio_path: 'file:///a.wav', audio_status: 'local' });
    await db.runAsync("INSERT INTO audio_queue (voice_log_id, queued_at) VALUES ('v1', 1)");
    const r = await runRetention({ db, api: null, removeFile: async () => undefined, now: () => NOW });
    expect(r).toMatchObject({ expired: 1, localDeleted: 1 });
    expect(await db.getFirstAsync('SELECT COUNT(*) AS n FROM audio_queue')).toEqual({ n: 0 });
  });
});
