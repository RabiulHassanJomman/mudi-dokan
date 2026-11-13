import type { SQLiteDatabase } from 'expo-sqlite';

import { migrate } from './migrations';

export const DATABASE_NAME = 'mudi-dokan.db';

/** SQLiteProvider onInit: runs before any screen touches the DB. */
export async function initDatabase(db: SQLiteDatabase): Promise<void> {
  await migrate(db);
}
