/**
 * Reads and writes for build step 2 (sale + pilot log). Pure TS against a
 * small DB interface that expo-sqlite's SQLiteDatabase satisfies, so it is
 * tested on node:sqlite.
 */
import { basketSummary, storedLine, type BasketDraft, type ProductInfo } from '../domain/basket';
import { ENTRY_TABLES, noDeleteTrigger } from './migrations';
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

/** Each name that matches a product (by name or alias). Unknown names are left out. */
export async function findProducts(db: Db, names: readonly string[]): Promise<Map<string, ProductInfo>> {
  const found = new Map<string, ProductInfo>();
  for (const name of new Set(names.filter(Boolean))) {
    const p = await findProduct(db, name);
    if (p) found.set(name, p);
  }
  return found;
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
  /** The tab that was open (the command's default intent). */
  context_tab: string | null;
  parsed_json: string | null;
  audio_path: string | null;
  alternatives_json: string | null;
  stt_error: string | null;
  outcome: Outcome;
  edits_json: string | null;
  final_json: string | null;
  entry_table: string | null;
  entry_id: string | null;
  /** Pilot reviewer: 1 = STT heard it right, 0 = wrong, null = not checked. */
  stt_ok: number | null;
  created_at: number;
}

export const getVoiceLog = (db: Db, id: string) =>
  db.getFirstAsync<VoiceLogRow>('SELECT * FROM voice_logs WHERE id = ?', id);

export async function setParsed(db: Db, w: Writer, id: string, parsed: ParsedCommand): Promise<void> {
  await db.runAsync('UPDATE voice_logs SET parsed_json = ?, updated_at = ? WHERE id = ?', JSON.stringify(parsed), w.now(), id);
}

export async function setSttOk(db: Db, w: Writer, id: string, ok: boolean | null): Promise<void> {
  await db.runAsync('UPDATE voice_logs SET stt_ok = ?, updated_at = ? WHERE id = ?', ok === null ? null : ok ? 1 : 0, w.now(), id);
}

/** Only a pending log changes outcome (a saved entry is never "un-saved" by leaving the screen). */
export async function setOutcome(
  db: Db,
  w: Writer,
  id: string,
  outcome: Exclude<Outcome, 'pending'>,
  extra: { edits?: string[]; final?: unknown; entryTable?: string; entryId?: string } = {},
): Promise<void> {
  await db.runAsync(
    `UPDATE voice_logs SET outcome = ?, edits_json = ?, final_json = ?, entry_table = ?, entry_id = ?, updated_at = ?
     WHERE id = ? AND outcome = 'pending'`,
    outcome,
    extra.edits?.length ? JSON.stringify(extra.edits) : null,
    extra.final !== undefined ? JSON.stringify(extra.final) : null,
    extra.entryTable ?? null,
    extra.entryId ?? null,
    w.now(),
    id,
  );
}

// ── sale ───────────────────────────────────────────────────────

/**
 * Saves a confirmed basket in one transaction: new products (once per name),
 * one sale row per line sharing basket_id and voice_log_id, the customer and
 * one baki ledger row for the basket total (if on credit), and the log outcome.
 * Returns the basket id.
 */
export async function saveBasket(
  db: Db,
  w: Writer,
  b: BasketDraft,
  voiceLogId: string,
  edits: string[],
): Promise<string> {
  if (b.problems.length || b.totalPoisha === null) {
    throw new Error(`basket is not complete: ${b.problems.join(', ')}`);
  }
  const basketId = w.newId();
  await db.withTransactionAsync(async () => {
    const created = new Map<string, string>();
    const customerId = b.credit && b.customerName ? await findOrCreateCustomer(db, w, b.customerName) : null;
    const entry = () => ({ voice_log_id: voiceLogId, device_name: w.deviceName, ...rowCols(w) });
    let firstSaleId: string | null = null;

    for (const [n, it] of b.items.entries()) {
      if (!it.productName || it.quantity === null || it.amountPoisha === null) {
        throw new Error(`basket line ${it.key} is not complete`);
      }
      const line = storedLine(it);
      let productId = it.product?.id ?? created.get(it.productName);
      if (!productId) {
        productId = w.newId();
        created.set(it.productName, productId);
        await insert(db, 'products', {
          id: productId,
          name: it.productName,
          unit: it.unit,
          sell_price_poisha: line.pricePoisha,
          ...rowCols(w),
        });
      }
      const cost = it.product?.costPricePoisha ?? null;
      const saleId = w.newId();
      firstSaleId ??= saleId;
      await insert(db, 'sales', {
        id: saleId,
        basket_id: basketId,
        line_no: n + 1,
        product_id: productId,
        quantity: line.quantity,
        spoken_unit: line.spokenUnit,
        sell_price_poisha: line.pricePoisha,
        amount_poisha: it.amountPoisha,
        cost_price_poisha: cost ?? 0,
        cost_known: cost === null ? 0 : 1,
        credit: b.credit ? 1 : 0,
        customer_id: customerId,
        ...entry(),
      });
    }
    if (customerId) {
      await insert(db, 'ledger', {
        id: w.newId(),
        party_id: customerId,
        party_type: 'customer',
        kind: 'baki',
        amount_poisha: b.totalPoisha,
        basket_id: basketId,
        sale_id: b.items.length === 1 ? firstSaleId : null,
        ...entry(),
      });
    }
    await setOutcome(db, w, voiceLogId, edits.length ? 'saved_edited' : 'saved', {
      edits,
      final: basketSummary(b),
      entryTable: 'sales',
      entryId: basketId,
    });
  });
  return basketId;
}

export interface RecentBasket {
  id: string;
  /** "চাল, ডাল" */
  products: string;
  lines: number;
  /** Only meaningful when lines = 1. */
  quantity: number;
  unit: Unit;
  amount_poisha: number;
  credit: number;
  customer: string | null;
  audio_path: string | null;
  created_at: number;
}

/** Latest sales, one row per basket. */
export const recentBaskets = (db: Db, limit = 3) =>
  db.getAllAsync<RecentBasket>(
    `SELECT COALESCE(s.basket_id, s.id) AS id,
            GROUP_CONCAT(p.name, ', ') AS products,
            COUNT(*) AS lines,
            MIN(s.quantity) AS quantity,
            MIN(p.unit) AS unit,
            SUM(s.amount_poisha) AS amount_poisha,
            MAX(s.credit) AS credit,
            MAX(c.name) AS customer,
            MAX(v.audio_path) AS audio_path,
            MAX(s.created_at) AS created_at
     FROM (SELECT * FROM v_sales ORDER BY created_at, line_no) s
     JOIN products p ON p.id = s.product_id
     LEFT JOIN customers c ON c.id = s.customer_id
     LEFT JOIN voice_logs v ON v.id = s.voice_log_id
     GROUP BY COALESCE(s.basket_id, s.id)
     ORDER BY created_at DESC LIMIT ?`,
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
  /** Voice logs the reviewer marked, and how many of those STT heard right. */
  sttChecked: number;
  sttOk: number;
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
  const stt = await db.getFirstAsync<{ checked: number; ok: number | null }>(
    'SELECT COUNT(stt_ok) AS checked, SUM(stt_ok) AS ok FROM voice_logs WHERE created_at >= ?',
    since,
  );
  return {
    total: rows.reduce((a, r) => a + r.n, 0),
    ...s,
    sttChecked: stt?.checked ?? 0,
    sttOk: stt?.ok ?? 0,
    accuracy: decided ? Math.round((s.saved / decided) * 100) : null,
  };
}

export const pilotLog = (db: Db, limit = 500) =>
  db.getAllAsync<VoiceLogRow>('SELECT * FROM voice_logs ORDER BY created_at DESC LIMIT ?', limit);

/**
 * "পাইলট ডাটা মুছুন": empties every entry, product, customer and voice log so the
 * real pilot starts clean. Keeps this device. The append-only DELETE guards are
 * dropped and re-created inside one transaction. Returns the audio files to delete.
 */
export async function wipePilotData(db: Db): Promise<string[]> {
  const audio = await db.getAllAsync<{ audio_path: string }>(
    'SELECT audio_path FROM voice_logs WHERE audio_path IS NOT NULL',
  );
  await db.withTransactionAsync(async () => {
    for (const t of ENTRY_TABLES) await db.runAsync(`DROP TRIGGER ${t}_no_delete`);
    // children before parents (foreign keys)
    for (const t of ['ledger', 'sales', 'purchases', 'expenses', 'owner_withdrawals', 'day_close', 'product_aliases', 'products', 'customers', 'voice_logs']) {
      await db.runAsync(`DELETE FROM ${t}`);
    }
    for (const t of ENTRY_TABLES) await db.runAsync(noDeleteTrigger(t));
  });
  return audio.map((a) => a.audio_path);
}
