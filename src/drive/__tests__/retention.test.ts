import { migratedDb } from '../../db/__tests__/nodeDb';
import { DAY_MS, RETENTION_DAYS, UNSAVED_GRACE_MS, clipsToExpire, runRetention } from '../retention';
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
  const clip = (id: string, created_at: number, audio_status = 'uploaded', outcome = 'saved') => ({ id, created_at, audio_status, outcome });
  it('older than 30 days goes, even for a customer who still owes', () => {
    expect(RETENTION_DAYS).toBe(30);
    expect(
      clipsToExpire([clip('a', OLD), clip('b', OLD, 'local', 'saved_edited'), clip('d', NEW, 'local'), clip('e', NEW, 'expired')], NOW),
    ).toEqual(['a', 'b', 'e']);
  });
  it('exactly 30 days is kept', () => {
    expect(clipsToExpire([clip('a', NOW - RETENTION_DAYS * DAY_MS, 'local')], NOW)).toEqual([]);
  });
  it('only saved entries keep their clip: cancelled / not understood go after an hour', () => {
    const hourAgo = NOW - UNSAVED_GRACE_MS - 1;
    expect(
      clipsToExpire(
        [clip('n', hourAgo, 'local', 'cancelled'), clip('u', hourAgo, 'local', 'unsupported'), clip('s', hourAgo, 'local', 'stt_error'), clip('p', hourAgo, 'local', 'pending'), clip('fresh', NOW - 60_000, 'local', 'cancelled')],
        NOW,
      ),
    ).toEqual(['n', 'u', 's']);
  });
});

describe('runRetention', () => {
  it('deletes clips older than 30 days on the phone and Drive, an unpaid baki too', async () => {
    const { db, drive, disk } = await shop();
    const before = drive.files.size;
    const r = await runRetention({ db, api: drive, removeFile: async (u) => void disk.delete(u), now: () => NOW });
    expect(r).toEqual({ expired: 4, localDeleted: 4, driveDeleted: 4 });
    expect(await statuses(db)).toEqual({
      'v-cash': 'expired',
      'v-exp': 'expired',
      'v-karim': 'expired', // still owes, but 30 days is the limit
      'v-merged': 'expired',
      'v-new': 'uploaded+local',
      'v-rahim': 'expired',
    });
    expect(drive.files.size).toBe(before - 4);
    expect(disk.has('file:///doc/v-rahim.aac')).toBe(false);
    expect(disk.has('file:///doc/v-exp.aac')).toBe(false);
    expect(disk.has('file:///doc/v-karim.aac')).toBe(false);
    expect(await getMetaNumber(db, 'drive:retention_at')).toBe(NOW);
    // expired is synced: updated_at moved
    expect((await db.getFirstAsync<{ updated_at: number }>("SELECT updated_at FROM voice_logs WHERE id = 'v-rahim'"))!.updated_at).toBe(NOW);
  });

  it('a cancelled entry\'s new clip goes at the next run (no Drive needed)', async () => {
    const db = await migratedDb();
    const at = NOW - UNSAVED_GRACE_MS - 1;
    await insert(db, 'voice_logs', { ...row('v1', at), transcript: 'x', device_name: 'আব্বু', audio_path: 'file:///a.wav', audio_status: 'local', outcome: 'cancelled' });
    await insert(db, 'voice_logs', { ...row('v2', at), transcript: 'y', device_name: 'আব্বু', audio_path: 'file:///b.wav', audio_status: 'local', outcome: 'saved' });
    const gone: string[] = [];
    const r = await runRetention({ db, api: null, removeFile: async (u) => void gone.push(u), now: () => NOW });
    expect(r).toMatchObject({ expired: 1, localDeleted: 1 });
    expect(gone).toEqual(['file:///a.wav']);
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
    expect(r2).toMatchObject({ expired: 4, driveDeleted: 4 });
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
