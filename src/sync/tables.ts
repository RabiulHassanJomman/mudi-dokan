/**
 * What syncs, in which order and how (docs/Plan.md › Status › step 7).
 * Pure TS: no RN imports.
 *
 * Firestore path: shops/{uid}/{table}/{rowId}. SQLite stays the source of truth.
 * - entry tables are append-only: union by UUID, never a conflict.
 * - mutable tables: last write wins on updated_at (tie: the larger device_id).
 * Stock, balances and cash are never synced as numbers: they are recomputed from entries.
 */
import { ENTRY_TABLES } from '../db/migrations';

export type SyncKind = 'entry' | 'mutable';

export interface SyncTable {
  name: string;
  kind: SyncKind;
  /** Columns that stay on this phone: never pushed, never overwritten by a pull. */
  localOnly: readonly string[];
}

const ENTRY_LOCAL = ['root_id', 'rev'] as const;

/** Parents before children, so a pulled row's foreign keys usually exist already. */
export const SYNC_TABLES: readonly SyncTable[] = [
  { name: 'shop', kind: 'mutable', localOnly: [] },
  { name: 'devices', kind: 'mutable', localOnly: [] },
  { name: 'products', kind: 'mutable', localOnly: [] },
  { name: 'customers', kind: 'mutable', localOnly: [] },
  { name: 'product_aliases', kind: 'mutable', localOnly: [] },
  { name: 'customer_aliases', kind: 'mutable', localOnly: [] },
  // metadata only: the audio file is on the phone that heard it (Drive upload = step 8)
  { name: 'voice_logs', kind: 'mutable', localOnly: ['audio_path'] },
  ...ENTRY_TABLES.map((name) => ({ name, kind: 'entry' as const, localOnly: ENTRY_LOCAL })),
];

export const SYNC_TABLE_NAMES: readonly string[] = SYNC_TABLES.map((t) => t.name);

export const tableSpec = (name: string): SyncTable | undefined => SYNC_TABLES.find((t) => t.name === name);

/** Spark (free) plan: 20K writes / 50K reads a day. Push stops a bit before the limit. */
export const DAILY_WRITE_BUDGET = 18_000;
/** Firestore allows 500 writes per batch. */
export const BATCH_SIZE = 400;
/** Pull re-asks this far back from the cursor, in case a commit became visible late. */
export const PULL_OVERLAP_MS = 2 * 60_000;
