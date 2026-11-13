/** Test helper: node:sqlite behind the same interface expo-sqlite gives the app. */
import type { DatabaseSync as DatabaseSyncT } from 'node:sqlite';

import { migrate } from '../migrations';
import type { Db, Writer } from '../repo';

// getBuiltinModule bypasses Jest's resolver, which doesn't know prefix-only builtins
const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite');

type Bind = string | number | null;

export function nodeDb(raw: DatabaseSyncT = new DatabaseSync(':memory:')): Db & { raw: DatabaseSyncT } {
  return {
    raw,
    execAsync: async (sql: string) => {
      raw.exec(sql);
    },
    runAsync: async (sql: string, ...p: Bind[]) => raw.prepare(sql).run(...p),
    getFirstAsync: async <T>(sql: string, ...p: Bind[]) => (raw.prepare(sql).get(...p) as T | undefined) ?? null,
    getAllAsync: async <T>(sql: string, ...p: Bind[]) => raw.prepare(sql).all(...p) as T[],
    withTransactionAsync: async (task: () => Promise<void>) => {
      raw.exec('BEGIN');
      try {
        await task();
        raw.exec('COMMIT');
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      }
    },
  } as Db & { raw: DatabaseSyncT; execAsync(sql: string): Promise<void> };
}

export async function migratedDb() {
  const db = nodeDb() as ReturnType<typeof nodeDb> & { execAsync(sql: string): Promise<void> };
  await migrate(db);
  return db;
}

export function testWriter(start = 1_763_000_000_000): Writer {
  let n = 0;
  let t = start;
  return { deviceId: 'dev-1', deviceName: 'আব্বু', newId: () => `id-${++n}`, now: () => (t += 1000) };
}
