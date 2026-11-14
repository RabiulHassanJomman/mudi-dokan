/** A second SQLite connection for work that runs beside the screens (the understand queue). Waits instead of failing when a screen is saving. */
import { openDatabaseAsync } from 'expo-sqlite';

import type { Db } from './repo';
import { DATABASE_NAME } from './client';
import { SCHEMA_VERSION } from './migrations';

let conn: Promise<Db | null> | null = null;

async function open(): Promise<Db | null> {
  const c = await openDatabaseAsync(DATABASE_NAME, { useNewConnection: true });
  await c.execAsync('PRAGMA busy_timeout = 10000; PRAGMA foreign_keys = ON;');
  const v = await c.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  if (v?.user_version !== SCHEMA_VERSION) {
    await c.closeAsync();
    return null;
  }
  return c as unknown as Db;
}

/** null until the DB is migrated to this app's version (a background start before the first screen); asked again next time. */
export function openBackgroundDb(): Promise<Db | null> {
  conn ??= open().then(
    (d) => {
      if (!d) conn = null;
      return d;
    },
    (e) => {
      conn = null;
      throw e;
    },
  );
  return conn;
}
