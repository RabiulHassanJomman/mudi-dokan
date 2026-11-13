/**
 * Pilot log export → eval/fixtures.jsonl (source "pilot", the held-out set).
 * Mac-only dev tool, never bundled in the app.
 *
 *   npm run eval:import -- pilot.jsonl [--no-seed] [--dry-run]
 *
 * Takes the app's "শেয়ার" export (one JSON object) or JSONL. Only confirmed entries
 * (saved / saved_edited) with a transcript; STT marked ভুল is skipped. Same text + tab
 * as an existing fixture (any source) or the same pilot id = duplicate, skipped.
 * Products/customers the shop confirmed are added to eval/seed.json (--no-seed: don't).
 */
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fixtureKey, type Fixture, type Seed } from './eval-types';
import { fixtureFromLog, readPilotLogs, seedAdditions, type SkipReason } from './pilot-fixtures';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = join(ROOT, 'eval/fixtures.jsonl');
const SEED = join(ROOT, 'eval/seed.json');

const args = process.argv.slice(2);
const files = args.filter((a) => !a.startsWith('--'));
const noSeed = args.includes('--no-seed');
const dryRun = args.includes('--dry-run');
if (!files.length) {
  console.error('usage: npm run eval:import -- <pilot export .json/.jsonl> [--no-seed] [--dry-run]');
  process.exit(1);
}

const existing = readFileSync(FIXTURES, 'utf8')
  .split('\n')
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l) as Fixture);
const seen = new Set(existing.map((f) => fixtureKey(f.text, f.tab)));
const seenIds = new Set(existing.map((f) => f.pilot_id).filter(Boolean));

const logs = files.flatMap((f) => readPilotLogs(readFileSync(f, 'utf8')));
const added: Fixture[] = [];
const skipped: Record<SkipReason | 'duplicate', number> = { not_saved: 0, no_transcript: 0, stt_wrong: 0, no_result: 0, duplicate: 0 };
for (const log of logs) {
  const r = fixtureFromLog(log);
  if ('skip' in r) {
    skipped[r.skip]++;
    continue;
  }
  const key = fixtureKey(r.fixture.text, r.fixture.tab);
  if (seen.has(key) || (r.fixture.pilot_id && seenIds.has(r.fixture.pilot_id))) {
    skipped.duplicate++;
    continue;
  }
  seen.add(key);
  if (r.fixture.pilot_id) seenIds.add(r.fixture.pilot_id);
  added.push(r.fixture);
}

if (!dryRun && added.length) appendFileSync(FIXTURES, added.map((f) => JSON.stringify(f)).join('\n') + '\n');

const seed = JSON.parse(readFileSync(SEED, 'utf8')) as Seed;
const extra = seedAdditions(seed, added, logs);
if (!noSeed && !dryRun && (extra.products.length || extra.customers.length)) {
  seed.products.push(...extra.products);
  seed.customers.push(...extra.customers);
  writeFileSync(SEED, JSON.stringify(seed, null, 2) + '\n');
}

const edited = added.filter((f) => f.edited).length;
const review = added.filter((f) => f.review);
console.log(`${logs.length} log entries → ${added.length} new pilot fixtures (${edited} edited on the confirm card)${dryRun ? ' [dry run]' : ''}`);
const skips = Object.entries(skipped).filter(([, n]) => n);
if (skips.length) console.log(`skipped: ${skips.map(([k, n]) => `${k} ${n}`).join(', ')}`);
if (!noSeed && (extra.products.length || extra.customers.length))
  console.log(
    `seed${dryRun ? ' would get' : ' +'} ${extra.products.length} products, ${extra.customers.length} customers` +
      (extra.products.length ? ` (${extra.products.map((p) => p.name).join(', ')})` : ''),
  );
if (review.length) {
  console.log(`\ncheck by ear (${review.length}), the import was unsure:`);
  for (const f of review) console.log(`  “${f.text}”: ${f.review!.join(', ')}`);
}
