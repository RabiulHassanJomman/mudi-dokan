import { createVoiceLog, setOutcome } from '../../db/repo';
import { migratedDb, testWriter } from '../../db/__tests__/nodeDb';
import { BACKOFF_MS, PENDING_GRACE_MS, QUEUE_DELAY_MS, backoffMs, pendingUploads, runUploadQueue } from '../queue';
import { getMetaNumber } from '../meta';
import { FakeDrive, fakeFiles } from './fakeDrive';

const T0 = 1_763_000_000_000;

async function setup() {
  const db = await migratedDb();
  const w = testWriter(T0);
  const disk = new Map<string, string>();
  const drive = new FakeDrive(disk);
  return { db, w, disk, drive };
}

type Setup = Awaited<ReturnType<typeof setup>>;

async function clip(s: Setup, path: string | null, outcome: 'saved' | 'pending' = 'saved') {
  if (path) s.disk.set(path, 'RIFF-pcm');
  const id = await createVoiceLog(s.db, s.w, { transcript: 'চাল ২ কেজি', source: 'voice', contextTab: 'sale', audioPath: path });
  if (outcome === 'saved') await setOutcome(s.db, s.w, id, 'saved');
  return id;
}

const log = (s: Setup, id: string) =>
  s.db.getFirstAsync<{ audio_path: string | null; drive_file_id: string | null; audio_status: string; updated_at: number }>(
    'SELECT audio_path, drive_file_id, audio_status, updated_at FROM voice_logs WHERE id = ?',
    id,
  );
const queue = (s: Setup) => s.db.getAllAsync<{ voice_log_id: string; attempts: number; next_at: number; last_error: string | null }>(
  'SELECT voice_log_id, attempts, next_at, last_error FROM audio_queue ORDER BY queued_at',
);

describe('upload queue', () => {
  it('queues a voice log with a clip; typed logs and Android < 13 (no clip) are not queued', async () => {
    const s = await setup();
    const a = await clip(s, 'file:///doc/voice_1.wav');
    await clip(s, null);
    expect(await queue(s)).toEqual([{ voice_log_id: a, attempts: 0, next_at: expect.any(Number), last_error: null }]);
    const created = (await s.db.getFirstAsync<{ created_at: number }>('SELECT created_at FROM voice_logs WHERE id = ?', a))!.created_at;
    expect((await queue(s))[0]!.next_at).toBe(created + QUEUE_DELAY_MS);
  });

  it('waits QUEUE_DELAY_MS, then compresses, uploads to Mudi Dokan/Audio/YYYY-MM and marks the log', async () => {
    const s = await setup();
    const a = await clip(s, 'file:///doc/voice_1.wav');
    const before = (await log(s, a))!;
    let now = T0 + 10_000;
    expect(await runUploadQueue({ db: s.db, api: s.drive, files: fakeFiles(s.disk), now: () => now })).toMatchObject({ uploaded: 0, left: 1 });
    now = T0 + QUEUE_DELAY_MS + 60_000;
    const r = await runUploadQueue({ db: s.db, api: s.drive, files: fakeFiles(s.disk), now: () => now });
    expect(r).toEqual({ uploaded: 1, failed: 0, dropped: 0, left: 0 });
    const after = (await log(s, a))!;
    expect(after.audio_status).toBe('uploaded');
    expect(after.audio_path).toBe('file:///doc/voice_1.aac');
    expect(after.updated_at).toBeGreaterThan(before.updated_at); // synced to the other phones
    expect(s.disk.has('file:///doc/voice_1.wav')).toBe(false);
    const f = s.drive.files.get(after.drive_file_id!)!;
    expect(f.content).toBe('aac(RIFF-pcm)');
    expect(f.mimeType).toBe('audio/aac');
    expect(f.name).toMatch(/^\d{4}-\d\d-\d\d_\d{4}_[\w-]{1,8}\.aac$/);
    const month = [...s.drive.folders.entries()].find(([, id]) => id === f.parent)![0];
    expect(month).toMatch(/^Mudi Dokan\/Audio\/\d{4}-\d\d$/);
    expect(await getMetaNumber(s.db, 'drive:last_upload_at')).toBe(now);
  });

  it('a failed upload retries with growing backoff and keeps the clip', async () => {
    const s = await setup();
    const a = await clip(s, 'file:///doc/voice_1.wav');
    let now = T0 + QUEUE_DELAY_MS + 60_000;
    const deps = { db: s.db, api: s.drive, files: fakeFiles(s.disk), now: () => now };
    s.drive.failNext = 99;
    expect(await runUploadQueue(deps)).toMatchObject({ uploaded: 0, failed: 1, left: 1 });
    let q = (await queue(s))[0]!;
    expect(q).toMatchObject({ attempts: 1, next_at: now + BACKOFF_MS[0], last_error: 'network down' });
    // not due yet: nothing tried
    now += BACKOFF_MS[0] - 1;
    const calls = s.drive.calls.length;
    expect(await runUploadQueue(deps)).toMatchObject({ failed: 0, uploaded: 0 });
    expect(s.drive.calls.length).toBe(calls);
    now += 1;
    await runUploadQueue(deps);
    q = (await queue(s))[0]!;
    expect(q).toMatchObject({ attempts: 2, next_at: now + BACKOFF_MS[1] });
    expect((await log(s, a))!.drive_file_id).toBeNull();
    // network back
    s.drive.failNext = 0;
    now += BACKOFF_MS[1];
    expect(await runUploadQueue(deps)).toMatchObject({ uploaded: 1, left: 0 });
    expect((await log(s, a))!.audio_status).toBe('uploaded');
  });

  it('backoff: 30 s, 2 min, 10 min, 30 min, 2 h, then 6 h', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 50].map(backoffMs)).toEqual([30_000, 120_000, 600_000, 1_800_000, 7_200_000, 21_600_000, 21_600_000, 21_600_000]);
  });

  it("a WAV that can't be compressed still goes up as WAV", async () => {
    for (const opts of [{ canCompress: false }, { brokenWav: true }]) {
      const s = await setup();
      const a = await clip(s, 'file:///doc/voice_1.wav');
      await runUploadQueue({ db: s.db, api: s.drive, files: fakeFiles(s.disk, opts), now: () => T0 + 3_600_000 });
      const l = (await log(s, a))!;
      expect(l.audio_path).toBe('file:///doc/voice_1.wav');
      expect(s.drive.files.get(l.drive_file_id!)).toMatchObject({ content: 'RIFF-pcm', mimeType: 'audio/wav' });
    }
  });

  it('an AAC clip (Gemini recorder, Android < 13) goes up as it is', async () => {
    const s = await setup();
    const a = await clip(s, 'file:///cache/rec.aac');
    await runUploadQueue({ db: s.db, api: s.drive, files: fakeFiles(s.disk), now: () => T0 + 3_600_000 });
    const l = (await log(s, a))!;
    expect(s.drive.files.get(l.drive_file_id!)).toMatchObject({ content: 'RIFF-pcm', mimeType: 'audio/aac' });
  });

  it('a clip still on the confirm card (pending) waits; a missing file or an expired log is dropped', async () => {
    const s = await setup();
    const pending = await clip(s, 'file:///doc/p.wav', 'pending');
    const gone = await clip(s, 'file:///doc/g.wav');
    s.disk.delete('file:///doc/g.wav');
    const expired = await clip(s, 'file:///doc/e.wav');
    await s.db.runAsync("UPDATE voice_logs SET audio_status = 'expired' WHERE id = ?", expired);
    const now = T0 + QUEUE_DELAY_MS + 60_000;
    const r = await runUploadQueue({ db: s.db, api: s.drive, files: fakeFiles(s.disk), now: () => now });
    expect(r).toMatchObject({ uploaded: 0, dropped: 2, left: 1 });
    expect((await queue(s)).map((q) => q.voice_log_id)).toEqual([pending]);
    expect(s.drive.files.size).toBe(0);
    // still pending after the grace time (left on the card): goes up anyway
    const r2 = await runUploadQueue({ db: s.db, api: s.drive, files: fakeFiles(s.disk), now: () => T0 + PENDING_GRACE_MS + 60_000 });
    expect(r2).toMatchObject({ uploaded: 1, left: 0 });
    expect(gone && expired).toBeTruthy();
  });

  it('only saved entries go to Drive: a cancelled or not-understood clip is dropped, not uploaded', async () => {
    const s = await setup();
    for (const outcome of ['cancelled', 'unsupported'] as const) {
      s.disk.set(`file:///doc/${outcome}.wav`, 'RIFF-pcm');
      const id = await createVoiceLog(s.db, s.w, { transcript: 'x', source: 'voice', contextTab: 'sale', audioPath: `file:///doc/${outcome}.wav` });
      await setOutcome(s.db, s.w, id, outcome);
    }
    const r = await runUploadQueue({ db: s.db, api: s.drive, files: fakeFiles(s.disk), now: () => T0 + QUEUE_DELAY_MS + 60_000 });
    expect(r).toEqual({ uploaded: 0, failed: 0, dropped: 2, left: 0 });
    expect(s.drive.files.size).toBe(0);
  });

  it('one folder lookup per month per run; pending count', async () => {
    const s = await setup();
    for (let i = 0; i < 3; i++) await clip(s, `file:///doc/v${i}.wav`);
    expect(await pendingUploads(s.db)).toBe(3);
    await runUploadQueue({ db: s.db, api: s.drive, files: fakeFiles(s.disk), now: () => T0 + 3_600_000 });
    expect(s.drive.calls.filter((c) => c.startsWith('folder')).length).toBe(1);
    expect(await pendingUploads(s.db)).toBe(0);
  });
});
