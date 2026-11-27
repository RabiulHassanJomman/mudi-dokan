/**
 * Full DB backup as JSON (step 8): to Drive "Mudi Dokan/Backup/" nightly and at দিন শেষ,
 * or as a file through the share sheet. Restore merges a backup into this phone. Pure TS.
 *
 * What goes in: every synced table (src/sync/tables.ts), all rows, all versions (entries are
 * append-only, so history and corrections come back exactly). Not: this phone's local columns
 * (audio_path, root_id/rev — triggers refill them), sync bookkeeping, the upload queue.
 *
 * Restore = merge, never delete: rows keep their UUIDs; an entry is added if this phone
 * doesn't have it; a product/customer/… row replaces this phone's only if it is newer (same
 * rule as sync). So restoring onto a phone that already synced changes nothing it has, and
 * sync afterwards sends up only what the cloud is missing (see SyncController.restored).
 */
import type { Db } from '../db/repo';
import { SCHEMA_VERSION } from '../db/migrations';
import { SYNC_TABLES } from '../sync/tables';
import { stamp, type DriveFile } from './api';

export const BACKUP_FORMAT = 'mudi-dokan-backup';
export const BACKUP_VERSION = 1;
/** Drive keeps this many; older ones are deleted after each backup. */
export const KEEP_BACKUPS = 30;
export const BACKUP_MIME = 'application/json';

export const META_BACKUP_AT = 'drive:backup_at';
/** দিন শেষ while offline: back up as soon as Drive can be reached. */
export const META_BACKUP_WANTED = 'drive:backup_wanted';

type Bind = string | number | null;
export type Row = Record<string, Bind>;

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: number;
  schema: number;
  created_at: number;
  device_id: string;
  device_name: string;
  shop_name: string | null;
  tables: Record<string, Row[]>;
}

export const backupName = (now: number) => `mudi-dokan-backup-${stamp(now)}.json`;

export async function exportBackup(db: Db, by: { deviceId: string; deviceName: string }, now: number): Promise<BackupFile> {
  const tables: Record<string, Row[]> = {};
  for (const t of SYNC_TABLES) {
    const rows = await db.getAllAsync<Row>(`SELECT * FROM ${t.name} ORDER BY created_at, id`);
    tables[t.name] = rows.map((r) => {
      const o: Row = {};
      for (const [k, v] of Object.entries(r)) if (!t.localOnly.includes(k)) o[k] = v;
      return o;
    });
  }
  const shop = tables.shop?.[0];
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    schema: SCHEMA_VERSION,
    created_at: now,
    device_id: by.deviceId,
    device_name: by.deviceName,
    shop_name: shop ? String(shop.name) : null,
    tables,
  };
}

/** Row count per table (the restore sheet reads the total). */

export type ParseResult = { ok: true; backup: BackupFile } | { ok: false; reason: 'not_backup' | 'newer_app' };

export function parseBackup(text: string): ParseResult {
  let o: unknown;
  try {
    o = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'not_backup' };
  }
  const b = o as Partial<BackupFile> | null;
  if (!b || b.format !== BACKUP_FORMAT || typeof b.tables !== 'object' || b.tables === null) return { ok: false, reason: 'not_backup' };
  if ((b.version ?? 0) > BACKUP_VERSION || (b.schema ?? 0) > SCHEMA_VERSION) return { ok: false, reason: 'newer_app' };
  for (const rows of Object.values(b.tables)) if (!Array.isArray(rows)) return { ok: false, reason: 'not_backup' };
  return { ok: true, backup: b as BackupFile };
}

export interface RestoreResult {
  /** New rows (not on this phone before). */
  added: number;
  /** This phone's row replaced by the backup's newer one. */
  updated: number;
  /** Already here (same or newer). */
  same: number;
}

/**
 * Merges `b` into the DB in one transaction (all or nothing). Foreign keys are checked at
 * the end, so the order inside the file doesn't matter.
 */
export async function restoreBackup(db: Db, b: BackupFile): Promise<RestoreResult> {
  const res: RestoreResult = { added: 0, updated: 0, same: 0 };
  await db.withTransactionAsync(async () => {
    await db.runAsync('PRAGMA defer_foreign_keys = ON');
    for (const t of SYNC_TABLES) {
      const rows = [...(b.tables[t.name] ?? [])].sort(
        (x, y) => Number(x.created_at) - Number(y.created_at) || String(x.id).localeCompare(String(y.id)),
      );
      if (!rows.length) continue;
      const local = (await db.getAllAsync<{ name: string }>('SELECT name FROM pragma_table_info(?)', t.name)).map((c) => c.name);
      for (const r of rows) {
        const cols = local.filter((c) => c in r && !t.localOnly.includes(c));
        if (!cols.includes('id')) continue;
        const id = String(r.id);
        const had = await db.getFirstAsync<{ updated_at: number; device_id: string }>(`SELECT updated_at, device_id FROM ${t.name} WHERE id = ?`, id);
        if (had && (t.kind === 'entry' || !newer(r, had))) {
          res.same++;
          continue;
        }
        const vals = cols.map((c) => r[c] ?? null);
        const ph = cols.map(() => '?').join(', ');
        if (!had) {
          await db.runAsync(`INSERT INTO ${t.name} (${cols.join(', ')}) VALUES (${ph})`, ...vals);
          res.added++;
        } else {
          const set = cols.filter((c) => c !== 'id').map((c) => `${c} = ?`).join(', ');
          await db.runAsync(`UPDATE ${t.name} SET ${set} WHERE id = ?`, ...cols.filter((c) => c !== 'id').map((c) => r[c] ?? null), id);
          res.updated++;
        }
      }
    }
  });
  return res;
}

/** Sync's last-write-wins rule (tie: the larger device_id). */
const newer = (r: Row, had: { updated_at: number; device_id: string }) =>
  Number(r.updated_at) > had.updated_at || (Number(r.updated_at) === had.updated_at && String(r.device_id) > had.device_id);

/** Backups to delete: all but the newest `keep` (by created time). */
export function backupsToDelete(files: readonly DriveFile[], keep = KEEP_BACKUPS): string[] {
  return [...files]
    .filter((f) => f.name.startsWith('mudi-dokan-backup-'))
    .sort((a, b) => b.createdTime - a.createdTime || b.name.localeCompare(a.name))
    .slice(keep)
    .map((f) => f.id);
}

/** Nightly: after NIGHT_HOUR (local), once per night. */
export const NIGHT_HOUR = 21;

/**
 * Is a nightly backup due? Yes if none since the last NIGHT_HOUR that has passed, i.e. one
 * after 9 pm today, or (before 9 pm) one after 9 pm yesterday.
 */
export function nightlyDue(lastAt: number | null, now: number): boolean {
  const d = new Date(now);
  const tonight = new Date(d.getFullYear(), d.getMonth(), d.getDate(), NIGHT_HOUR).getTime();
  const lastNight = now >= tonight ? tonight : new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, NIGHT_HOUR).getTime();
  return lastAt === null || lastAt < lastNight;
}
