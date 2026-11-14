/**
 * SQLite schema + migrations (docs/Plan.md › Tech › Table).
 * Pure TS: no RN/Expo imports, so it is unit-tested in Node (see __tests__).
 *
 * Rules (CLAUDE.md):
 * - every row: id (UUID), device_id, updated_at (+ created_at)
 * - entries (purchases, sales, ledger, expenses, owner_withdrawals, day_close) are
 *   append-only: UPDATE/DELETE abort; a correction is a new row with corrects_id
 * - stock is never stored: stock = purchases − sales (v_stock)
 * - money is integer poisha (৳1 = 100), quantities are REAL in the product's unit
 *
 * Migrations only ever append: never edit a shipped one, add a new entry.
 */

/** Columns every row has. */
const ROW = `
  id TEXT PRIMARY KEY NOT NULL,
  device_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL`;

/** Extra columns every entry (append-only ledger-style row) has. */
const entry = (table: string) => `
  corrects_id TEXT REFERENCES ${table}(id),
  voice_log_id TEXT REFERENCES voice_logs(id),
  device_name TEXT NOT NULL,${ROW}`;

export const ENTRY_TABLES = [
  'purchases',
  'sales',
  'ledger',
  'expenses',
  'owner_withdrawals',
  'day_close',
] as const;

/** The DELETE guard on its own: wipePilotData drops and re-creates it. */
export const noDeleteTrigger = (table: string) => `CREATE TRIGGER ${table}_no_delete BEFORE DELETE ON ${table}
BEGIN SELECT RAISE(ABORT, '${table} is append-only: insert a correction row with corrects_id'); END;`;

const appendOnly = (table: string) => `
CREATE TRIGGER ${table}_no_update BEFORE UPDATE ON ${table}
BEGIN SELECT RAISE(ABORT, '${table} is append-only: insert a correction row with corrects_id'); END;
${noDeleteTrigger(table)}
CREATE INDEX ${table}_corrects ON ${table}(corrects_id);
CREATE INDEX ${table}_created ON ${table}(created_at);
-- rows not replaced by a later correction
CREATE VIEW v_${table} AS
  SELECT * FROM ${table} t WHERE NOT EXISTS (SELECT 1 FROM ${table} c WHERE c.corrects_id = t.id);
`;

const UNITS = `('kg','g','litre','ml','piece','packet','dozen','hali','bosta')`;

const V1 = `
CREATE TABLE devices (
  device_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('owner','staff')),${ROW}
);

CREATE TABLE products (
  name TEXT NOT NULL,
  unit TEXT NOT NULL CHECK (unit IN ${UNITS}),
  sell_price_poisha INTEGER,
  archived INTEGER NOT NULL DEFAULT 0,${ROW}
);
CREATE INDEX products_name ON products(name);

CREATE TABLE product_aliases (
  alias TEXT NOT NULL,
  product_id TEXT NOT NULL REFERENCES products(id),${ROW}
);
CREATE INDEX product_aliases_alias ON product_aliases(alias);

-- customers now; suppliers (মহাজন) use the same table from Phase 3
CREATE TABLE customers (
  name TEXT NOT NULL,
  phone TEXT,
  party_type TEXT NOT NULL DEFAULT 'customer' CHECK (party_type IN ('customer','supplier')),
  archived INTEGER NOT NULL DEFAULT 0,${ROW}
);
CREATE INDEX customers_name ON customers(name);

CREATE TABLE voice_logs (
  transcript TEXT NOT NULL,
  parsed_json TEXT,
  audio_path TEXT,
  drive_file_id TEXT,
  audio_status TEXT NOT NULL DEFAULT 'none' CHECK (audio_status IN ('none','local','uploaded','expired')),
  device_name TEXT NOT NULL,${ROW}
);
CREATE INDEX voice_logs_created ON voice_logs(created_at);

CREATE TABLE purchases (
  product_id TEXT NOT NULL REFERENCES products(id),
  quantity REAL NOT NULL,
  spoken_unit TEXT CHECK (spoken_unit IS NULL OR spoken_unit IN ${UNITS}),
  buy_price_poisha INTEGER NOT NULL,          -- per product unit
  sell_price_poisha INTEGER,                  -- per unit, if said ("বেচা ৬০")
  total_poisha INTEGER NOT NULL,
  paid_cash INTEGER NOT NULL DEFAULT 1 CHECK (paid_cash IN (0,1)),  -- নগদ কেনা lowers cash
  party_id TEXT REFERENCES customers(id),     -- supplier, Phase 3
  ${entry('purchases')}
);
CREATE INDEX purchases_product ON purchases(product_id);

CREATE TABLE sales (
  product_id TEXT NOT NULL REFERENCES products(id),
  quantity REAL NOT NULL,
  spoken_unit TEXT CHECK (spoken_unit IS NULL OR spoken_unit IN ${UNITS}),
  sell_price_poisha INTEGER NOT NULL,         -- per product unit
  amount_poisha INTEGER NOT NULL,             -- total
  cost_price_poisha INTEGER NOT NULL,         -- buy price per unit at the time of sale (profit)
  credit INTEGER NOT NULL DEFAULT 0 CHECK (credit IN (0,1)),
  customer_id TEXT REFERENCES customers(id),
  ${entry('sales')},
  CHECK (credit = 0 OR customer_id IS NOT NULL)
);
CREATE INDEX sales_product ON sales(product_id);

CREATE TABLE ledger (
  party_id TEXT NOT NULL REFERENCES customers(id),
  party_type TEXT NOT NULL DEFAULT 'customer' CHECK (party_type IN ('customer','supplier')),
  kind TEXT NOT NULL CHECK (kind IN ('baki','joma')),
  amount_poisha INTEGER NOT NULL,
  sale_id TEXT REFERENCES sales(id),          -- credit sale → its baki row
  ${entry('ledger')}
);
CREATE INDEX ledger_party ON ledger(party_id);

CREATE TABLE expenses (
  item TEXT NOT NULL,
  amount_poisha INTEGER NOT NULL,
  person TEXT,                                -- staff advance ("অগ্রিম বেতন")
  note TEXT,
  ${entry('expenses')}
);

CREATE TABLE owner_withdrawals (
  person TEXT,
  amount_poisha INTEGER NOT NULL,
  note TEXT,
  ${entry('owner_withdrawals')}
);

-- opening = Setup step ৩; close = "দিন শেষ করুন" (counted cash is the next opening)
CREATE TABLE day_close (
  business_date TEXT NOT NULL,                -- YYYY-MM-DD, shop's local date
  kind TEXT NOT NULL CHECK (kind IN ('opening','close')),
  opening_cash_poisha INTEGER NOT NULL,
  expected_cash_poisha INTEGER,
  counted_cash_poisha INTEGER,
  note_counts_json TEXT,                      -- {"1000":5,"500":4,...}
  ${entry('day_close')}
);

${ENTRY_TABLES.map(appendOnly).join('\n')}

CREATE VIEW v_stock AS
  SELECT p.id AS product_id, p.name, p.unit,
    COALESCE((SELECT SUM(quantity) FROM v_purchases WHERE product_id = p.id), 0)
      - COALESCE((SELECT SUM(quantity) FROM v_sales WHERE product_id = p.id), 0) AS stock
  FROM products p WHERE p.archived = 0;
`;

/** v2 (build step 2): pilot debug log on voice_logs; sales before any purchase have unknown cost. */
const V2 = `
ALTER TABLE voice_logs ADD COLUMN source TEXT NOT NULL DEFAULT 'voice' CHECK (source IN ('voice','typed'));
ALTER TABLE voice_logs ADD COLUMN context_tab TEXT;
ALTER TABLE voice_logs ADD COLUMN alternatives_json TEXT;   -- other STT guesses
ALTER TABLE voice_logs ADD COLUMN stt_error TEXT;           -- no-speech, network, ...
-- pending → saved | saved_edited | cancelled | unsupported | stt_error
ALTER TABLE voice_logs ADD COLUMN outcome TEXT NOT NULL DEFAULT 'pending'
  CHECK (outcome IN ('pending','saved','saved_edited','cancelled','unsupported','stt_error'));
ALTER TABLE voice_logs ADD COLUMN edits_json TEXT;          -- fields the user changed on the confirm card
ALTER TABLE voice_logs ADD COLUMN entry_table TEXT;
ALTER TABLE voice_logs ADD COLUMN entry_id TEXT;
ALTER TABLE sales ADD COLUMN cost_known INTEGER NOT NULL DEFAULT 1 CHECK (cost_known IN (0,1));
`;

/** v3: multi-item sales. Lines of one basket share basket_id; a credit basket has one baki row. */
const V3 = `
ALTER TABLE sales ADD COLUMN basket_id TEXT;
CREATE INDEX sales_basket ON sales(basket_id);
ALTER TABLE ledger ADD COLUMN basket_id TEXT;
ALTER TABLE voice_logs ADD COLUMN final_json TEXT;        -- the saved lines (pilot log)
`;

/** v4: line order inside a basket; the pilot reviewer's "did STT hear it right?" mark. */
const V4 = `
ALTER TABLE sales ADD COLUMN line_no INTEGER;                -- 1, 2, 3 … within basket_id
ALTER TABLE voice_logs ADD COLUMN stt_ok INTEGER CHECK (stt_ok IS NULL OR stt_ok IN (0,1));
`;

/**
 * v5 (build step 3): the shop's name (one row, id 'shop', so every phone's copy merges on
 * sync), and voice_logs.via = 'pick' for ছবি দেখে entries (kept out of the parser accuracy).
 * The opening cash from Setup is a day_close 'opening' entry (table from v1).
 */
const V5 = `
CREATE TABLE shop (
  name TEXT NOT NULL,${ROW}
);
ALTER TABLE voice_logs ADD COLUMN via TEXT CHECK (via IS NULL OR via IN ('pick'));
`;

/**
 * v6 (build step 4a): every intent is saved now, so each log records its intent (the
 * parsed one, then the confirmed one) for the eval. Old pilot logs get it from parsed_json.
 */
const V6 = `
ALTER TABLE voice_logs ADD COLUMN intent TEXT;
UPDATE voice_logs SET intent = json_extract(parsed_json, '$.intent') WHERE parsed_json IS NOT NULL;
`;

/**
 * v7: Gemini audio (optional engine) next to Android STT + rule parser.
 * engine = the setting when the command was spoken (null = before v7, android);
 * parsed_by = whose result the confirm card showed (parsed_json stays "what was shown");
 * android_json / gemini_json = each engine's result; Gemini's transcript, error, latency
 * and tokens. All nullable: unused when the build has no Gemini key.
 */
const V7 = `
ALTER TABLE voice_logs ADD COLUMN engine TEXT CHECK (engine IS NULL OR engine IN ('android','gemini','both'));
ALTER TABLE voice_logs ADD COLUMN parsed_by TEXT CHECK (parsed_by IS NULL OR parsed_by IN ('android','gemini'));
ALTER TABLE voice_logs ADD COLUMN android_json TEXT;
ALTER TABLE voice_logs ADD COLUMN gemini_json TEXT;
ALTER TABLE voice_logs ADD COLUMN gemini_transcript TEXT;
ALTER TABLE voice_logs ADD COLUMN gemini_error TEXT;
ALTER TABLE voice_logs ADD COLUMN gemini_model TEXT;
ALTER TABLE voice_logs ADD COLUMN gemini_ms INTEGER;
ALTER TABLE voice_logs ADD COLUMN gemini_prompt_tokens INTEGER;
ALTER TABLE voice_logs ADD COLUMN gemini_audio_tokens INTEGER;
ALTER TABLE voice_logs ADD COLUMN gemini_output_tokens INTEGER;
ALTER TABLE voice_logs ADD COLUMN gemini_thought_tokens INTEGER;
`;

/**
 * v8: customers.note — what the list import (ক্রেতার তালিকা আনুন) takes off a name
 * ("ভাই", "মসজিদের পাশে"), so the name stays clean for matching.
 */
const V8 = `
ALTER TABLE customers ADD COLUMN note TEXT;
`;

/**
 * v9: customer_aliases — another spelling of a customer ("কোরিম" → করিম), learned when
 * a heard name is corrected to, or picked as, an existing customer. Like product_aliases.
 */
const V9 = `
CREATE TABLE customer_aliases (
  alias TEXT NOT NULL,
  customer_id TEXT NOT NULL REFERENCES customers(id),${ROW}
);
CREATE INDEX customer_aliases_alias ON customer_aliases(alias);
`;

/** The v_<table> view from v10 on: latest version, not voided, with `at` = when it happened. */
const latestView = (table: string) => `
CREATE VIEW v_${table} AS
  SELECT t.*, COALESCE(t.entry_at, t.created_at) AS at FROM ${table} t
  WHERE t.voided = 0 AND NOT EXISTS (SELECT 1 FROM ${table} c WHERE c.corrects_id = t.id);`;

const V_STOCK = `
CREATE VIEW v_stock AS
  SELECT p.id AS product_id, p.name, p.unit,
    COALESCE((SELECT SUM(quantity) FROM v_purchases WHERE product_id = p.id), 0)
      - COALESCE((SELECT SUM(quantity) FROM v_sales WHERE product_id = p.id), 0) AS stock
  FROM products p WHERE p.archived = 0;`;

/**
 * v10 (build step 5): corrections and undo.
 * - voided = 1: the correction that cancels an entry (✏️ মুছুন, "ভুল হয়েছে"). It copies the
 *   old values; the v_ views leave the entry out from then on.
 * - entry_at: when the entry happened. A correction copies its original's time, so fixing
 *   yesterday's sale today keeps it in yesterday's cash and history. null = created_at
 *   (every row before v10, and new rows). The views expose it as `at`.
 * Views are dropped and made again with the voided filter (v_stock reads two of them).
 */
const V10 = `
DROP VIEW v_stock;
${ENTRY_TABLES.map((t) => `DROP VIEW v_${t};`).join('\n')}
${ENTRY_TABLES.map(
  (t) => `ALTER TABLE ${t} ADD COLUMN voided INTEGER NOT NULL DEFAULT 0 CHECK (voided IN (0,1));
ALTER TABLE ${t} ADD COLUMN entry_at INTEGER;`,
).join('\n')}
${ENTRY_TABLES.map(latestView).join('\n')}
${V_STOCK}
`;

/**
 * From v11: the effective version of an entry. Rows of one correction chain share root_id;
 * rev = depth in the chain. The winner is the deepest row (latest created on a tie, then id),
 * so two phones correcting the same entry offline (two rows with the same corrects_id) keep
 * both rows in history but count once: the later correction. Rows nothing corrects and with
 * no newer row in their chain; voided = cancelled.
 */
const forkSafeView = (table: string) => `
CREATE VIEW v_${table} AS
  SELECT t.*, COALESCE(t.entry_at, t.created_at) AS at FROM ${table} t
  WHERE t.voided = 0
    AND NOT EXISTS (SELECT 1 FROM ${table} c WHERE c.corrects_id = t.id)
    AND NOT EXISTS (SELECT 1 FROM ${table} c WHERE c.root_id = t.root_id AND c.id <> t.id
      AND (c.rev > t.rev OR (c.rev = t.rev AND (c.created_at > t.created_at OR (c.created_at = t.created_at AND c.id > t.id)))));`;

/**
 * root_id / rev are filled by an AFTER INSERT trigger (local rows and rows pulled from other
 * phones alike, so they are never synced). The append-only UPDATE guard lets exactly that one
 * fill through (root_id still null) and blocks every other update.
 */
const rootFill = (table: string) => `
CREATE TRIGGER ${table}_root AFTER INSERT ON ${table} WHEN NEW.root_id IS NULL
BEGIN
  UPDATE ${table} SET
    root_id = COALESCE((SELECT p.root_id FROM ${table} p WHERE p.id = NEW.corrects_id), NEW.id),
    rev = COALESCE((SELECT p.rev + 1 FROM ${table} p WHERE p.id = NEW.corrects_id), 0)
  WHERE id = NEW.id;
END;
CREATE TRIGGER ${table}_no_update BEFORE UPDATE ON ${table} WHEN OLD.root_id IS NOT NULL
BEGIN SELECT RAISE(ABORT, '${table} is append-only: insert a correction row with corrects_id'); END;
CREATE INDEX ${table}_root ON ${table}(root_id);`;

const backfillRoot = (table: string) => `
ALTER TABLE ${table} ADD COLUMN root_id TEXT;
ALTER TABLE ${table} ADD COLUMN rev INTEGER;
UPDATE ${table} SET root_id = ch.root, rev = ch.depth FROM (
  WITH RECURSIVE chain(id, root, depth) AS (
    SELECT id, id, 0 FROM ${table} WHERE corrects_id IS NULL
    UNION ALL
    SELECT c.id, chain.root, chain.depth + 1 FROM ${table} c JOIN chain ON c.corrects_id = chain.id
  ) SELECT * FROM chain
) ch WHERE ${table}.id = ch.id;`;

/**
 * v11 (build step 7): multi-phone sync.
 * - root_id / rev on entries + fork-safe v_ views (see forkSafeView).
 * - products / customers.merged_into: "এই দুইটা কি একই?" merge. The duplicate is archived
 *   and points at the one kept; its entries are re-pointed by correction rows.
 * - sync bookkeeping, local only (never synced): sync_state = what this phone last pushed of
 *   each row (an entry can't take an UPDATE, so "synced_at" lives here, not on the row);
 *   sync_meta = cursors, account, counters; sync_inbox = pulled rows waiting to be applied
 *   (e.g. a sale whose product hasn't arrived yet).
 */
const V11 = `
DROP VIEW v_stock;
${ENTRY_TABLES.map((t) => `DROP VIEW v_${t};\nDROP TRIGGER ${t}_no_update;`).join('\n')}
${ENTRY_TABLES.map(backfillRoot).join('\n')}
${ENTRY_TABLES.map(rootFill).join('\n')}
${ENTRY_TABLES.map(forkSafeView).join('\n')}
${V_STOCK}
ALTER TABLE products ADD COLUMN merged_into TEXT REFERENCES products(id);
ALTER TABLE customers ADD COLUMN merged_into TEXT REFERENCES customers(id);
CREATE TABLE sync_state (
  tbl TEXT NOT NULL,
  row_id TEXT NOT NULL,
  pushed_at INTEGER NOT NULL,                 -- the row's updated_at when last pushed / pulled
  PRIMARY KEY (tbl, row_id)
) WITHOUT ROWID;
CREATE TABLE sync_meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT
) WITHOUT ROWID;
CREATE TABLE sync_inbox (
  tbl TEXT NOT NULL,
  row_id TEXT NOT NULL,
  data_json TEXT NOT NULL,
  server_at INTEGER NOT NULL,
  PRIMARY KEY (tbl, row_id)
) WITHOUT ROWID;
`;

/**
 * Index i holds the SQL that takes the DB from user_version i to i + 1.
 * Append only; never edit or renumber a shipped one.
 */
export const MIGRATIONS: readonly string[] = [V1, V2, V3, V4, V5, V6, V7, V8, V9, V10, V11];

/**
 * Nov 14 fork: an early main build shipped v7 = customers.note (no Gemini columns) while
 * exp/gemini-audio had v7 = Gemini columns. Both now continue from v8 = V7 + V8 above.
 * A DB at version 7 gets whichever of the two column sets it lacks, then counts as v8.
 */
const FORK_VERSION = 7;
const FORK_FIX_TO = 8;

export const SCHEMA_VERSION = MIGRATIONS.length;

/** The two calls migrate() needs; expo-sqlite's SQLiteDatabase satisfies it. */
export interface MigratableDb {
  execAsync(sql: string): Promise<void>;
  getFirstAsync<T>(sql: string): Promise<T | null>;
}

/**
 * Bring the DB up to SCHEMA_VERSION. Each step runs in its own transaction
 * together with its user_version bump, so a failed step leaves the DB at the
 * previous version. Returns the version the DB was at before.
 */
export async function migrate(db: MigratableDb): Promise<number> {
  // journal_mode can't change inside a transaction; foreign_keys is per connection
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const from = row?.user_version ?? 0;
  if (from > SCHEMA_VERSION) {
    throw new Error(`DB version ${from} is newer than this app (${SCHEMA_VERSION}); update the app`);
  }
  let start = from;
  if (from === FORK_VERSION) start = await repairForkedV7(db);
  for (let v = start; v < SCHEMA_VERSION; v++) {
    await db.execAsync('BEGIN;');
    try {
      await db.execAsync(`${MIGRATIONS[v]}\nPRAGMA user_version = ${v + 1};`);
      await db.execAsync('COMMIT;');
    } catch (e) {
      await db.execAsync('ROLLBACK;');
      throw e;
    }
  }
  return from;
}

const hasColumn = async (db: MigratableDb, table: string, column: string) =>
  ((await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM pragma_table_info('${table}') WHERE name = '${column}'`))?.n ?? 0) > 0;

/** See FORK_VERSION. Returns the version to continue from. */
async function repairForkedV7(db: MigratableDb): Promise<number> {
  const hasGemini = await hasColumn(db, 'voice_logs', 'engine');
  const hasNote = await hasColumn(db, 'customers', 'note');
  // plain v7 (Gemini columns, no note): the normal v8 step adds the note
  if (hasGemini && !hasNote) return FORK_VERSION;
  await db.execAsync('BEGIN;');
  try {
    await db.execAsync(`${hasGemini ? '' : V7}${hasNote ? '' : V8}\nPRAGMA user_version = ${FORK_FIX_TO};`);
    await db.execAsync('COMMIT;');
  } catch (e) {
    await db.execAsync('ROLLBACK;');
    throw e;
  }
  return FORK_FIX_TO;
}
