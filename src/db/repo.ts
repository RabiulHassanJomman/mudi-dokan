/**
 * Reads and writes for build step 2 (sale + pilot log). Pure TS against a
 * small DB interface that expo-sqlite's SQLiteDatabase satisfies, so it is
 * tested on node:sqlite.
 */
import type { ProductInfo, SaleDraft } from '../domain/saleDraft';
import type { ParsedCommand, Unit } from '../parser/types';

type Bind = string | number | null;

export interface Db {
  runAsync(sql: string, ...params: Bind[]): Promise<unknown>;
  getFirstAsync<T>(sql: string, ...params: Bind[]): Promise<T | null>;
  getAllAsync<T>(sql: string, ...params: Bind[]): Promise<T[]>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
}

/** Who is writing: this phone. */
export interface Writer {
  deviceId: string;
  deviceName: string;
  newId(): string;
  now(): number;
}

const rowCols = (w: Writer) => {
  const t = w.now();
  return { device_id: w.deviceId, created_at: t, updated_at: t };
};

async function insert(db: Db, table: string, values: Record<string, Bind>): Promise<void> {
  const cols = Object.keys(values);
  await db.runAsync(
    `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    ...Object.values(values),
  );
}

// ── device ─────────────────────────────────────────────────────

export async function ensureDevice(db: Db, w: Writer, role: 'owner' | 'staff' | null): Promise<void> {
  const exists = await db.getFirstAsync<{ id: string }>('SELECT id FROM devices WHERE id = ?', w.deviceId);
  if (exists) return;
  await insert(db, 'devices', {
    id: w.deviceId,
    device_name: w.deviceName,
    role: role ?? 'staff',
    ...rowCols(w),
  });
}

// ── products & customers ───────────────────────────────────────

export async function knownNames(db: Db): Promise<{ products: string[]; customers: string[] }> {
  const products = await db.getAllAsync<{ n: string }>(
    'SELECT name AS n FROM products WHERE archived = 0 UNION SELECT alias FROM product_aliases',
  );
  const customers = await db.getAllAsync<{ n: string }>(
    "SELECT name AS n FROM customers WHERE archived = 0 AND party_type = 'customer'",
  );
  return { products: products.map((r) => r.n), customers: customers.map((r) => r.n) };
}

interface ProductRow {
  id: string;
  name: string;
  unit: Unit;
  sell_price_poisha: number | null;
  cost: number | null;
}

/** By exact name or alias. Cost = weighted average buy price of effective purchases. */
export async function findProduct(db: Db, name: string): Promise<ProductInfo | null> {
  const r = await db.getFirstAsync<ProductRow>(
    `SELECT p.id, p.name, p.unit, p.sell_price_poisha,
       (SELECT CAST(ROUND(SUM(buy_price_poisha * quantity) / SUM(quantity)) AS INTEGER)
          FROM v_purchases WHERE product_id = p.id AND quantity > 0) AS cost
     FROM products p
     WHERE p.archived = 0 AND (p.name = ? OR p.id IN (SELECT product_id FROM product_aliases WHERE alias = ?))
     ORDER BY p.created_at LIMIT 1`,
    name,
    name,
  );
  if (!r) return null;
  return { id: r.id, name: r.name, unit: r.unit, sellPricePoisha: r.sell_price_poisha, costPricePoisha: r.cost };
}

async function findOrCreateCustomer(db: Db, w: Writer, name: string): Promise<string> {
  const r = await db.getFirstAsync<{ id: string }>(
    "SELECT id FROM customers WHERE name = ? AND party_type = 'customer' AND archived = 0 ORDER BY created_at LIMIT 1",
    name,
  );
  if (r) return r.id;
  const id = w.newId();
  await insert(db, 'customers', { id, name, party_type: 'customer', ...rowCols(w) });
  return id;
}

// ── voice log (pilot debug log) ────────────────────────────────

export type Outcome = 'pending' | 'saved' | 'saved_edited' | 'cancelled' | 'unsupported' | 'stt_error';

export interface NewVoiceLog {
  transcript: string;
  source: 'voice' | 'typed';
  contextTab: string;
  alternatives?: string[];
  audioPath?: string | null;
  parsed?: ParsedCommand | null;
  sttError?: string | null;
}

export async function createVoiceLog(db: Db, w: Writer, v: NewVoiceLog): Promise<string> {
  const id = w.newId();
  await insert(db, 'voice_logs', {
    id,
    transcript: v.transcript,
    parsed_json: v.parsed ? JSON.stringify(v.parsed) : null,
    audio_path: v.audioPath ?? null,
    audio_status: v.audioPath ? 'local' : 'none',
    source: v.source,
    context_tab: v.contextTab,
    alternatives_json: v.alternatives?.length ? JSON.stringify(v.alternatives) : null,
    stt_error: v.sttError ?? null,
    outcome: v.sttError ? 'stt_error' : 'pending',
    device_name: w.deviceName,
    ...rowCols(w),
  });
  return id;
}

export interface VoiceLogRow {
  id: string;
  transcript: string;
  source: 'voice' | 'typed';
  parsed_json: string | null;
  audio_path: string | null;
  alternatives_json: string | null;
  stt_error: string | null;
  outcome: Outcome;
  edits_json: string | null;
  entry_table: string | null;
  entry_id: string | null;
  created_at: number;
}

export const getVoiceLog = (db: Db, id: string) =>
  db.getFirstAsync<VoiceLogRow>('SELECT * FROM voice_logs WHERE id = ?', id);

export async function setParsed(db: Db, w: Writer, id: string, parsed: ParsedCommand): Promise<void> {
  await db.runAsync('UPDATE voice_logs SET parsed_json = ?, updated_at = ? WHERE id = ?', JSON.stringify(parsed), w.now(), id);
}

/** Only a pending log changes outcome (a saved entry is never "un-saved" by leaving the screen). */
export async function setOutcome(
  db: Db,
  w: Writer,
  id: string,
  outcome: Exclude<Outcome, 'pending'>,
  extra: { edits?: string[]; entryTable?: string; entryId?: string } = {},
): Promise<void> {
  await db.runAsync(
    `UPDATE voice_logs SET outcome = ?, edits_json = ?, entry_table = ?, entry_id = ?, updated_at = ?
     WHERE id = ? AND outcome = 'pending'`,
    outcome,
    extra.edits?.length ? JSON.stringify(extra.edits) : null,
    extra.entryTable ?? null,
    extra.entryId ?? null,
    w.now(),
    id,
  );
}

// ── sale ───────────────────────────────────────────────────────

/**
 * Saves a confirmed sale in one transaction: the product (if new), the
 * customer and a baki ledger row (if on credit), the sale, and the log outcome.
 */
export async function saveSale(
  db: Db,
  w: Writer,
  d: SaleDraft,
  voiceLogId: string,
  edits: string[],
): Promise<string> {
  if (d.problems.length || !d.productName || d.quantity === null || d.pricePoisha === null || d.amountPoisha === null) {
    throw new Error(`sale draft is not complete: ${d.problems.join(', ')}`);
  }
  const saleId = w.newId();
  await db.withTransactionAsync(async () => {
    let productId = d.product?.id;
    if (!productId) {
      productId = w.newId();
      await insert(db, 'products', {
        id: productId,
        name: d.productName,
        unit: d.unit,
        sell_price_poisha: d.pricePoisha,
        ...rowCols(w),
      });
    }
    const customerId = d.credit && d.customerName ? await findOrCreateCustomer(db, w, d.customerName) : null;
    const cost = d.product?.costPricePoisha ?? null;
    const entry = { voice_log_id: voiceLogId, device_name: w.deviceName, ...rowCols(w) };

    await insert(db, 'sales', {
      id: saleId,
      product_id: productId,
      quantity: d.quantity,
      spoken_unit: d.unit,
      sell_price_poisha: d.pricePoisha,
      amount_poisha: d.amountPoisha,
      cost_price_poisha: cost ?? 0,
      cost_known: cost === null ? 0 : 1,
      credit: d.credit ? 1 : 0,
      customer_id: customerId,
      ...entry,
    });
    if (customerId) {
      await insert(db, 'ledger', {
        id: w.newId(),
        party_id: customerId,
        party_type: 'customer',
        kind: 'baki',
        amount_poisha: d.amountPoisha,
        sale_id: saleId,
        ...entry,
      });
    }
    await setOutcome(db, w, voiceLogId, edits.length ? 'saved_edited' : 'saved', {
      edits,
      entryTable: 'sales',
      entryId: saleId,
    });
  });
  return saleId;
}

export interface RecentSale {
  id: string;
  product: string;
  quantity: number;
  unit: Unit;
  amount_poisha: number;
  credit: number;
  customer: string | null;
  voice_log_id: string | null;
  audio_path: string | null;
  created_at: number;
}

export const recentSales = (db: Db, limit = 3) =>
  db.getAllAsync<RecentSale>(
    `SELECT s.id, p.name AS product, s.quantity, p.unit, s.amount_poisha, s.credit,
            c.name AS customer, s.voice_log_id, v.audio_path, s.created_at
     FROM v_sales s
     JOIN products p ON p.id = s.product_id
     LEFT JOIN customers c ON c.id = s.customer_id
     LEFT JOIN voice_logs v ON v.id = s.voice_log_id
     ORDER BY s.created_at DESC LIMIT ?`,
    limit,
  );

/** Today's total sales and credit (shop-local day starts at `dayStart`). */
export async function todayTotals(db: Db, dayStart: number): Promise<{ sales: number; baki: number }> {
  const r = await db.getFirstAsync<{ sales: number | null; baki: number | null }>(
    `SELECT SUM(amount_poisha) AS sales, SUM(CASE WHEN credit = 1 THEN amount_poisha END) AS baki
     FROM v_sales WHERE created_at >= ?`,
    dayStart,
  );
  return { sales: r?.sales ?? 0, baki: r?.baki ?? 0 };
}

// ── pilot stats & export ───────────────────────────────────────

export interface PilotStats {
  total: number;
  saved: number;
  edited: number;
  cancelled: number;
  unsupported: number;
  sttError: number;
  /** saved without edits ÷ (saved + edited + cancelled). The pilot target is 80%. */
  accuracy: number | null;
}

export async function pilotStats(db: Db, since = 0): Promise<PilotStats> {
  const rows = await db.getAllAsync<{ outcome: Outcome; n: number }>(
    'SELECT outcome, COUNT(*) AS n FROM voice_logs WHERE created_at >= ? GROUP BY outcome',
    since,
  );
  const n = (o: Outcome) => rows.find((r) => r.outcome === o)?.n ?? 0;
  // pending = left the confirm card without deciding: counts as cancelled
  const s = {
    saved: n('saved'),
    edited: n('saved_edited'),
    cancelled: n('cancelled') + n('pending'),
    unsupported: n('unsupported'),
    sttError: n('stt_error'),
  };
  const decided = s.saved + s.edited + s.cancelled;
  return {
    total: rows.reduce((a, r) => a + r.n, 0),
    ...s,
    accuracy: decided ? Math.round((s.saved / decided) * 100) : null,
  };
}

export const pilotLog = (db: Db, limit = 500) =>
  db.getAllAsync<VoiceLogRow>('SELECT * FROM voice_logs ORDER BY created_at DESC LIMIT ?', limit);
