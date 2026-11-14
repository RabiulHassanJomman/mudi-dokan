/**
 * Reads and writes for build step 2 (sale + pilot log). Pure TS against a
 * small DB interface that expo-sqlite's SQLiteDatabase satisfies, so it is
 * tested on node:sqlite.
 */
import { basketSummary, storedLine, type BasketDraft, type ProductInfo } from '../domain/basket';
import { entrySummary, type EntryDraft } from '../domain/entry';
import type { CustomerLine } from '../domain/customerImport';
import type { Candidate } from '../domain/names';
import type { PickProduct } from '../domain/pick';
import type { RecentEntry } from '../domain/recent';
import type { StockRow } from '../domain/stock';
import type { Role, SetupDraft } from '../domain/setup';
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

// ── setup (প্রথমবার চালু) ──────────────────────────────────────

/** The shop row has a fixed id so every phone's copy is the same row when synced. */
export const SHOP_ID = 'shop';

/** Current setup values for this phone (shop + its device row + the effective opening cash). */
export async function getSetup(
  db: Db,
  deviceId: string,
): Promise<{ shopName: string | null; deviceName: string | null; role: Role | null; openingCashPoisha: number | null }> {
  const shop = await db.getFirstAsync<{ name: string }>('SELECT name FROM shop WHERE id = ?', SHOP_ID);
  const dev = await db.getFirstAsync<{ device_name: string; role: Role }>('SELECT device_name, role FROM devices WHERE id = ?', deviceId);
  const open = await currentOpening(db);
  return {
    shopName: shop?.name ?? null,
    deviceName: dev?.device_name ?? null,
    role: dev?.role ?? null,
    openingCashPoisha: open?.opening_cash_poisha ?? null,
  };
}

const currentOpening = (db: Db) =>
  db.getFirstAsync<{ id: string; business_date: string; opening_cash_poisha: number }>(
    "SELECT id, business_date, opening_cash_poisha FROM v_day_close WHERE kind = 'opening' ORDER BY created_at LIMIT 1",
  );

/**
 * Saves Setup in one transaction: the shop name (upsert), this phone's name and role,
 * and the opening cash as a day_close 'opening' entry. Editing it later (settings) adds
 * a correction row for the same business day; the same amount adds nothing.
 */
export async function saveSetup(db: Db, w: Writer, s: SetupDraft, businessDate: string): Promise<void> {
  if (!s.role || s.openingCashPoisha === null) throw new Error('setup is not complete');
  const t = w.now();
  const deviceName = s.deviceName.trim();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO shop (id, name, device_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, device_id = excluded.device_id, updated_at = excluded.updated_at`,
      SHOP_ID, s.shopName.trim(), w.deviceId, t, t,
    );
    await db.runAsync(
      `INSERT INTO devices (id, device_name, role, device_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET device_name = excluded.device_name, role = excluded.role, updated_at = excluded.updated_at`,
      w.deviceId, deviceName, s.role, w.deviceId, t, t,
    );
    const open = await currentOpening(db);
    if (open?.opening_cash_poisha === s.openingCashPoisha) return;
    await insert(db, 'day_close', {
      id: w.newId(),
      business_date: open?.business_date ?? businessDate,
      kind: 'opening',
      opening_cash_poisha: s.openingCashPoisha,
      corrects_id: open?.id ?? null,
      device_name: deviceName,
      ...rowCols(w),
    });
  });
}

/**
 * Names that mean the owner for the parser (ctx.ownerNames): device_name of every phone
 * with role মালিক. Before sync (step 7) that is only this phone's own row.
 */
export async function ownerNames(db: Db): Promise<string[]> {
  const rows = await db.getAllAsync<{ n: string }>("SELECT DISTINCT device_name AS n FROM devices WHERE role = 'owner'");
  return rows.map((r) => r.n.trim()).filter(Boolean);
}

// ── products & customers ───────────────────────────────────────

/** ছবি দেখে বেছে নিন: active products, most sold first, with their aliases. */
export async function pickProducts(db: Db): Promise<PickProduct[]> {
  const rows = await db.getAllAsync<{ id: string; name: string; unit: Unit; sell_price_poisha: number | null; aliases: string | null }>(
    `SELECT p.id, p.name, p.unit, p.sell_price_poisha,
       (SELECT GROUP_CONCAT(alias, char(31)) FROM product_aliases a WHERE a.product_id = p.id) AS aliases
     FROM products p
     WHERE p.archived = 0
     ORDER BY (SELECT COUNT(*) FROM v_sales s WHERE s.product_id = p.id) DESC, p.created_at`,
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    unit: r.unit,
    sellPricePoisha: r.sell_price_poisha,
    aliases: r.aliases ? r.aliases.split('\u001f') : [],
  }));
}

export async function knownNames(db: Db): Promise<{ products: string[]; customers: string[] }> {
  const products = await db.getAllAsync<{ n: string }>(
    'SELECT name AS n FROM products WHERE archived = 0 UNION SELECT alias FROM product_aliases',
  );
  const customers = await db.getAllAsync<{ n: string }>(
    "SELECT name AS n FROM customers WHERE archived = 0 AND party_type = 'customer'",
  );
  return { products: products.map((r) => r.n), customers: customers.map((r) => r.n) };
}

/** Spoken name → product name, for the parser (ctx.productAliases). */
export async function productAliasMap(db: Db): Promise<Record<string, string>> {
  const rows = await db.getAllAsync<{ alias: string; name: string }>(
    `SELECT a.alias, p.name FROM product_aliases a JOIN products p ON p.id = a.product_id
     WHERE p.archived = 0 ORDER BY a.created_at`,
  );
  return Object.fromEntries(rows.map((r) => [r.alias, r.name]));
}

/**
 * Remembers a spoken name for a product ("চাউল" → চাল) after the user chose it from the
 * closest matches. Skipped when the name is already a product or an alias.
 */
export async function addProductAlias(db: Db, w: Writer, alias: string, productId: string): Promise<void> {
  const a = alias.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!a) return;
  const taken = await db.getFirstAsync<{ n: number }>(
    `SELECT (SELECT COUNT(*) FROM products WHERE name = ? AND archived = 0)
          + (SELECT COUNT(*) FROM product_aliases WHERE alias = ?) AS n`,
    a,
    a,
  );
  if (taken && taken.n > 0) return;
  await insert(db, 'product_aliases', { id: w.newId(), alias: a, product_id: productId, ...rowCols(w) });
}

/** মাল: every product with its effective bought and sold totals, most sold first. */
export const stockList = (db: Db) =>
  db.getAllAsync<StockRow>(
    `SELECT p.id, p.name, p.unit, p.sell_price_poisha AS sellPricePoisha,
       COALESCE((SELECT SUM(quantity) FROM v_purchases WHERE product_id = p.id), 0) AS bought,
       COALESCE((SELECT SUM(quantity) FROM v_sales WHERE product_id = p.id), 0) AS sold,
       (SELECT COUNT(*) FROM v_purchases WHERE product_id = p.id) AS purchases
     FROM products p
     WHERE p.archived = 0
     ORDER BY (SELECT COUNT(*) FROM v_sales s WHERE s.product_id = p.id) DESC, p.created_at`,
  );

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
  /** 'pick' = chosen on ছবি দেখে (no speech, no parser): left out of the accuracy. */
  via?: 'pick';
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
    via: v.via ?? null,
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
  /** 'pick' = ছবি দেখে বেছে নেওয়া; null = voice or typed. */
  via: 'pick' | null;
  /** Parsed intent, replaced by the confirmed one on save. */
  intent: string | null;
  created_at: number;
}

export const getVoiceLog = (db: Db, id: string) =>
  db.getFirstAsync<VoiceLogRow>('SELECT * FROM voice_logs WHERE id = ?', id);

export async function setParsed(db: Db, w: Writer, id: string, parsed: ParsedCommand): Promise<void> {
  await db.runAsync(
    'UPDATE voice_logs SET parsed_json = ?, intent = ?, updated_at = ? WHERE id = ?',
    JSON.stringify(parsed),
    parsed.intent,
    w.now(),
    id,
  );
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
  extra: { edits?: string[]; final?: unknown; entryTable?: string; entryId?: string; intent?: string } = {},
): Promise<void> {
  await db.runAsync(
    `UPDATE voice_logs SET outcome = ?, edits_json = ?, final_json = ?, entry_table = ?, entry_id = ?,
       intent = COALESCE(?, intent), updated_at = ?
     WHERE id = ? AND outcome = 'pending'`,
    outcome,
    extra.edits?.length ? JSON.stringify(extra.edits) : null,
    extra.final !== undefined ? JSON.stringify(extra.final) : null,
    extra.entryTable ?? null,
    extra.entryId ?? null,
    extra.intent ?? null,
    w.now(),
    id,
  );
}

/**
 * "saved_edited" only when the user corrected what was understood. Confirming that a
 * name is a new customer ("customerNew") is a decision, not a correction: the parser was right.
 */
const savedOutcome = (edits: readonly string[]): 'saved' | 'saved_edited' =>
  edits.some((e) => e !== 'customerNew') ? 'saved_edited' : 'saved';

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
    // credit: who owes; cash: who bought, if a name was confirmed
    const customerId = b.customerName ? await findOrCreateCustomer(db, w, b.customerName) : null;
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
      if (it.alias && it.product) await addProductAlias(db, w, it.alias, it.product.id);
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
    if (customerId && b.credit) {
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
    await setOutcome(db, w, voiceLogId, savedOutcome(edits), {
      edits,
      final: basketSummary(b),
      entryTable: 'sales',
      entryId: basketId,
      intent: 'sale',
    });
  });
  return basketId;
}

// ── other entries (বাকি, জমা, খরচ, মালিক নিল, মাল কেনা) ─────────────

const ENTRY_TABLE = { baki: 'ledger', joma: 'ledger', expense: 'expenses', owner_withdrawal: 'owner_withdrawals', purchase: 'purchases' } as const;

/**
 * Saves a confirmed non-sale entry in one transaction with its voice log outcome
 * (final summary, edits, confirmed intent). A purchase creates a new product, and
 * a said/typed sell price becomes the product's selling price; the average cost is
 * always worked out from purchases (findProduct). Returns the entry row id.
 */
export async function saveEntry(db: Db, w: Writer, d: EntryDraft, voiceLogId: string, edits: string[]): Promise<string> {
  if (d.problems.length || !d.kind || d.amountPoisha === null) {
    throw new Error(`entry is not complete: ${d.problems.join(', ') || 'no amount'}`);
  }
  const kind = d.kind;
  const amount = d.amountPoisha;
  const id = w.newId();
  const entry = () => ({ id, voice_log_id: voiceLogId, device_name: w.deviceName, ...rowCols(w) });
  await db.withTransactionAsync(async () => {
    if (kind === 'baki' || kind === 'joma') {
      const partyId = await findOrCreateCustomer(db, w, d.customerName!);
      await insert(db, 'ledger', { party_id: partyId, party_type: 'customer', kind, amount_poisha: amount, ...entry() });
    } else if (kind === 'expense') {
      await insert(db, 'expenses', { item: d.item!, amount_poisha: amount, person: d.person, note: d.note, ...entry() });
    } else if (kind === 'owner_withdrawal') {
      await insert(db, 'owner_withdrawals', { person: d.person, amount_poisha: amount, note: d.note, ...entry() });
    } else {
      const l = d.purchase!;
      if (!l.productName || !l.quantity || l.buyPricePoisha === null) throw new Error('purchase line is not complete');
      let productId = l.product?.id ?? (await findProduct(db, l.productName))?.id ?? null;
      if (!productId) {
        productId = w.newId();
        await insert(db, 'products', { id: productId, name: l.productName, unit: l.unit, sell_price_poisha: l.sellPricePoisha, ...rowCols(w) });
      } else if (l.sellPricePoisha !== null && !l.unitWarning) {
        await db.runAsync('UPDATE products SET sell_price_poisha = ?, updated_at = ? WHERE id = ?', l.sellPricePoisha, w.now(), productId);
      }
      if (l.alias) await addProductAlias(db, w, l.alias, productId);
      await insert(db, 'purchases', {
        product_id: productId,
        quantity: l.quantity,
        spoken_unit: l.unitWarning ? l.unit : null,
        buy_price_poisha: l.buyPricePoisha,
        sell_price_poisha: l.sellPricePoisha,
        total_poisha: amount,
        paid_cash: 1, // supplier credit (মহাজন) is Phase 3
        ...entry(),
      });
    }
    await setOutcome(db, w, voiceLogId, savedOutcome(edits), {
      edits,
      final: entrySummary(d),
      entryTable: ENTRY_TABLE[kind],
      entryId: id,
      intent: kind,
    });
  });
  return id;
}

// ── list import (ক্রেতার তালিকা আনুন) ────────────────────────────

/** The shop's customers with their aliases, for the import's duplicate check. */
export async function customerCandidates(db: Db): Promise<Candidate[]> {
  const rows = await db.getAllAsync<{ name: string; phone: string | null; aliases: string | null }>(
    `SELECT c.name, c.phone,
       (SELECT GROUP_CONCAT(alias, char(31)) FROM customer_aliases a WHERE a.customer_id = c.id) AS aliases
     FROM customers c WHERE c.archived = 0 AND c.party_type = 'customer' ORDER BY c.created_at`,
  );
  return rows.map((r) => ({ name: r.name, aliases: r.aliases ? r.aliases.split('\u001f') : [], phone: r.phone, label: 'আগে থেকে' }));
}

// ── customer aliases ───────────────────────────────────────────

/** Heard spelling → customer name ("কোরিম" → করিম). */
export async function customerAliasMap(db: Db): Promise<Record<string, string>> {
  const rows = await db.getAllAsync<{ alias: string; name: string }>(
    `SELECT a.alias, c.name FROM customer_aliases a JOIN customers c ON c.id = a.customer_id
     WHERE c.archived = 0 AND c.party_type = 'customer' ORDER BY a.created_at`,
  );
  return Object.fromEntries(rows.map((r) => [r.alias, r.name]));
}

/**
 * Remembers a heard name for an existing customer (customerAliasToLearn decides when).
 * Skipped when the name already is a customer or an alias. Returns whether it was added.
 */
export async function addCustomerAlias(db: Db, w: Writer, alias: string, customerName: string): Promise<boolean> {
  const a = alias.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!a) return false;
  const c = await db.getFirstAsync<{ id: string }>(
    "SELECT id FROM customers WHERE name = ? AND party_type = 'customer' AND archived = 0 ORDER BY created_at LIMIT 1",
    customerName.trim(),
  );
  if (!c) return false;
  const taken = await db.getFirstAsync<{ n: number }>(
    `SELECT (SELECT COUNT(*) FROM customers WHERE name = ? AND archived = 0)
          + (SELECT COUNT(*) FROM customer_aliases WHERE alias = ?) AS n`,
    a,
    a,
  );
  if (taken && taken.n > 0) return false;
  await insert(db, 'customer_aliases', { id: w.newId(), alias: a, customer_id: c.id, ...rowCols(w) });
  return true;
}

/** Confirmed import rows → normal customer rows, all or nothing. Returns how many. */
export async function importCustomers(db: Db, w: Writer, rows: readonly CustomerLine[]): Promise<number> {
  await db.withTransactionAsync(async () => {
    for (const r of rows) {
      await insert(db, 'customers', { id: w.newId(), name: r.name, phone: r.phone, note: r.note, party_type: 'customer', ...rowCols(w) });
    }
  });
  return rows.length;
}

// ── customers (বাকি খাতা) ──────────────────────────────────────

export interface CustomerBalance {
  id: string;
  name: string;
  phone: string | null;
  /** From the list import: honorifics, address ("ভাই · মসজিদের পাশে"). */
  note: string | null;
  /** baki − joma; positive = the shop is owed (পাবো). */
  balance_poisha: number;
  last_at: number | null;
}

const BALANCE_SQL = `
  SELECT c.id, c.name, c.phone, c.note,
    COALESCE(SUM(CASE l.kind WHEN 'baki' THEN l.amount_poisha ELSE -l.amount_poisha END), 0) AS balance_poisha,
    MAX(l.created_at) AS last_at
  FROM customers c LEFT JOIN v_ledger l ON l.party_id = c.id
  WHERE c.archived = 0 AND c.party_type = 'customer'`;

/** Every customer with what they owe, most owed first. */
export const customerBalances = (db: Db) =>
  db.getAllAsync<CustomerBalance>(`${BALANCE_SQL} GROUP BY c.id ORDER BY balance_poisha DESC, last_at DESC, c.name`);

export const getCustomer = (db: Db, id: string) =>
  db.getFirstAsync<CustomerBalance>(`${BALANCE_SQL} AND c.id = ? GROUP BY c.id`, id);

/** "করিমের বাকি কত?": the customer by exact name (oldest first if two share it), or null. */
export const customerByName = (db: Db, name: string) =>
  db.getFirstAsync<CustomerBalance>(`${BALANCE_SQL} AND c.name = ? GROUP BY c.id ORDER BY c.created_at LIMIT 1`, name.trim());

export async function setCustomerPhone(db: Db, w: Writer, id: string, phone: string | null): Promise<void> {
  await db.runAsync('UPDATE customers SET phone = ?, updated_at = ? WHERE id = ?', phone, w.now(), id);
}

export interface LedgerLine {
  id: string;
  kind: 'baki' | 'joma';
  amount_poisha: number;
  created_at: number;
  /** "চাল, ডাল" for the baki row of a credit sale. */
  products: string | null;
  transcript: string | null;
  audio_path: string | null;
}

/** A customer's ledger, newest first, with the clip that made each line. */
export const customerHistory = (db: Db, customerId: string) =>
  db.getAllAsync<LedgerLine>(
    `SELECT l.id, l.kind, l.amount_poisha, l.created_at,
       (SELECT GROUP_CONCAT(name, ', ') FROM (
          SELECT p.name FROM v_sales s JOIN products p ON p.id = s.product_id
          WHERE l.basket_id IS NOT NULL AND s.basket_id = l.basket_id ORDER BY s.line_no)) AS products,
       v.transcript, v.audio_path
     FROM v_ledger l LEFT JOIN voice_logs v ON v.id = l.voice_log_id
     WHERE l.party_id = ?
     ORDER BY l.created_at DESC`,
    customerId,
  );

/**
 * Home "শেষ entry": sale baskets and every other entry (বাকি, জমা, খরচ, মালিক নিল, কেনা),
 * newest first. A credit sale's own baki row is left out (the sale shows it).
 */
export const recentEntries = (db: Db, limit = 3) =>
  db.getAllAsync<RecentEntry>(
    `SELECT * FROM (
       SELECT 'sale' AS kind, COALESCE(s.basket_id, s.id) AS id,
              GROUP_CONCAT(p.name, ', ') AS title,
              COUNT(*) AS lines,
              CASE WHEN COUNT(*) = 1 THEN MIN(s.quantity) END AS quantity,
              CASE WHEN COUNT(*) = 1 THEN MIN(p.unit) END AS unit,
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
     UNION ALL
       SELECT l.kind, l.id, c.name, 0, NULL, NULL, l.amount_poisha, 0, NULL, v.audio_path, l.created_at
       FROM v_ledger l JOIN customers c ON c.id = l.party_id
       LEFT JOIN voice_logs v ON v.id = l.voice_log_id
       WHERE l.basket_id IS NULL AND l.sale_id IS NULL
     UNION ALL
       SELECT 'expense', e.id, e.item, 0, NULL, NULL, e.amount_poisha, 0, NULL, v.audio_path, e.created_at
       FROM v_expenses e LEFT JOIN voice_logs v ON v.id = e.voice_log_id
     UNION ALL
       SELECT 'owner_withdrawal', o.id, COALESCE(o.person, 'মালিক'), 0, NULL, NULL, o.amount_poisha, 0, NULL, v.audio_path, o.created_at
       FROM v_owner_withdrawals o LEFT JOIN voice_logs v ON v.id = o.voice_log_id
     UNION ALL
       SELECT 'purchase', pu.id, p.name, 0, pu.quantity, COALESCE(pu.spoken_unit, p.unit), pu.total_poisha, 0, NULL, v.audio_path, pu.created_at
       FROM v_purchases pu JOIN products p ON p.id = pu.product_id
       LEFT JOIN voice_logs v ON v.id = pu.voice_log_id
     )
     ORDER BY created_at DESC LIMIT ?`,
    limit,
  );

/** Today's sales and new baki (credit sales + plain বাকি entries); the shop-local day starts at `dayStart`. */
export async function todayTotals(db: Db, dayStart: number): Promise<{ sales: number; baki: number }> {
  const r = await db.getFirstAsync<{ sales: number | null; baki: number | null }>(
    `SELECT (SELECT SUM(amount_poisha) FROM v_sales WHERE created_at >= ?) AS sales,
            (SELECT SUM(amount_poisha) FROM v_ledger WHERE kind = 'baki' AND party_type = 'customer' AND created_at >= ?) AS baki`,
    dayStart,
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
  /** Chosen on ছবি দেখে: counted apart, not in total or accuracy (no parser involved). */
  picked: number;
  /** Voice logs the reviewer marked, and how many of those STT heard right. */
  sttChecked: number;
  sttOk: number;
  /** saved without edits ÷ (saved + edited + cancelled). The pilot target is 80%. */
  accuracy: number | null;
}

export async function pilotStats(db: Db, since = 0): Promise<PilotStats> {
  const rows = await db.getAllAsync<{ outcome: Outcome; n: number }>(
    'SELECT outcome, COUNT(*) AS n FROM voice_logs WHERE created_at >= ? AND via IS NULL GROUP BY outcome',
    since,
  );
  const picked = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM voice_logs WHERE created_at >= ? AND via = 'pick'",
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
    picked: picked?.n ?? 0,
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
    for (const t of ['ledger', 'sales', 'purchases', 'expenses', 'owner_withdrawals', 'day_close', 'product_aliases', 'products', 'customer_aliases', 'customers', 'voice_logs']) {
      await db.runAsync(`DELETE FROM ${t}`);
    }
    for (const t of ENTRY_TABLES) await db.runAsync(noDeleteTrigger(t));
  });
  return audio.map((a) => a.audio_path);
}
