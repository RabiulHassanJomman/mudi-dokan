/**
 * Audio retention (step 8), once a day on every phone. Pure TS.
 *
 * A clip older than RETENTION_DAYS is deleted from this phone and from Drive, unless one of
 * its entries (sale or বাকি/জমা) belongs to a customer who still owes (current baki > 0):
 * that voice is the proof until the baki is paid; the next daily run after that deletes it.
 * Deleted everywhere → audio_status 'expired' (synced: other phones drop their cached copy
 * and hide ▶️). If Drive can't be reached, only the phone's copy goes; Drive is tried again
 * the next day.
 */
import type { Db } from '../db/repo';
import type { DriveApi } from './api';
import { setMeta } from './meta';

export const RETENTION_DAYS = 90;
export const DAY_MS = 86_400_000;
export const META_RETENTION_AT = 'drive:retention_at';

export interface ClipInfo {
  id: string;
  created_at: number;
  audio_status: string;
  /** Customers of the entries this voice made (merged ones as the customer kept). */
  customer_ids: readonly string[];
}

/**
 * Which clips to delete now. `owes` = customer id → current baki (poisha).
 * Already expired: always (only a leftover copy on this phone is still there).
 */
export function clipsToExpire(clips: readonly ClipInfo[], owes: ReadonlyMap<string, number>, now: number, days = RETENTION_DAYS): string[] {
  const cutoff = now - days * DAY_MS;
  return clips
    .filter((c) => c.audio_status === 'expired' || (c.created_at < cutoff && !c.customer_ids.some((id) => (owes.get(id) ?? 0) > 0)))
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
  /** Kept past 90 days as proof of a baki not yet paid. */
  keptForBaki: number;
}

/** Clips that still exist somewhere (phone or Drive) and are old enough, or expired with a copy left here. */
async function candidates(db: Db, cutoff: number) {
  return db.getAllAsync<{ id: string; created_at: number; audio_status: string; audio_path: string | null; drive_file_id: string | null; customers: string | null }>(
    `SELECT v.id, v.created_at, v.audio_status, v.audio_path, v.drive_file_id,
       (SELECT GROUP_CONCAT(cid) FROM (
          SELECT COALESCE(c.merged_into, c.id) AS cid FROM sales s JOIN customers c ON c.id = s.customer_id WHERE s.voice_log_id = v.id
          UNION
          SELECT COALESCE(c.merged_into, c.id) FROM ledger l JOIN customers c ON c.id = l.party_id WHERE l.voice_log_id = v.id
       )) AS customers
     FROM voice_logs v
     WHERE (v.audio_status = 'expired' AND v.audio_path IS NOT NULL)
        OR (v.audio_status != 'expired' AND v.created_at < ? AND (v.audio_path IS NOT NULL OR v.drive_file_id IS NOT NULL))`,
    cutoff,
  );
}

/** Current baki per customer (> 0 only); a merged duplicate's counts for the customer kept. */
async function owing(db: Db): Promise<Map<string, number>> {
  const rows = await db.getAllAsync<{ id: string; bal: number }>(
    `SELECT COALESCE(c.merged_into, c.id) AS id, SUM(CASE l.kind WHEN 'baki' THEN l.amount_poisha ELSE -l.amount_poisha END) AS bal
     FROM v_ledger l JOIN customers c ON c.id = l.party_id
     WHERE l.party_type = 'customer' GROUP BY COALESCE(c.merged_into, c.id) HAVING bal > 0`,
  );
  return new Map(rows.map((r) => [r.id, r.bal]));
}

export async function runRetention(deps: RetentionDeps): Promise<RetentionResult> {
  const { db, api } = deps;
  const now = (deps.now ?? Date.now)();
  const rows = await candidates(db, now - RETENTION_DAYS * DAY_MS);
  const owes = await owing(db);
  const infos: ClipInfo[] = rows.map((r) => ({
    id: r.id,
    created_at: r.created_at,
    audio_status: r.audio_status,
    customer_ids: r.customers ? r.customers.split(',') : [],
  }));
  const go = new Set(clipsToExpire(infos, owes, now));
  const res: RetentionResult = { expired: 0, localDeleted: 0, driveDeleted: 0, keptForBaki: rows.length - go.size };

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
