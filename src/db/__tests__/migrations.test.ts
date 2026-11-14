/**
 * Runs the real migration SQL on Node's built-in SQLite (node:sqlite),
 * the same engine family expo-sqlite uses on the phone.
 */
import type { DatabaseSync as DatabaseSyncT } from 'node:sqlite';
import { ENTRY_TABLES, MIGRATIONS, SCHEMA_VERSION, migrate, type MigratableDb } from '../migrations';

// getBuiltinModule bypasses Jest's resolver, which doesn't know prefix-only builtins
const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite');

const adapter = (db: DatabaseSyncT): MigratableDb => ({
  execAsync: async (sql) => {
    db.exec(sql);
  },
  getFirstAsync: async <T>(sql: string) => (db.prepare(sql).get() as T | undefined) ?? null,
});

const now = 1_763_000_000_000;
const row = (id: string) => ({ id, device_id: 'd1', created_at: now, updated_at: now });
const entry = (id: string) => ({ ...row(id), device_name: 'আব্বু' });

function insert(db: DatabaseSyncT, table: string, values: Record<string, unknown>): void {
  const cols = Object.keys(values);
  db.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(
    ...(Object.values(values) as (string | number | null)[]),
  );
}

let raw: DatabaseSyncT;
let db: MigratableDb;

beforeEach(async () => {
  raw = new DatabaseSync(':memory:');
  db = adapter(raw);
  await migrate(db);
});
afterEach(() => raw.close());

describe('migrate', () => {
  it('sets user_version to the latest schema', async () => {
    expect(await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version')).toEqual({
      user_version: SCHEMA_VERSION,
    });
    expect(SCHEMA_VERSION).toBe(MIGRATIONS.length);
  });

  it('is idempotent', async () => {
    await expect(migrate(db)).resolves.toBe(SCHEMA_VERSION);
  });

  it('refuses a DB from a newer app', async () => {
    raw.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
    await expect(migrate(db)).rejects.toThrow(/newer/);
  });

  it('rolls back a failed step and keeps the old version', async () => {
    const fresh = new DatabaseSync(':memory:');
    const bad: MigratableDb = {
      ...adapter(fresh),
      execAsync: async (sql) => {
        if (sql.includes('CREATE TABLE devices')) fresh.exec(`CREATE TABLE half (x); ${'SELECT nope FROM nowhere;'}`);
        else fresh.exec(sql);
      },
    };
    await expect(migrate(bad)).rejects.toThrow();
    expect(fresh.prepare('PRAGMA user_version').get()).toEqual({ user_version: 0 });
    expect(fresh.prepare("SELECT name FROM sqlite_master WHERE name = 'half'").get()).toBeUndefined();
    fresh.close();
  });

  it('creates every table from the plan', () => {
    const names = (raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(
      (r) => r.name,
    );
    expect(names).toEqual(
      expect.arrayContaining([
        'devices', 'products', 'product_aliases', 'customers', 'voice_logs',
        'purchases', 'sales', 'ledger', 'expenses', 'owner_withdrawals', 'day_close',
      ]),
    );
  });

  it('gives every table id, device_id, created_at, updated_at', () => {
    const tables = raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
    for (const { name } of tables) {
      const cols = (raw.prepare(`PRAGMA table_info(${name})`).all() as { name: string }[]).map((c) => c.name);
      expect({ name, cols }).toEqual({ name, cols: expect.arrayContaining(['id', 'device_id', 'created_at', 'updated_at']) });
    }
  });
});

describe('devices', () => {
  it('stores device_name with role owner | staff, default staff', () => {
    insert(raw, 'devices', { ...row('d1'), device_name: 'আব্বু', role: 'owner' });
    insert(raw, 'devices', { ...row('d2'), device_name: 'কর্মচারী ১' });
    expect(raw.prepare('SELECT device_name, role FROM devices ORDER BY id').all()).toEqual([
      { device_name: 'আব্বু', role: 'owner' },
      { device_name: 'কর্মচারী ১', role: 'staff' },
    ]);
  });

  it('rejects other roles', () => {
    expect(() => insert(raw, 'devices', { ...row('d3'), device_name: 'x', role: 'boss' })).toThrow(/CHECK/);
  });

  it('allows renaming (devices are not entries)', () => {
    insert(raw, 'devices', { ...row('d1'), device_name: 'আব্বু' });
    raw.exec("UPDATE devices SET device_name = 'রহমান' WHERE id = 'd1'");
    expect(raw.prepare('SELECT device_name FROM devices').get()).toEqual({ device_name: 'রহমান' });
  });
});

describe('entries are append-only', () => {
  beforeEach(() => {
    insert(raw, 'products', { ...row('p1'), name: 'চাল', unit: 'kg', sell_price_poisha: 6000 });
    insert(raw, 'expenses', { ...entry('e1'), item: 'বিদ্যুৎ বিল', amount_poisha: 50000 });
  });

  it.each(ENTRY_TABLES)('%s has update/delete triggers and an effective view', (t) => {
    const triggers = (
      raw.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ?").all(t) as { name: string }[]
    ).map((r) => r.name);
    expect(triggers.sort()).toEqual([`${t}_no_delete`, `${t}_no_update`]);
    expect(raw.prepare("SELECT name FROM sqlite_master WHERE type = 'view' AND name = ?").get(`v_${t}`)).toBeTruthy();
  });

  it('blocks UPDATE and DELETE', () => {
    expect(() => raw.exec("UPDATE expenses SET amount_poisha = 1 WHERE id = 'e1'")).toThrow(/append-only/);
    expect(() => raw.exec("DELETE FROM expenses WHERE id = 'e1'")).toThrow(/append-only/);
  });

  it('a correction row replaces the original in the v_ view', () => {
    insert(raw, 'expenses', { ...entry('e2'), item: 'বিদ্যুৎ বিল', amount_poisha: 45000, corrects_id: 'e1' });
    expect(raw.prepare('SELECT id, amount_poisha FROM v_expenses').all()).toEqual([{ id: 'e2', amount_poisha: 45000 }]);
    expect(raw.prepare('SELECT COUNT(*) AS n FROM expenses').get()).toEqual({ n: 2 });
  });

  it('master data can still be updated', () => {
    raw.exec("UPDATE products SET sell_price_poisha = 6500 WHERE id = 'p1'");
    expect(raw.prepare('SELECT sell_price_poisha FROM products').get()).toEqual({ sell_price_poisha: 6500 });
  });
});

describe('v_stock = purchases − sales', () => {
  beforeEach(() => {
    insert(raw, 'products', { ...row('p1'), name: 'চাল', unit: 'kg', sell_price_poisha: 6000 });
    insert(raw, 'purchases', {
      ...entry('pu1'), product_id: 'p1', quantity: 50, buy_price_poisha: 5500, sell_price_poisha: 6000, total_poisha: 275000,
    });
    insert(raw, 'sales', {
      ...entry('s1'), product_id: 'p1', quantity: 2, sell_price_poisha: 6000, amount_poisha: 12000, cost_price_poisha: 5500,
    });
  });

  const stock = () => raw.prepare("SELECT stock FROM v_stock WHERE product_id = 'p1'").get();

  it('subtracts sales from purchases', () => {
    expect(stock()).toEqual({ stock: 48 });
  });

  it('uses the corrected quantity, not the original', () => {
    insert(raw, 'sales', {
      ...entry('s2'), product_id: 'p1', quantity: 1, sell_price_poisha: 6000, amount_poisha: 6000,
      cost_price_poisha: 5500, corrects_id: 's1',
    });
    expect(stock()).toEqual({ stock: 49 });
  });

  it('a credit sale needs a customer', () => {
    expect(() =>
      insert(raw, 'sales', {
        ...entry('s3'), product_id: 'p1', quantity: 1, sell_price_poisha: 6000, amount_poisha: 6000,
        cost_price_poisha: 5500, credit: 1,
      }),
    ).toThrow(/CHECK/);
  });

  it('enforces foreign keys', () => {
    expect(() =>
      insert(raw, 'sales', {
        ...entry('s4'), product_id: 'nope', quantity: 1, sell_price_poisha: 1, amount_poisha: 1, cost_price_poisha: 1,
      }),
    ).toThrow(/FOREIGN KEY/);
  });
});

describe('v4', () => {
  it('adds sales.line_no and voice_logs.stt_ok', () => {
    const cols = (t: string) => (raw.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
    expect(cols('sales')).toContain('line_no');
    expect(cols('voice_logs')).toContain('stt_ok');
  });

  it('stt_ok is 0, 1 or null', () => {
    raw.exec(`INSERT INTO voice_logs (id, transcript, device_name, device_id, created_at, updated_at) VALUES ('v', 't', 'd', 'd', 1, 1)`);
    expect(() => raw.exec(`UPDATE voice_logs SET stt_ok = 2 WHERE id = 'v'`)).toThrow();
    raw.exec(`UPDATE voice_logs SET stt_ok = 1 WHERE id = 'v'`);
  });
});


describe('v5', () => {
  it('adds the shop table (one row, renamable) and voice_logs.via', () => {
    insert(raw, 'shop', { ...row('shop'), name: 'রহমান স্টোর' });
    raw.exec(`UPDATE shop SET name = 'নতুন নাম' WHERE id = 'shop'`);
    expect(raw.prepare('SELECT name FROM shop').all()).toEqual([{ name: 'নতুন নাম' }]);
    const cols = (raw.prepare('PRAGMA table_info(voice_logs)').all() as { name: string }[]).map((c) => c.name);
    expect(cols).toContain('via');
  });

  it("via is null (voice/typed) or 'pick'", () => {
    raw.exec(`INSERT INTO voice_logs (id, transcript, device_name, device_id, created_at, updated_at, via) VALUES ('v', 't', 'd', 'd', 1, 1, 'pick')`);
    expect(() => raw.exec(`UPDATE voice_logs SET via = 'other' WHERE id = 'v'`)).toThrow();
  });
});

describe('upgrade keeps pilot data', () => {
  it('a v4 shop phone with sales, baki and logs migrates to the latest version untouched', async () => {
    const old = new DatabaseSync(':memory:');
    const a = adapter(old);
    await a.execAsync('PRAGMA foreign_keys = ON;');
    for (const sql of MIGRATIONS.slice(0, 4)) old.exec(sql);
    old.exec('PRAGMA user_version = 4');
    insert(old, 'devices', { ...row('d1'), device_name: 'আব্বু', role: 'owner' });
    insert(old, 'products', { ...row('p1'), name: 'চাল', unit: 'kg', sell_price_poisha: 6000 });
    insert(old, 'customers', { ...row('c1'), name: 'করিম' });
    insert(old, 'voice_logs', { ...row('v1'), transcript: 'করিম চাল ২ কেজি বাকি', device_name: 'আব্বু', outcome: 'saved', stt_ok: 1 });
    insert(old, 'sales', {
      ...entry('s1'), product_id: 'p1', quantity: 2, sell_price_poisha: 6000, amount_poisha: 12000, cost_price_poisha: 0,
      credit: 1, customer_id: 'c1', voice_log_id: 'v1', basket_id: 'b1', line_no: 1,
    });
    insert(old, 'ledger', { ...entry('l1'), party_id: 'c1', kind: 'baki', amount_poisha: 12000, basket_id: 'b1' });
    const dump = (t: string) => old.prepare(`SELECT * FROM ${t} ORDER BY id`).all();
    const before = Object.fromEntries(['devices', 'products', 'customers', 'voice_logs', 'sales', 'ledger'].map((t) => [t, dump(t)]));

    await expect(migrate(a)).resolves.toBe(4);
    expect(old.prepare('PRAGMA user_version').get()).toEqual({ user_version: SCHEMA_VERSION });
    for (const [t, rows] of Object.entries(before)) {
      // same rows and values; later versions may only add columns
      const oldCols = (r: object) => Object.keys(r);
      expect(
        dump(t).map((r, k) => Object.fromEntries(oldCols((rows as object[])[k]!).map((c) => [c, (r as Record<string, unknown>)[c]]))),
      ).toEqual(rows);
    }
    expect(old.prepare('SELECT via FROM voice_logs').get()).toEqual({ via: null });
    old.close();
  });
});

describe('v6', () => {
  it('voice_logs.intent, back-filled from parsed_json for existing pilot logs', async () => {
    const old = new DatabaseSync(':memory:');
    for (const sql of MIGRATIONS.slice(0, 5)) old.exec(sql);
    old.exec('PRAGMA user_version = 5');
    insert(old, 'voice_logs', { ...row('v1'), transcript: 'করিম ২০০ বাকি', device_name: 'আব্বু', parsed_json: JSON.stringify({ intent: 'baki' }), outcome: 'unsupported' });
    insert(old, 'voice_logs', { ...row('v2'), transcript: '', device_name: 'আব্বু', stt_error: 'no-speech', outcome: 'stt_error' });
    await migrate(adapter(old));
    expect(old.prepare('SELECT id, intent, outcome FROM voice_logs ORDER BY id').all()).toEqual([
      { id: 'v1', intent: 'baki', outcome: 'unsupported' },
      { id: 'v2', intent: null, outcome: 'stt_error' },
    ]);
    old.close();
  });
});

describe('v7 (Gemini audio experiment)', () => {
  it('a v6 shop phone keeps its pilot data; the new voice_logs columns start null', async () => {
    const old = new DatabaseSync(':memory:');
    const a = adapter(old);
    await a.execAsync('PRAGMA foreign_keys = ON;');
    for (const sql of MIGRATIONS.slice(0, 6)) old.exec(sql);
    old.exec('PRAGMA user_version = 6');
    insert(old, 'devices', { ...row('d1'), device_name: 'আব্বু', role: 'owner' });
    insert(old, 'products', { ...row('p1'), name: 'চাল', unit: 'kg', sell_price_poisha: 6000 });
    insert(old, 'customers', { ...row('c1'), name: 'করিম' });
    insert(old, 'voice_logs', {
      ...row('v1'), transcript: 'করিম চাল ২ কেজি বাকি', device_name: 'আব্বু', outcome: 'saved_edited', stt_ok: 1,
      parsed_json: JSON.stringify({ intent: 'sale', items: [{ product: 'চাল', quantity: { value: 2, unit: 'kg' } }] }),
      edits_json: '["items[0].quantity"]', final_json: '{"credit":true}', intent: 'sale', audio_path: 'file:///x/voice_1.wav', audio_status: 'local',
      source: 'voice', context_tab: 'sale',
    });
    insert(old, 'voice_logs', { ...row('v2'), transcript: '', device_name: 'আব্বু', stt_error: 'no-speech', outcome: 'stt_error', source: 'voice' });
    insert(old, 'sales', {
      ...entry('s1'), product_id: 'p1', quantity: 3, sell_price_poisha: 6000, amount_poisha: 18000, cost_price_poisha: 0,
      credit: 1, customer_id: 'c1', voice_log_id: 'v1', basket_id: 'b1', line_no: 1,
    });
    insert(old, 'ledger', { ...entry('l1'), party_id: 'c1', kind: 'baki', amount_poisha: 18000, basket_id: 'b1', voice_log_id: 'v1' });
    insert(old, 'expenses', { ...entry('e1'), item: 'বিদ্যুৎ বিল', amount_poisha: 50000 });
    const tables = ['devices', 'products', 'customers', 'voice_logs', 'sales', 'ledger', 'expenses'];
    const dump = (t: string) => old.prepare(`SELECT * FROM ${t} ORDER BY id`).all() as Record<string, unknown>[];
    const before = Object.fromEntries(tables.map((t) => [t, dump(t)]));

    await expect(migrate(a)).resolves.toBe(6);
    expect(old.prepare('PRAGMA user_version').get()).toEqual({ user_version: SCHEMA_VERSION });
    for (const t of tables) {
      const after = dump(t);
      expect(after.map((r, k) => Object.fromEntries(Object.keys(before[t]![k]!).map((c) => [c, r[c]])))).toEqual(before[t]);
    }
    expect(old.prepare('SELECT engine, parsed_by, android_json, gemini_json, gemini_ms FROM voice_logs WHERE id = ?').get('v1')).toEqual({
      engine: null, parsed_by: null, android_json: null, gemini_json: null, gemini_ms: null,
    });
    // entries are still append-only after the upgrade
    expect(() => old.exec("UPDATE sales SET quantity = 1 WHERE id = 's1'")).toThrow(/append-only/);
    old.close();
  });

  it('engine and parsed_by take only known values', () => {
    insert(raw, 'voice_logs', { ...row('v1'), transcript: 'চাল ২ কেজি', device_name: 'আব্বু', engine: 'both', parsed_by: 'android' });
    expect(() => insert(raw, 'voice_logs', { ...row('v2'), transcript: 'x', device_name: 'আব্বু', engine: 'openai' })).toThrow();
    expect(() => insert(raw, 'voice_logs', { ...row('v3'), transcript: 'x', device_name: 'আব্বু', parsed_by: 'both' })).toThrow();
  });
});
