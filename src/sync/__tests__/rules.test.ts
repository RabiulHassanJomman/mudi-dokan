/** firestore.rules must allow exactly the tables the app syncs (+ meta, the wipe tombstone). */
import { readFileSync } from 'fs';
import { join } from 'path';

import { SYNC_TABLE_NAMES } from '../tables';

const rules = readFileSync(join(__dirname, '../../../firestore.rules'), 'utf8');

it('firestore.rules lists every synced table, and only those plus meta', () => {
  const list = /table in \[([^\]]*)\]/.exec(rules)?.[1] ?? '';
  const tables = [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  expect([...tables].sort()).toEqual([...SYNC_TABLE_NAMES, 'meta'].sort());
});

it('only the shop account may delete (সব তথ্য মুছুন), never the wipe tombstone, never anyone else', () => {
  expect(rules).toMatch(/allow delete: if isShop\(\) && knownTable\(\) && table != 'meta'/);
  expect(rules).not.toMatch(/allow delete: if true/);
  expect(rules).toMatch(/request\.auth\.uid == uid/);
});
