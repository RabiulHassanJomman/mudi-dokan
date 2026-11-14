/**
 * Reads and writes for build step 2 (sale + pilot log). Pure TS against a
 * small DB interface that expo-sqlite's SQLiteDatabase satisfies, so it is
 * tested on node:sqlite.
 */
import { basketSummary, storedLine, type BasketDraft, type ProductInfo } from '../domain/basket';
import { ZERO_FLOWS, dayStart, netCash, openingAnchor, type CashAnchor, type CashFlows, type NoteCounts, type OpeningSource, type ProfitInput } from '../domain/cash';
import type { StoredEntry, StoredSaleLine } from '../domain/fix';
import type { EntryTable, RawEntry } from '../domain/history';
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
  /** Voice only: the engine setting when it was spoken (Gemini experiment). */
  engine?: Engine;
  /** Gemini mode: the recognizer failed (sttError kept) but Gemini understood it → still pending. */
  keepPending?: boolean;
}

export type Engine = 'android' | 'gemini' | 'both';

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
    outcome: v.sttError && !v.keepPending ? 'stt_error' : 'pending',
    via: v.via ?? null,
    engine: v.engine ?? null,
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
  /** v7 (Gemini experiment): engine setting, whose result parsed_json is, each engine's result. */
  engine: Engine | null;
  parsed_by: 'android' | 'gemini' | null;
  android_json: string | null;
  gemini_json: string | null;
  gemini_transcript: string | null;
  gemini_error: string | null;
  gemini_model: string | null;
  gemini_ms: number | null;
  gemini_prompt_tokens: number | null;
  gemini_audio_tokens: number | null;
  gemini_output_tokens: number | null;
  gemini_thought_tokens: number | null;
  created_at: number;
}

export const getVoiceLog = (db: Db, id: string) =>
  db.getFirstAsync<VoiceLogRow>('SELECT * FROM voice_logs WHERE id = ?', id);

/**
 * parsed = what the confirm card shows. `by` + `android`: the Gemini experiment (v7) also
 * keeps the rule parse of the Android transcript, whoever was shown.
 */
export async function setParsed(
  db: Db,
  w: Writer,
  id: string,
  parsed: ParsedCommand,
  extra: { by?: 'android' | 'gemini'; android?: ParsedCommand | null } = {},
): Promise<void> {
  await db.runAsync(
    `UPDATE voice_logs SET parsed_json = ?, intent = ?, parsed_by = COALESCE(?, parsed_by),
       android_json = COALESCE(?, android_json), updated_at = ? WHERE id = ?`,
    JSON.stringify(parsed),
    parsed.intent,
    extra.by ?? null,
    extra.android ? JSON.stringify(extra.android) : null,
    w.now(),
    id,
  );
}

/** What Gemini made of the clip (the call may finish after the entry was saved). */
export interface GeminiLogResult {
  model: string;
  parsed: ParsedCommand | null;
  transcript: string | null;
  error: string | null;
  ms: number;
  usage: { promptTokens: number; audioTokens: number; outputTokens: number; thoughtTokens: number } | null;
}

export async function setGeminiResult(db: Db, w: Writer, id: string, g: GeminiLogResult): Promise<void> {
  await db.runAsync(
    `UPDATE voice_logs SET gemini_json = ?, gemini_transcript = ?, gemini_error = ?, gemini_model = ?, gemini_ms = ?,
       gemini_prompt_tokens = ?, gemini_audio_tokens = ?, gemini_output_tokens = ?, gemini_thought_tokens = ?, updated_at = ?
     WHERE id = ?`,
    g.parsed ? JSON.stringify(g.parsed) : null,
    g.transcript,
    g.parsed ? null : g.error ?? 'no result',
    g.model,
    Math.round(g.ms),
    g.usage?.promptTokens ?? null,
    g.usage?.audioTokens ?? null,
    g.usage?.outputTokens ?? null,
    g.usage?.thoughtTokens ?? null,
    w.now(),
    id,
  );
}

/** Voice logs since `since` (ms) that Gemini was asked about or could have been (engine set). */
export const engineLogs = (db: Db, since: number) =>
  db.getAllAsync<VoiceLogRow>(
    "SELECT * FROM voice_logs WHERE created_at >= ? AND source = 'voice' AND engine IS NOT NULL ORDER BY created_at",
    since,
  );

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
    MAX(l.at) AS last_at
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
    `SELECT l.id, l.kind, l.amount_poisha, l.at AS created_at,
       (SELECT GROUP_CONCAT(name, ', ') FROM (
          SELECT p.name FROM v_sales s JOIN products p ON p.id = s.product_id
          WHERE l.basket_id IS NOT NULL AND s.basket_id = l.basket_id ORDER BY s.line_no)) AS products,
       v.transcript, v.audio_path
     FROM v_ledger l LEFT JOIN voice_logs v ON v.id = l.voice_log_id
     WHERE l.party_id = ?
     ORDER BY l.at DESC`,
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
              MAX(s.at) AS created_at
       FROM (SELECT * FROM v_sales ORDER BY at, line_no) s
       JOIN products p ON p.id = s.product_id
       LEFT JOIN customers c ON c.id = s.customer_id
       LEFT JOIN voice_logs v ON v.id = s.voice_log_id
       GROUP BY COALESCE(s.basket_id, s.id)
     UNION ALL
       SELECT l.kind, l.id, c.name, 0, NULL, NULL, l.amount_poisha, 0, NULL, v.audio_path, l.at
       FROM v_ledger l JOIN customers c ON c.id = l.party_id
       LEFT JOIN voice_logs v ON v.id = l.voice_log_id
       WHERE l.basket_id IS NULL AND l.sale_id IS NULL
     UNION ALL
       SELECT 'expense', e.id, e.item, 0, NULL, NULL, e.amount_poisha, 0, NULL, v.audio_path, e.at
       FROM v_expenses e LEFT JOIN voice_logs v ON v.id = e.voice_log_id
     UNION ALL
       SELECT 'owner_withdrawal', o.id, COALESCE(o.person, 'মালিক'), 0, NULL, NULL, o.amount_poisha, 0, NULL, v.audio_path, o.at
       FROM v_owner_withdrawals o LEFT JOIN voice_logs v ON v.id = o.voice_log_id
     UNION ALL
       SELECT 'purchase', pu.id, p.name, 0, pu.quantity, COALESCE(pu.spoken_unit, p.unit), pu.total_poisha, 0, NULL, v.audio_path, pu.at
       FROM v_purchases pu JOIN products p ON p.id = pu.product_id
       LEFT JOIN voice_logs v ON v.id = pu.voice_log_id
     )
     ORDER BY created_at DESC LIMIT ?`,
    limit,
  );

/** Today's sales and new baki (credit sales + plain বাকি entries); the shop-local day starts at `dayStart`. */
export async function todayTotals(db: Db, dayStart: number): Promise<{ sales: number; baki: number }> {
  const r = await db.getFirstAsync<{ sales: number | null; baki: number | null }>(
    `SELECT (SELECT SUM(amount_poisha) FROM v_sales WHERE at >= ?) AS sales,
            (SELECT SUM(amount_poisha) FROM v_ledger WHERE kind = 'baki' AND party_type = 'customer' AND at >= ?) AS baki`,
    dayStart,
    dayStart,
  );
  return { sales: r?.sales ?? 0, baki: r?.baki ?? 0 };
}

// ── cash (আজকের ক্যাশ, নোট গুনুন) ───────────────────────────────

/** Money movements of the effective entries that happened in [start, end). */
export async function cashFlows(db: Db, start: number, end: number): Promise<CashFlows> {
  if (end <= start) return { ...ZERO_FLOWS };
  const r = await db.getFirstAsync<CashFlows>(
    `SELECT
       (SELECT COALESCE(SUM(amount_poisha), 0) FROM v_sales WHERE at >= ? AND at < ?) AS sales,
       (SELECT COALESCE(SUM(amount_poisha), 0) FROM v_sales WHERE credit = 0 AND at >= ? AND at < ?) AS cashSales,
       (SELECT COALESCE(SUM(amount_poisha), 0) FROM v_ledger WHERE kind = 'baki' AND party_type = 'customer' AND at >= ? AND at < ?) AS bakiGiven,
       (SELECT COALESCE(SUM(amount_poisha), 0) FROM v_ledger WHERE kind = 'joma' AND party_type = 'customer' AND at >= ? AND at < ?) AS joma,
       (SELECT COALESCE(SUM(amount_poisha), 0) FROM v_expenses WHERE at >= ? AND at < ?) AS expenses,
       (SELECT COALESCE(SUM(total_poisha), 0) FROM v_purchases WHERE paid_cash = 1 AND at >= ? AND at < ?) AS cashPurchases,
       (SELECT COALESCE(SUM(amount_poisha), 0) FROM v_owner_withdrawals WHERE at >= ? AND at < ?) AS withdrawals`,
    ...Array.from({ length: 7 }, () => [start, end]).flat(),
  );
  return r ?? { ...ZERO_FLOWS };
}

/** Setup's opening cash and every counted close (effective rows). */
export async function cashAnchors(db: Db): Promise<CashAnchor[]> {
  const rows = await db.getAllAsync<{ business_date: string; kind: 'opening' | 'close'; opening_cash_poisha: number; counted_cash_poisha: number | null }>(
    'SELECT business_date, kind, opening_cash_poisha, counted_cash_poisha FROM v_day_close',
  );
  return rows.map((r) => ({
    date: r.business_date,
    kind: r.kind,
    amountPoisha: r.kind === 'close' ? (r.counted_cash_poisha ?? r.opening_cash_poisha) : r.opening_cash_poisha,
  }));
}

export interface DayClose {
  id: string;
  counted_cash_poisha: number;
  expected_cash_poisha: number;
  note_counts_json: string | null;
}

export interface CashDay {
  date: string;
  openingPoisha: number;
  source: OpeningSource;
  flows: CashFlows;
  expectedPoisha: number;
  /** দিন শেষ করুন was done for this day (the latest count). */
  close: DayClose | null;
}

/**
 * A day's cash: opening (Setup's, yesterday's counted cash, or an older anchor plus the
 * days in between), that day's flows and the expected cash in hand.
 */
export async function cashDay(db: Db, date: string): Promise<CashDay> {
  const anchor = openingAnchor(await cashAnchors(db), date);
  let openingPoisha = 0;
  let source: OpeningSource = 'none';
  if (anchor) {
    openingPoisha = anchor.amountPoisha + netCash(await cashFlows(db, dayStart(anchor.from), dayStart(date)));
    source = anchor.source;
  }
  const flows = await cashFlows(db, dayStart(date), dayStart(nextDate(date)));
  const close = await db.getFirstAsync<DayClose>(
    `SELECT id, counted_cash_poisha, expected_cash_poisha, note_counts_json FROM v_day_close
     WHERE kind = 'close' AND business_date = ? ORDER BY created_at DESC LIMIT 1`,
    date,
  );
  return { date, openingPoisha, source, flows, expectedPoisha: openingPoisha + netCash(flows), close };
}

const nextDate = (date: string) => {
  const t = new Date(dayStart(date));
  t.setDate(t.getDate() + 1);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`;
};

/**
 * দিন শেষ করুন: a day_close 'close' entry with the counted cash (the next day's opening).
 * Counting the same day again adds a correction of that day's close.
 */
export async function saveDayClose(
  db: Db,
  w: Writer,
  day: Pick<CashDay, 'date' | 'openingPoisha' | 'expectedPoisha'>,
  notes: NoteCounts,
  countedPoisha: number,
): Promise<string> {
  const id = w.newId();
  await db.withTransactionAsync(async () => {
    const prev = await db.getFirstAsync<{ id: string }>(
      "SELECT id FROM v_day_close WHERE kind = 'close' AND business_date = ? ORDER BY created_at DESC LIMIT 1",
      day.date,
    );
    await insert(db, 'day_close', {
      id,
      business_date: day.date,
      kind: 'close',
      opening_cash_poisha: day.openingPoisha,
      expected_cash_poisha: day.expectedPoisha,
      counted_cash_poisha: countedPoisha,
      note_counts_json: JSON.stringify(notes),
      corrects_id: prev?.id ?? null,
      device_name: w.deviceName,
      ...rowCols(w),
    });
  });
  return id;
}

/** "আজ লাভ কত?": sales, the cost of goods with a known buy price, and expenses in [start, end). */
export async function profitInput(db: Db, start: number, end: number): Promise<ProfitInput> {
  const r = await db.getFirstAsync<ProfitInput>(
    `SELECT
       (SELECT COALESCE(SUM(amount_poisha), 0) FROM v_sales WHERE at >= ? AND at < ?) AS salesPoisha,
       (SELECT COALESCE(SUM(amount_poisha), 0) FROM v_sales WHERE cost_known = 1 AND at >= ? AND at < ?) AS knownSalesPoisha,
       (SELECT COALESCE(SUM(ROUND(cost_price_poisha * quantity)), 0) FROM v_sales WHERE cost_known = 1 AND at >= ? AND at < ?) AS knownCostPoisha,
       (SELECT COUNT(*) FROM v_sales WHERE cost_known = 0 AND at >= ? AND at < ?) AS unknownLines,
       (SELECT COALESCE(SUM(amount_poisha), 0) FROM v_expenses WHERE at >= ? AND at < ?) AS expensesPoisha`,
    ...Array.from({ length: 5 }, () => [start, end]).flat(),
  );
  return {
    salesPoisha: r?.salesPoisha ?? 0,
    knownSalesPoisha: r?.knownSalesPoisha ?? 0,
    knownCostPoisha: Math.round(r?.knownCostPoisha ?? 0),
    unknownLines: r?.unknownLines ?? 0,
    expensesPoisha: r?.expensesPoisha ?? 0,
  };
}

// ── history (আজকের খাতা) ───────────────────────────────────────

/** Every version of every entry that happened in [start, end), for domain/history.buildHistory. */
export const historyRows = (db: Db, start: number, end: number) =>
  db.getAllAsync<RawEntry>(
    `SELECT * FROM (
       SELECT 'sales' AS "table", s.id, s.corrects_id, s.voided, COALESCE(s.entry_at, s.created_at) AS at, s.created_at,
              NULL AS kind, s.basket_id, s.line_no, NULL AS sale_id, p.name AS title, s.quantity, p.unit AS unit,
              s.amount_poisha, s.credit, c.name AS customer, v.audio_path
       FROM sales s JOIN products p ON p.id = s.product_id
       LEFT JOIN customers c ON c.id = s.customer_id LEFT JOIN voice_logs v ON v.id = s.voice_log_id
     UNION ALL
       SELECT 'ledger', l.id, l.corrects_id, l.voided, COALESCE(l.entry_at, l.created_at), l.created_at,
              l.kind, l.basket_id, NULL, l.sale_id, c.name, NULL, NULL, l.amount_poisha, 0, NULL, v.audio_path
       FROM ledger l JOIN customers c ON c.id = l.party_id LEFT JOIN voice_logs v ON v.id = l.voice_log_id
       WHERE l.party_type = 'customer'
     UNION ALL
       SELECT 'expenses', e.id, e.corrects_id, e.voided, COALESCE(e.entry_at, e.created_at), e.created_at,
              NULL, NULL, NULL, NULL, e.item, NULL, NULL, e.amount_poisha, 0, NULL, v.audio_path
       FROM expenses e LEFT JOIN voice_logs v ON v.id = e.voice_log_id
     UNION ALL
       SELECT 'owner_withdrawals', o.id, o.corrects_id, o.voided, COALESCE(o.entry_at, o.created_at), o.created_at,
              NULL, NULL, NULL, NULL, COALESCE(o.person, 'মালিক'), NULL, NULL, o.amount_poisha, 0, NULL, v.audio_path
       FROM owner_withdrawals o LEFT JOIN voice_logs v ON v.id = o.voice_log_id
     UNION ALL
       SELECT 'purchases', pu.id, pu.corrects_id, pu.voided, COALESCE(pu.entry_at, pu.created_at), pu.created_at,
              NULL, NULL, NULL, NULL, p.name, pu.quantity, COALESCE(pu.spoken_unit, p.unit), pu.total_poisha, 0, NULL, v.audio_path
       FROM purchases pu JOIN products p ON p.id = pu.product_id LEFT JOIN voice_logs v ON v.id = pu.voice_log_id
     ) WHERE at >= ? AND at < ?`,
    start,
    end,
  );

// ── corrections (✏️ ঠিক করুন) and undo ("ভুল হয়েছে") ─────────────

type Row = Record<string, Bind>;

/**
 * A correction of `oldId`: a copy of its row with `changes`, corrects_id = oldId and the
 * original time (entry_at). voided = the entry is cancelled from now on.
 */
async function correct(db: Db, w: Writer, table: EntryTable, oldId: string, changes: Row, voided = false): Promise<string> {
  const old = await db.getFirstAsync<Row>(`SELECT * FROM ${table} WHERE id = ?`, oldId);
  if (!old) throw new Error(`${table} ${oldId} not found`);
  const id = w.newId();
  await insert(db, table, {
    ...old,
    ...changes,
    id,
    corrects_id: oldId,
    voided: voided ? 1 : 0,
    entry_at: (old.entry_at as number | null) ?? (old.created_at as number),
    device_name: w.deviceName,
    ...rowCols(w),
  });
  return id;
}

type SaleRow = Row & { id: string; product_id: string; quantity: number; sell_price_poisha: number; amount_poisha: number; cost_price_poisha: number; cost_known: number; credit: number; customer_id: string | null; basket_id: string | null; line_no: number | null; voice_log_id: string | null; at: number };

/** The effective lines of a basket. `basketId` is the basket_id, or a pre-v3 sale's own id. */
const basketRows = (db: Db, basketId: string) =>
  db.getAllAsync<SaleRow>('SELECT * FROM v_sales WHERE basket_id = ? OR (basket_id IS NULL AND id = ?) ORDER BY line_no', basketId, basketId);

/** A credit basket's baki row (effective). */
const basketLedger = (db: Db, basketId: string) =>
  db.getFirstAsync<Row & { id: string; party_id: string; amount_poisha: number }>(
    'SELECT * FROM v_ledger WHERE basket_id = ? OR (basket_id IS NULL AND sale_id = ?) LIMIT 1',
    basketId,
    basketId,
  );

async function productInfoById(db: Db, id: string): Promise<ProductInfo> {
  const r = await db.getFirstAsync<ProductRow>(
    `SELECT p.id, p.name, p.unit, p.sell_price_poisha,
       (SELECT CAST(ROUND(SUM(buy_price_poisha * quantity) / SUM(quantity)) AS INTEGER)
          FROM v_purchases WHERE product_id = p.id AND quantity > 0) AS cost
     FROM products p WHERE p.id = ?`,
    id,
  );
  if (!r) throw new Error(`product ${id} not found`);
  return { id: r.id, name: r.name, unit: r.unit, sellPricePoisha: r.sell_price_poisha, costPricePoisha: r.cost };
}

/** ✏️ on a sale: its lines for basketFromStored. */
export async function basketForFix(db: Db, basketId: string): Promise<StoredSaleLine[]> {
  const out: StoredSaleLine[] = [];
  for (const r of await basketRows(db, basketId)) {
    const c = r.customer_id ? await db.getFirstAsync<{ name: string }>('SELECT name FROM customers WHERE id = ?', r.customer_id) : null;
    out.push({
      id: r.id,
      line_no: r.line_no,
      product: await productInfoById(db, r.product_id),
      quantity: r.quantity,
      sell_price_poisha: r.sell_price_poisha,
      amount_poisha: r.amount_poisha,
      cost_price_poisha: r.cost_price_poisha,
      cost_known: r.cost_known,
      credit: r.credit,
      customer: c?.name ?? null,
    });
  }
  return out;
}

/**
 * Saves a fixed basket as corrections: a changed line → a correction row, a removed line →
 * a voided one; the baki row follows the new total / customer / নগদ-বাকি. Unchanged lines
 * get nothing. Returns whether anything changed.
 */
export async function saveBasketFix(db: Db, w: Writer, basketId: string, b: BasketDraft): Promise<boolean> {
  if (b.problems.length || b.totalPoisha === null) throw new Error(`basket is not complete: ${b.problems.join(', ')}`);
  let changed = false;
  await db.withTransactionAsync(async () => {
    const rows = await basketRows(db, basketId);
    if (!rows.length) throw new Error(`basket ${basketId} not found`);
    const customerId = b.customerName ? await findOrCreateCustomer(db, w, b.customerName) : null;
    const credit = b.credit ? 1 : 0;
    const created = new Map<string, string>();
    for (const r of rows) {
      const it = b.items.find((i) => i.key === r.id);
      if (!it) {
        await correct(db, w, 'sales', r.id, { basket_id: basketId }, true);
        changed = true;
        continue;
      }
      if (!it.productName || it.quantity === null || it.amountPoisha === null) throw new Error(`line ${it.key} is not complete`);
      const line = storedLine(it);
      let productId = it.product?.id ?? created.get(it.productName) ?? null;
      if (!productId) {
        productId = w.newId();
        created.set(it.productName, productId);
        await insert(db, 'products', { id: productId, name: it.productName, unit: it.unit, sell_price_poisha: line.pricePoisha, ...rowCols(w) });
      }
      if (it.alias && it.product) await addProductAlias(db, w, it.alias, it.product.id);
      const sameProduct = productId === r.product_id;
      const diff =
        !sameProduct || line.quantity !== r.quantity || line.pricePoisha !== r.sell_price_poisha ||
        it.amountPoisha !== r.amount_poisha || credit !== r.credit || customerId !== r.customer_id;
      if (!diff) continue;
      const cost = sameProduct ? null : it.product?.costPricePoisha ?? null;
      await correct(db, w, 'sales', r.id, {
        basket_id: basketId,
        product_id: productId,
        quantity: line.quantity,
        spoken_unit: line.spokenUnit,
        sell_price_poisha: line.pricePoisha,
        amount_poisha: it.amountPoisha,
        credit,
        customer_id: customerId,
        ...(sameProduct ? {} : { cost_price_poisha: cost ?? 0, cost_known: cost === null ? 0 : 1 }),
      });
      changed = true;
    }
    // the basket's baki row
    const led = await basketLedger(db, basketId);
    const want = credit && customerId ? { party_id: customerId, amount_poisha: b.totalPoisha! } : null;
    if (led && !want) {
      await correct(db, w, 'ledger', led.id, {}, true);
      changed = true;
    } else if (led && want && (led.party_id !== want.party_id || led.amount_poisha !== want.amount_poisha)) {
      await correct(db, w, 'ledger', led.id, want);
      changed = true;
    } else if (!led && want) {
      const first = rows[0]!;
      await insert(db, 'ledger', {
        id: w.newId(),
        ...want,
        party_type: 'customer',
        kind: 'baki',
        basket_id: first.basket_id ?? null,
        sale_id: first.basket_id ? null : first.id,
        voice_log_id: first.voice_log_id,
        entry_at: first.at,
        device_name: w.deviceName,
        ...rowCols(w),
      });
      changed = true;
    }
  });
  return changed;
}

const FIX_TABLES = ['ledger', 'expenses', 'owner_withdrawals', 'purchases'] as const;
export type FixTable = (typeof FIX_TABLES)[number];
export const isFixTable = (t: string): t is FixTable => (FIX_TABLES as readonly string[]).includes(t);

/** ✏️ on a বাকি / জমা / খরচ / মালিক নিল / কেনা: the latest version for entryFromStored. */
export async function entryForFix(db: Db, table: FixTable, id: string): Promise<StoredEntry | null> {
  const r = await db.getFirstAsync<Row>(`SELECT * FROM v_${table} WHERE id = ?`, id);
  if (!r) return null;
  const customer = table === 'ledger' ? await db.getFirstAsync<{ name: string }>('SELECT name FROM customers WHERE id = ?', r.party_id as string) : null;
  const product = table === 'purchases' ? await productInfoById(db, r.product_id as string) : null;
  return {
    table,
    id,
    kind: (r.kind as string | undefined) ?? null,
    customer: customer?.name ?? null,
    amount_poisha: (table === 'purchases' ? r.total_poisha : r.amount_poisha) as number,
    item: (r.item as string | undefined) ?? null,
    person: (r.person as string | undefined) ?? null,
    note: (r.note as string | undefined) ?? null,
    product,
    quantity: (r.quantity as number | undefined) ?? null,
    spoken_unit: (r.spoken_unit as Unit | undefined) ?? null,
    buy_price_poisha: (r.buy_price_poisha as number | undefined) ?? null,
    sell_price_poisha: (r.sell_price_poisha as number | undefined) ?? null,
  };
}

/** Saves a fixed entry as one correction row (nothing when nothing changed). Returns whether it changed. */
export async function saveEntryFix(db: Db, w: Writer, s: StoredEntry, d: EntryDraft): Promise<boolean> {
  if (d.problems.length || d.amountPoisha === null) throw new Error(`entry is not complete: ${d.problems.join(', ')}`);
  let changed = false;
  await db.withTransactionAsync(async () => {
    const old = await db.getFirstAsync<Row>(`SELECT * FROM ${s.table} WHERE id = ?`, s.id);
    if (!old) throw new Error(`${s.table} ${s.id} not found`);
    let changes: Row;
    if (s.table === 'ledger') {
      changes = { party_id: await findOrCreateCustomer(db, w, d.customerName!), kind: d.kind!, amount_poisha: d.amountPoisha };
    } else if (s.table === 'expenses') {
      changes = { item: d.item!, amount_poisha: d.amountPoisha, person: d.person, note: d.note };
    } else if (s.table === 'owner_withdrawals') {
      changes = { person: d.person, amount_poisha: d.amountPoisha, note: d.note };
    } else {
      const l = d.purchase!;
      if (!l.productName || !l.quantity || l.buyPricePoisha === null) throw new Error('purchase line is not complete');
      let productId = l.product?.id ?? (await findProduct(db, l.productName))?.id ?? null;
      if (!productId) {
        productId = w.newId();
        await insert(db, 'products', { id: productId, name: l.productName, unit: l.unit, sell_price_poisha: l.sellPricePoisha, ...rowCols(w) });
      } else if (l.sellPricePoisha !== null && l.sellPricePoisha !== old.sell_price_poisha && !l.unitWarning) {
        await db.runAsync('UPDATE products SET sell_price_poisha = ?, updated_at = ? WHERE id = ?', l.sellPricePoisha, w.now(), productId);
      }
      if (l.alias) await addProductAlias(db, w, l.alias, productId);
      changes = {
        product_id: productId,
        quantity: l.quantity,
        spoken_unit: l.unitWarning ? l.unit : null,
        buy_price_poisha: l.buyPricePoisha,
        sell_price_poisha: l.sellPricePoisha,
        total_poisha: d.amountPoisha,
      };
    }
    if (Object.entries(changes).every(([k, v]) => old[k] === v)) return;
    await correct(db, w, s.table, s.id, changes);
    changed = true;
  });
  return changed;
}

/**
 * Undo / ✏️ বাতিল: cancels an entry with a voided correction (never a delete). A sale
 * (`id` = basket id) cancels every line and its baki row. Returns the correction ids.
 */
export async function voidEntry(db: Db, w: Writer, table: EntryTable, id: string): Promise<string[]> {
  const out: string[] = [];
  await db.withTransactionAsync(async () => {
    if (table === 'sales') {
      const rows = await basketRows(db, id);
      if (!rows.length) throw new Error(`basket ${id} not found`);
      for (const r of rows) out.push(await correct(db, w, 'sales', r.id, { basket_id: id }, true));
      const led = await basketLedger(db, id);
      if (led) out.push(await correct(db, w, 'ledger', led.id, {}, true));
    } else {
      const r = await db.getFirstAsync<{ id: string }>(`SELECT id FROM v_${table} WHERE id = ?`, id);
      if (!r) throw new Error(`${table} ${id} not found`);
      out.push(await correct(db, w, table, id, {}, true));
    }
  });
  return out;
}

/** The table a recentEntries / history kind lives in. */
export const TABLE_OF: Record<RecentEntry['kind'], EntryTable> = {
  sale: 'sales',
  baki: 'ledger',
  joma: 'ledger',
  expense: 'expenses',
  owner_withdrawal: 'owner_withdrawals',
  purchase: 'purchases',
};

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
