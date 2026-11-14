import type { SQLiteDatabase } from 'expo-sqlite';

import { getDevice, writer } from '../device';
import { migrate } from './migrations';
import { ensureDevice } from './repo';

export const DATABASE_NAME = 'mudi-dokan.db';

/** SQLiteProvider onInit: runs before any screen touches the DB. */
let initRunning: Promise<void> | null = null;

/** Never two at once on one connection: a second BEGIN inside the first migration fails. */
export function initDatabase(db: SQLiteDatabase): Promise<void> {
  if (!initRunning) initRunning = runInit(db).finally(() => (initRunning = null));
  return initRunning;
}

async function runInit(db: SQLiteDatabase): Promise<void> {
  // sync writes on its own connection (src/sync/app.ts): wait for it instead of failing
  await db.execAsync('PRAGMA busy_timeout = 10000;');
  await migrate(db);
  const device = getDevice();
  await ensureDevice(db, writer(device), device.role);
}
