import type { SQLiteDatabase } from 'expo-sqlite';

import { getDevice, writer } from '../device';
import { migrate } from './migrations';
import { ensureDevice } from './repo';

export const DATABASE_NAME = 'mudi-dokan.db';

/** SQLiteProvider onInit: runs before any screen touches the DB. */
export async function initDatabase(db: SQLiteDatabase): Promise<void> {
  await migrate(db);
  const device = getDevice();
  await ensureDevice(db, writer(device), device.role);
}
