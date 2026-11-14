/**
 * Step 8 bookkeeping in sync_meta (local key/value, never synced): 'drive:*' keys.
 * Pure TS.
 */
import type { Db } from '../db/repo';

export async function getMeta(db: Db, key: string): Promise<string | null> {
  const r = await db.getFirstAsync<{ value: string | null }>('SELECT value FROM sync_meta WHERE key = ?', key);
  return r?.value ?? null;
}

export async function getMetaNumber(db: Db, key: string): Promise<number | null> {
  const v = await getMeta(db, key);
  return v === null || v === '' ? null : Number(v);
}

export async function setMeta(db: Db, key: string, value: string | number | null): Promise<void> {
  await db.runAsync(
    'INSERT INTO sync_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key,
    value === null ? null : String(value),
  );
}
