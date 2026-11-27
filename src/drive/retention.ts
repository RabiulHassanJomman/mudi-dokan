/**
 * Audio retention (step 8), once a day on every phone. Pure TS.
 *
 * A clip older than RETENTION_DAYS (30, decided Nov 27) is deleted from this phone and from
 * Drive, an unpaid baki's too. Only saved entries keep their clip: a clip whose command was
 * cancelled (না), not understood or not heard goes at the next run after UNSAVED_GRACE_MS.
 * Deleted everywhere → audio_status 'expired' (synced: other phones drop their cached copy
 * and hide ▶️). If Drive can't be reached, only the phone's copy goes; Drive is tried again
 * the next day.
 */
import type { Db } from '../db/repo';
import type { DriveApi } from './api';
import { setMeta } from './meta';

export const RETENTION_DAYS = 30;
export const DAY_MS = 86_400_000;
/** A command not saved: its clip waits this long (the card may still be open), then goes. */
export const UNSAVED_GRACE_MS = 3_600_000;
export const META_RETENTION_AT = 'drive:retention_at';

const UNSAVED = new Set(['cancelled', 'unsupported', 'stt_error']);

export interface ClipInfo {
  id: string;
  created_at: number;
  audio_status: string;
  /** voice_logs.outcome */
  outcome: string;
}

/** Which clips to delete now. Already expired: always (only a leftover copy on this phone is still there). */
export function clipsToExpire(clips: readonly ClipInfo[], now: number, days = RETENTION_DAYS): string[] {
  const cutoff = now - days * DAY_MS;
  return clips
    .filter(
      (c) =>
        c.audio_status === 'expired' ||
        c.created_at < cutoff ||
        (UNSAVED.has(c.outcome) && c.created_at < now - UNSAVED_GRACE_MS),
    )
    .map((c) => c.id);
}

export interface RetentionDeps {
  db: Db;
  /** null: not signed in / Drive off — only this phone's copies go. */
  api: DriveApi | null;
  removeFile(uri: string): Promise<void>;
  now?: () => number;
}

export interface RetentionResult {
  expired: number;
  localDeleted: number;
  driveDeleted: number;
}

/** Clips that still exist somewhere (phone or Drive): old enough, not saved, or expired with a copy left here. */
async function candidates(db: Db, cutoff: number, unsavedBefore: number) {
  return db.getAllAsync<ClipInfo & { audio_path: string | null; drive_file_id: string | null }>(
    `SELECT v.id, v.created_at, v.audio_status, v.outcome, v.audio_path, v.drive_file_id
     FROM voice_logs v
     WHERE (v.audio_status = 'expired' AND v.audio_path IS NOT NULL)
        OR (v.audio_status != 'expired' AND (v.audio_path IS NOT NULL OR v.drive_file_id IS NOT NULL)
            AND (v.created_at < ? OR (v.outcome IN ('cancelled','unsupported','stt_error') AND v.created_at < ?)))`,
    cutoff,
    unsavedBefore,
  );
}

export async function runRetention(deps: RetentionDeps): Promise<RetentionResult> {
  const { db, api } = deps;
  const now = (deps.now ?? Date.now)();
  const rows = await candidates(db, now - RETENTION_DAYS * DAY_MS, now - UNSAVED_GRACE_MS);
  const go = new Set(clipsToExpire(rows, now));
  const res: RetentionResult = { expired: 0, localDeleted: 0, driveDeleted: 0 };

  for (const r of rows) {
    if (!go.has(r.id)) continue;
    if (r.audio_path) {
      await deps.removeFile(r.audio_path).catch(() => undefined);
      await db.runAsync('UPDATE voice_logs SET audio_path = NULL WHERE id = ?', r.id); // local column: no bump
      await db.runAsync('DELETE FROM audio_queue WHERE voice_log_id = ?', r.id);
      res.localDeleted++;
    }
    if (r.audio_status === 'expired') continue;
    if (r.drive_file_id) {
      if (!api) continue; // Drive later
      try {
        await api.remove(r.drive_file_id);
        res.driveDeleted++;
      } catch {
        continue; // offline: next run
      }
    }
    await db.runAsync(
      "UPDATE voice_logs SET audio_status = 'expired', updated_at = MAX(updated_at + 1, ?) WHERE id = ?",
      now,
      r.id,
    );
    res.expired++;
  }
  await setMeta(db, META_RETENTION_AT, now);
  return res;
}
