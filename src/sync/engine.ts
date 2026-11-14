/**
 * Sync engine: SQLite ⇄ a remote document store (Firestore in the app, a fake in tests).
 * Pure TS, no RN imports.
 *
 * Push: rows this phone hasn't pushed at their current updated_at (sync_state), in batches.
 * Pull: per table, documents the server stamped after the cursor; they land in sync_inbox
 *   first and are applied from there (parents first). A row whose parent hasn't arrived yet
 *   (foreign key) waits in the inbox for the next round.
 * Apply: entries = insert if new (union by UUID); mutable rows = last write wins.
 */
import type { Db } from '../db/repo';
import { businessDate } from '../domain/cash';
import { BATCH_SIZE, DAILY_WRITE_BUDGET, PULL_OVERLAP_MS, SYNC_TABLES, type SyncTable, tableSpec } from './tables';

type Bind = string | number | null;
export type DocData = Record<string, unknown>;

export interface RemoteDoc {
  id: string;
  data: DocData;
  /** Server commit time (ms); null = this client's own write, not confirmed yet. */
  serverAt: number | null;
}

/** The document store, scoped to one shop (shops/{uid}). */
export interface Remote {
  /** One atomic batch (≤ BATCH_SIZE docs); the store stamps each with its server time. */
  write(table: string, docs: readonly { id: string; data: DocData }[]): Promise<void>;
  /** Documents stamped after `since` (ms). */
  fetchSince(table: string, since: number): Promise<RemoteDoc[]>;
  /** Realtime: documents stamped after `since`, now and whenever they change. Returns unsubscribe. */
  listen(table: string, since: number, onDocs: (docs: RemoteDoc[]) => void, onError: (e: unknown) => void): () => void;
}

export interface SyncStats {
  lastSyncAt: number | null;
  pending: number;
  waiting: number;
  writesToday: number;
  readsToday: number;
  /** The account already had a shop when this phone first synced (it joined that shop). */
  cloudShop: boolean;
}

export interface FirstSyncResult {
  applied: number;
  cloudShop: boolean;
  /** Something of this phone's (shop name, opening cash) was replaced by the cloud's. */
  adopted: boolean;
}

export type PushResult = { pushed: number; budgetHit: boolean };

const META_UID = 'uid';
const META_LAST = 'last_sync_at';
const META_DAY = 'count_day';
const META_WRITES = 'writes_n';
const META_READS = 'reads_n';
const META_CLOUD_SHOP = 'cloud_shop';
const cursorKey = (t: string) => `pull:${t}`;

export class SyncEngine {
  private cols = new Map<string, string[]>();
  /** True while applying pulled rows (the app's change listener ignores those writes). */
  applying = false;

  constructor(
    private readonly db: Db,
    private readonly now: () => number = Date.now,
  ) {}

  private queue: Promise<unknown> = Promise.resolve();

  /**
   * Runs `fn` after every earlier engine call: listeners fire in parallel, and SQLite has
   * one transaction per connection. Other DB work that must not overlap sync uses this too.
   */
  exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  // ── meta ─────────────────────────────────────────────────────

  async getMeta(key: string): Promise<string | null> {
    const r = await this.db.getFirstAsync<{ value: string | null }>('SELECT value FROM sync_meta WHERE key = ?', key);
    return r?.value ?? null;
  }

  async setMeta(key: string, value: string | number | null): Promise<void> {
    await this.db.runAsync(
      'INSERT INTO sync_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      key,
      value === null ? null : String(value),
    );
  }

  /**
   * Called on sign-in. Another account than last time = another shop: forget what was
   * pushed and pulled, so everything here goes up to the new one. Returns true if reset.
   */
  useAccount(uid: string): Promise<boolean> {
    return this.exclusive(() => this.useAccountNow(uid));
  }

  private async useAccountNow(uid: string): Promise<boolean> {
    const was = await this.getMeta(META_UID);
    if (was === uid) return false;
    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync('DELETE FROM sync_state');
      await this.db.runAsync('DELETE FROM sync_inbox');
      await this.db.runAsync("DELETE FROM sync_meta WHERE key LIKE 'pull:%' OR key IN (?, ?)", META_LAST, META_CLOUD_SHOP);
      await this.setMeta(META_UID, uid);
    });
    return true;
  }

  /** Has this phone ever pulled from the current account? (first sync = no) */
  async hasPulled(): Promise<boolean> {
    const r = await this.db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM sync_meta WHERE key LIKE 'pull:%'");
    return (r?.n ?? 0) > 0;
  }

  private async bump(key: typeof META_WRITES | typeof META_READS, n: number): Promise<void> {
    if (n <= 0) return;
    const day = businessDate(this.now());
    if ((await this.getMeta(META_DAY)) !== day) {
      await this.setMeta(META_DAY, day);
      await this.setMeta(META_WRITES, 0);
      await this.setMeta(META_READS, 0);
    }
    await this.setMeta(key, Number((await this.getMeta(key)) ?? 0) + n);
  }

  private async today(key: typeof META_WRITES | typeof META_READS): Promise<number> {
    if ((await this.getMeta(META_DAY)) !== businessDate(this.now())) return 0;
    return Number((await this.getMeta(key)) ?? 0);
  }

  async stats(): Promise<SyncStats> {
    const last = await this.getMeta(META_LAST);
    const waiting = await this.db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM sync_inbox');
    return {
      lastSyncAt: last ? Number(last) : null,
      pending: await this.pendingCount(),
      waiting: waiting?.n ?? 0,
      writesToday: await this.today(META_WRITES),
      readsToday: await this.today(META_READS),
      cloudShop: (await this.getMeta(META_CLOUD_SHOP)) === '1',
    };
  }

  async markSynced(): Promise<void> {
    await this.setMeta(META_LAST, this.now());
  }

  // ── columns ──────────────────────────────────────────────────

  private async columns(table: string): Promise<string[]> {
    let c = this.cols.get(table);
    if (!c) {
      const rows = await this.db.getAllAsync<{ name: string }>('SELECT name FROM pragma_table_info(?)', table);
      c = rows.map((r) => r.name);
      this.cols.set(table, c);
    }
    return c;
  }

  // ── push ─────────────────────────────────────────────────────

  private pendingSql = (t: string, select: string) =>
    `SELECT ${select} FROM ${t} r LEFT JOIN sync_state s ON s.tbl = '${t}' AND s.row_id = r.id
     WHERE s.pushed_at IS NULL OR r.updated_at > s.pushed_at`;

  async pendingCount(): Promise<number> {
    let n = 0;
    for (const t of SYNC_TABLES) {
      const r = await this.db.getFirstAsync<{ n: number }>(this.pendingSql(t.name, 'COUNT(*) AS n'));
      n += r?.n ?? 0;
    }
    return n;
  }

  /** Pushes every pending row, parents first. Stops at the daily write budget. Throws on a failed batch. */
  push(): Promise<PushResult> {
    return this.exclusive(() => this.pushNow());
  }

  private async pushNow(): Promise<PushResult> {
    let pushed = 0;
    for (const t of SYNC_TABLES) {
      for (;;) {
        const room = DAILY_WRITE_BUDGET - (await this.today(META_WRITES));
        if (room <= 0) return { pushed, budgetHit: true };
        const rows = await this.db.getAllAsync<Record<string, Bind>>(
          `${this.pendingSql(t.name, 'r.*')} ORDER BY r.created_at, r.id LIMIT ?`,
          Math.min(BATCH_SIZE, room),
        );
        if (!rows.length) break;
        await this.remoteWrite(t, rows);
        pushed += rows.length;
      }
    }
    return { pushed, budgetHit: false };
  }

  private remote: Remote | null = null;
  setRemote(r: Remote | null): void {
    this.remote = r;
  }
  private need(): Remote {
    if (!this.remote) throw new Error('sync: not signed in');
    return this.remote;
  }

  private async remoteWrite(t: SyncTable, rows: Record<string, Bind>[]): Promise<void> {
    const docs = rows.map((r) => ({ id: String(r.id), data: toDoc(t, r) }));
    await this.need().write(t.name, docs);
    await this.db.withTransactionAsync(async () => {
      for (const r of rows) await this.markPushed(t.name, String(r.id), Number(r.updated_at));
    });
    await this.bump(META_WRITES, rows.length);
  }

  private markPushed(table: string, id: string, at: number) {
    return this.db.runAsync(
      `INSERT INTO sync_state (tbl, row_id, pushed_at) VALUES (?, ?, ?)
       ON CONFLICT(tbl, row_id) DO UPDATE SET pushed_at = MAX(pushed_at, excluded.pushed_at)`,
      table,
      id,
      at,
    );
  }

  // ── pull ─────────────────────────────────────────────────────

  async cursor(table: string): Promise<number> {
    return Number((await this.getMeta(cursorKey(table))) ?? 0);
  }

  /** Where a fetch or listener should start: a little before the cursor (see PULL_OVERLAP_MS). */
  async since(table: string): Promise<number> {
    const c = await this.cursor(table);
    return c > 0 ? c - PULL_OVERLAP_MS : 0;
  }

  /** One-shot pull of every table, then apply. Returns rows applied. */
  pull(): Promise<number> {
    return this.exclusive(async () => {
      for (const t of SYNC_TABLES) {
        const docs = await this.need().fetchSince(t.name, await this.since(t.name));
        await this.store(t.name, docs);
      }
      return this.applyNow();
    });
  }

  /**
   * Every document of every table, from the start (cursor ignored), then apply. After a
   * backup restore: rows the cloud already has (same version) get marked as pushed, so the
   * next push sends only what the cloud is missing.
   */
  pullAll(): Promise<number> {
    return this.exclusive(async () => {
      for (const t of SYNC_TABLES) {
        const docs = await this.need().fetchSince(t.name, 0);
        await this.store(t.name, docs);
      }
      return this.applyNow();
    });
  }

  /**
   * First sync with an account (before anything is pushed): pull everything; if the cloud
   * already has the shop, its row wins over this phone's whatever the clocks say, and
   * `adopt` replaces what this phone set up on its own (opening cash).
   */
  firstSync(adopt?: (shop: DocData) => Promise<boolean>): Promise<FirstSyncResult> {
    return this.exclusive(async () => {
      let shop: RemoteDoc | undefined;
      for (const t of SYNC_TABLES) {
        const docs = await this.need().fetchSince(t.name, await this.since(t.name));
        if (t.name === 'shop') shop = docs.find((d) => d.serverAt !== null);
        await this.store(t.name, docs);
      }
      if (shop) await this.db.runAsync("DELETE FROM sync_inbox WHERE tbl = 'shop'");
      const applied = await this.applyNow();
      let adopted = false;
      if (shop) {
        const doc: DocData = { ...shop.data, id: shop.id };
        adopted = adopt ? await adopt(doc) : false;
        await this.markPushed('shop', shop.id, Number(doc.updated_at));
      }
      await this.setMeta(META_CLOUD_SHOP, shop ? 1 : 0);
      return { applied, cloudShop: !!shop, adopted };
    });
  }

  /**
   * Pulled documents → inbox, cursor forward. Own unconfirmed writes (serverAt null) are
   * skipped: this phone has them. Applies right away unless `apply` is false.
   */
  receive(table: string, docs: readonly RemoteDoc[]): Promise<number> {
    return this.exclusive(async () => {
      await this.store(table, docs);
      return this.applyNow();
    });
  }

  private async store(table: string, docs: readonly RemoteDoc[]): Promise<void> {
    const confirmed = docs.filter((d): d is RemoteDoc & { serverAt: number } => d.serverAt !== null);
    if (!tableSpec(table)) return;
    if (confirmed.length) {
      await this.db.withTransactionAsync(async () => {
        for (const d of confirmed) {
          await this.db.runAsync(
            `INSERT INTO sync_inbox (tbl, row_id, data_json, server_at) VALUES (?, ?, ?, ?)
             ON CONFLICT(tbl, row_id) DO UPDATE SET data_json = excluded.data_json, server_at = excluded.server_at
             WHERE excluded.server_at >= sync_inbox.server_at`,
            table,
            d.id,
            JSON.stringify({ ...d.data, id: d.id }),
            d.serverAt,
          );
        }
        const max = Math.max(...confirmed.map((d) => d.serverAt));
        if (max > (await this.cursor(table))) await this.setMeta(cursorKey(table), max);
      });
      await this.bump(META_READS, confirmed.length);
    }
  }

  /**
   * Applies the inbox, parents first, in rounds until nothing more goes in. Rows that still
   * fail (a parent not here yet, or a newer app's value) stay for the next time.
   */
  applyInbox(): Promise<number> {
    return this.exclusive(() => this.applyNow());
  }

  private async applyNow(): Promise<number> {
    let applied = 0;
    this.applying = true;
    try {
      for (let round = 0; round < 10; round++) {
        let progress = 0;
        await this.db.withTransactionAsync(async () => {
          for (const t of SYNC_TABLES) {
            const rows = await this.db.getAllAsync<{ row_id: string; data_json: string }>(
              'SELECT row_id, data_json FROM sync_inbox WHERE tbl = ?',
              t.name,
            );
            const docs = rows.map((r) => JSON.parse(r.data_json) as Record<string, unknown>);
            // a correction after the row it corrects; merged_into after its target
            docs.sort((a, b) => Number(a.created_at) - Number(b.created_at) || String(a.id).localeCompare(String(b.id)));
            for (const d of docs) {
              if (await this.applyRow(t, d)) {
                await this.db.runAsync('DELETE FROM sync_inbox WHERE tbl = ? AND row_id = ?', t.name, String(d.id));
                progress++;
              }
            }
          }
        });
        applied += progress;
        if (!progress) break;
      }
    } finally {
      this.applying = false;
    }
    return applied;
  }

  /** true = applied (or already here / older than ours); false = try again later. */
  private async applyRow(t: SyncTable, doc: Record<string, unknown>): Promise<boolean> {
    const local = await this.columns(t.name);
    const cols = local.filter((c) => c in doc && !t.localOnly.includes(c));
    const vals = cols.map((c) => toBind(doc[c]));
    const id = String(doc.id);
    const updatedAt = Number(doc.updated_at);
    const ph = cols.map(() => '?').join(', ');
    try {
      if (t.kind === 'entry') {
        await this.db.runAsync(`INSERT INTO ${t.name} (${cols.join(', ')}) VALUES (${ph}) ON CONFLICT(id) DO NOTHING`, ...vals);
      } else {
        const set = cols.filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`).join(', ');
        await this.db.runAsync(
          `INSERT INTO ${t.name} (${cols.join(', ')}) VALUES (${ph})
           ON CONFLICT(id) DO UPDATE SET ${set}
           WHERE excluded.updated_at > ${t.name}.updated_at
              OR (excluded.updated_at = ${t.name}.updated_at AND excluded.device_id > ${t.name}.device_id)`,
          ...vals,
        );
      }
    } catch (e) {
      if (__DEV_LOG__) console.warn(`sync: ${t.name} ${id} waits`, e);
      return false;
    }
    const mine = await this.db.getFirstAsync<{ updated_at: number; device_id: string }>(
      `SELECT updated_at, device_id FROM ${t.name} WHERE id = ?`,
      id,
    );
    if (mine && mine.updated_at === updatedAt && mine.device_id === doc.device_id) {
      // ours and theirs are the same version now → nothing to push back
      await this.markPushed(t.name, id, updatedAt);
    } else if (mine) {
      // ours won (newer): the cloud has the losing version, so send ours again
      await this.db.runAsync(
        `INSERT INTO sync_state (tbl, row_id, pushed_at) VALUES (?, ?, -1)
         ON CONFLICT(tbl, row_id) DO UPDATE SET pushed_at = -1`,
        t.name,
        id,
      );
    }
    return true;
  }
}

/** Set to true to log rows that wait in the inbox. */
let __DEV_LOG__ = false;
export const setSyncDebug = (on: boolean) => {
  __DEV_LOG__ = on;
};

function toDoc(t: SyncTable, r: Record<string, Bind>): DocData {
  const d: DocData = {};
  for (const [k, v] of Object.entries(r)) if (!t.localOnly.includes(k)) d[k] = v;
  return d;
}

function toBind(v: unknown): Bind {
  if (v === undefined || v === null) return null;
  if (typeof v === 'number' || typeof v === 'string') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return JSON.stringify(v);
}
