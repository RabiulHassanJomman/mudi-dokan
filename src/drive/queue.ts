/**
 * Voice clips → Drive "Mudi Dokan/Audio/YYYY-MM" (step 8). Pure TS against the Db interface;
 * the Drive client and the file operations are passed in (fakes in tests).
 *
 * - A clip is queued when its voice log is made (createVoiceLog) — only this phone's clips:
 *   Android < 13 keeps no audio, so nothing is queued there.
 * - Each run: due items (next_at ≤ now), oldest first. The WAV is made small (AAC ~16 kbps
 *   mono) first; the small file replaces the WAV on the phone too. If that fails the WAV goes
 *   up as it is (bigger, but never lost).
 * - Success: voice_logs.drive_file_id + audio_status 'uploaded' (synced, so the other phones
 *   can play it), out of the queue. Failure: attempts + 1, next try after BACKOFF_MS.
 * - Nothing to send (file gone, log expired or already on Drive): out of the queue.
 */
import type { Db } from '../db/repo';
import { audioPath, stamp, type DriveApi } from './api';
import { setMeta } from './meta';

/** Wait after a failure: 30 s, 2 min, 10 min, 30 min, 2 h, then every 6 h. */
export const BACKOFF_MS = [30_000, 120_000, 600_000, 1_800_000, 7_200_000, 21_600_000] as const;
export const backoffMs = (attempts: number) => BACKOFF_MS[Math.min(Math.max(attempts, 1), BACKOFF_MS.length) - 1]!;

/**
 * A new clip waits this long: the confirm card and Gemini may still read the WAV. A log still
 * 'pending' (card open) waits until PENDING_GRACE_MS after it was made.
 */
export const QUEUE_DELAY_MS = 2 * 60_000;
export const PENDING_GRACE_MS = 10 * 60_000;
/** Per run, so one run never holds the phone long. */
export const RUN_LIMIT = 25;

export const META_LAST_UPLOAD = 'drive:last_upload_at';
export const META_LAST_ERROR = 'drive:last_error';

export interface ClipFiles {
  exists(uri: string): Promise<boolean>;
  remove(uri: string): Promise<void>;
  /** WAV → small AAC beside it; returns the new URI, or null if this phone can't. Throws on a bad file. */
  compress(uri: string): Promise<string | null>;
}

export interface UploadDeps {
  db: Db;
  api: DriveApi;
  files: ClipFiles;
  now?: () => number;
}

export interface RunResult {
  uploaded: number;
  failed: number;
  dropped: number;
  /** Items left that are not due yet (or over this run's limit). */
  left: number;
}

interface QueueRow {
  voice_log_id: string;
  attempts: number;
  queued_at: number;
  log_id: string | null;
  audio_path: string | null;
  drive_file_id: string | null;
  audio_status: string | null;
  outcome: string | null;
  created_at: number | null;
}

/** Called with every new voice log that has a clip on this phone. */
export async function enqueueClip(db: Db, voiceLogId: string, now: number): Promise<void> {
  await db.runAsync(
    'INSERT INTO audio_queue (voice_log_id, next_at, queued_at) VALUES (?, ?, ?) ON CONFLICT(voice_log_id) DO NOTHING',
    voiceLogId,
    now + QUEUE_DELAY_MS,
    now,
  );
}

export async function pendingUploads(db: Db): Promise<number> {
  return (await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM audio_queue'))?.n ?? 0;
}

const mimeOf = (uri: string) => (uri.toLowerCase().endsWith('.wav') ? 'audio/wav' : 'audio/aac');
const extOf = (uri: string) => (uri.toLowerCase().endsWith('.wav') ? 'wav' : 'aac');

/** One pass over the due items. Throws only if the DB fails; Drive errors become retries. */
export async function runUploadQueue(deps: UploadDeps): Promise<RunResult> {
  const { db, api, files } = deps;
  const now = deps.now ?? Date.now;
  const t0 = now();
  const rows = await db.getAllAsync<QueueRow>(
    `SELECT q.voice_log_id, q.attempts, q.queued_at, v.id AS log_id, v.audio_path, v.drive_file_id, v.audio_status,
            v.outcome, v.created_at
     FROM audio_queue q LEFT JOIN voice_logs v ON v.id = q.voice_log_id
     WHERE q.next_at <= ? ORDER BY q.queued_at, q.voice_log_id LIMIT ?`,
    t0,
    RUN_LIMIT,
  );
  const res: RunResult = { uploaded: 0, failed: 0, dropped: 0, left: 0 };
  const drop = async (id: string) => {
    await db.runAsync('DELETE FROM audio_queue WHERE voice_log_id = ?', id);
    res.dropped++;
  };
  const folders = new Map<string, string>();

  for (const r of rows) {
    const id = r.voice_log_id;
    if (!r.log_id || r.drive_file_id || r.audio_status === 'expired' || !r.audio_path) {
      await drop(id);
      continue;
    }
    if (r.outcome === 'pending' && now() - (r.created_at ?? 0) < PENDING_GRACE_MS) {
      await db.runAsync('UPDATE audio_queue SET next_at = ? WHERE voice_log_id = ?', (r.created_at ?? now()) + PENDING_GRACE_MS, id);
      continue;
    }
    if (!(await files.exists(r.audio_path))) {
      await drop(id);
      continue;
    }
    try {
      let uri = r.audio_path;
      if (extOf(uri) === 'wav') {
        let small: string | null = null;
        try {
          small = await files.compress(uri);
        } catch {
          small = null; // a broken WAV still goes up as it is
        }
        if (small) {
          // audio_path is local only: no updated_at bump, nothing to sync
          await db.runAsync('UPDATE voice_logs SET audio_path = ? WHERE id = ?', small, id);
          await files.remove(uri).catch(() => undefined);
          uri = small;
        }
      }
      const path = audioPath(r.created_at ?? r.queued_at);
      const key = path.join('/');
      let parent = folders.get(key);
      if (!parent) {
        parent = await api.folder(path);
        folders.set(key, parent);
      }
      const name = `${stamp(r.created_at ?? r.queued_at)}_${id.slice(0, 8)}.${extOf(uri)}`;
      const up = await api.uploadFile(uri, name, mimeOf(uri), parent);
      const t = now();
      await db.withTransactionAsync(async () => {
        await db.runAsync(
          `UPDATE voice_logs SET drive_file_id = ?, audio_status = 'uploaded', updated_at = MAX(updated_at + 1, ?) WHERE id = ?`,
          up.id,
          t,
          id,
        );
        await db.runAsync('DELETE FROM audio_queue WHERE voice_log_id = ?', id);
      });
      await setMeta(db, META_LAST_UPLOAD, t);
      res.uploaded++;
    } catch (e) {
      const attempts = r.attempts + 1;
      const msg = e instanceof Error ? e.message : String(e);
      await db.runAsync(
        'UPDATE audio_queue SET attempts = ?, next_at = ?, last_error = ? WHERE voice_log_id = ?',
        attempts,
        now() + backoffMs(attempts),
        msg.slice(0, 300),
        id,
      );
      await setMeta(db, META_LAST_ERROR, msg.slice(0, 300));
      res.failed++;
    }
  }
  res.left = await pendingUploads(db);
  return res;
}
