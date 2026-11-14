/** firestore.rules must allow exactly the tables the app syncs. */
import { readFileSync } from 'fs';
import { join } from 'path';

import { SYNC_TABLE_NAMES } from '../tables';

it('firestore.rules lists every synced table, and only those', () => {
  const rules = readFileSync(join(__dirname, '../../../firestore.rules'), 'utf8');
  const list = /table in \[([^\]]*)\]/.exec(rules)?.[1] ?? '';
  const tables = [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  expect([...tables].sort()).toEqual([...SYNC_TABLE_NAMES].sort());
  expect(rules).toMatch(/allow delete: if false/);
});
