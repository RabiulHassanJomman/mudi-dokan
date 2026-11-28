/**
 * When to sync. Pure TS (timers only), no RN imports; the app feeds it sign-in, network,
 * foreground/background and "something was saved".
 *
 * - runs on start (sign-in known), on "এখন সিঙ্ক করুন", when the network comes back, and
 *   a few seconds after each save (debounced)
 * - a failed run retries with backoff (2 s … 5 min); no polling: other phones' rows come
 *   through realtime listeners (changed-since queries) while the app is in the foreground
 * - without sign-in or network it just waits; the app works the same offline
 */
import type { DocData, FirstSyncResult, Remote, RemoteDoc, SyncEngine, SyncStats } from './engine';
import { SYNC_TABLES } from './tables';

export type SyncPhase = 'signed_out' | 'offline' | 'idle' | 'syncing' | 'error' | 'budget' | 'wiped';

export interface SyncStatus {
  phase: SyncPhase;
  email: string | null;
  lastError: string | null;
  stats: SyncStats | null;
  /** shop_adopted: "দোকানের নাম ও ক্যাশ আগের ফোন থেকে নেওয়া হয়েছে" (until the next sign-in). */
  notice: 'shop_adopted' | null;
  /** Another phone erased the shop (wiped_at) and this phone hasn't answered: sync is paused. */
  wipePending: number | null;
}

export interface ControllerHooks {
  /** After rows from other phones went in (re-point merged ones). Returns new local rows. */
  afterApply?: () => Promise<number>;
  /** First sync and the cloud already has the shop: take it over this phone's own setup. */
  adoptShop?: (shop: DocData) => Promise<boolean>;
  /** After the first pull from an account (merge screen, notice). */
  onFirstSync?: (r: FirstSyncResult) => void;
  /** Rows from other phones changed the data: screens reload. */
  onData?: () => void;
  /** The user said হ্যাঁ to "মুছবেন?" after another phone's wipe: erase this phone (files too). */
  wipeLocal?: () => Promise<void>;
  /** After each successful run (ফোনগুলো: remote logout, last seen). */
  afterSync?: () => void;
}

export const SAVE_DEBOUNCE_MS = 3_000;
const BACKOFF_MS = [2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 120_000, 300_000];

export class SyncController {
  private remote: Remote | null = null;
  private email: string | null = null;
  private online = true;
  private active = true;
  private running: Promise<void> | null = null;
  private again = false;
  private failures = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private unlisten: (() => void)[] = [];
  private status: SyncStatus = { phase: 'signed_out', email: null, lastError: null, stats: null, notice: null, wipePending: null };
  private subs = new Set<(s: SyncStatus) => void>();

  constructor(
    readonly engine: SyncEngine,
    private readonly hooks: ControllerHooks = {},
  ) {}

  // ── status ───────────────────────────────────────────────────

  get current(): SyncStatus {
    return this.status;
  }

  subscribe(fn: (s: SyncStatus) => void): () => void {
    this.subs.add(fn);
    fn(this.status);
    return () => this.subs.delete(fn);
  }

  private async publish(patch: Partial<SyncStatus>): Promise<void> {
    let stats = this.status.stats;
    try {
      stats = await this.engine.stats();
    } catch {
      // DB busy/closed: keep the last numbers
    }
    this.status = { ...this.status, ...patch, email: this.email, stats };
    for (const fn of this.subs) fn(this.status);
  }

  private idlePhase(): SyncPhase {
    if (!this.remote) return 'signed_out';
    if (!this.online) return 'offline';
    return 'idle';
  }

  // ── inputs ───────────────────────────────────────────────────

  /** Signed in (remote for shops/{uid}) or out (null). Local data stays either way. */
  async setAccount(account: { uid: string; email: string | null; remote: Remote } | null): Promise<void> {
    this.stopListening();
    this.clearTimers();
    if (this.running) await this.running.catch(() => undefined);
    this.remote = account?.remote ?? null;
    this.email = account?.email ?? null;
    this.engine.setRemote(this.remote);
    this.failures = 0;
    if (account) await this.engine.useAccount(account.uid);
    await this.publish({ phase: this.idlePhase(), lastError: null, notice: null, wipePending: account ? await this.engine.wipePending() : null });
    if (account) void this.syncNow();
  }

  setOnline(online: boolean): void {
    const back = online && !this.online;
    this.online = online;
    if (back) {
      this.failures = 0;
      void this.syncNow();
    } else if (!online) void this.publish({ phase: this.idlePhase() });
  }

  /** App in the foreground (listeners on) or background (listeners off). */
  setActive(active: boolean): void {
    if (active === this.active) return;
    this.active = active;
    if (!active) this.stopListening();
    else void this.syncNow();
  }

  private fullPull = false;

  /**
   * A backup was restored into this phone: before the next push, pull everything once so
   * restored rows the cloud already has are not sent again (only what's missing goes up).
   */
  restored(): Promise<void> {
    this.fullPull = true;
    return this.syncNow();
  }

  /**
   * "হ্যাঁ, এই ফোনেও মুছুন": another phone erased the shop. This phone erases itself (the
   * hook also removes files), notes the wipe as answered and starts fresh.
   */
  async acceptWipe(): Promise<void> {
    const at = await this.engine.wipePending();
    if (at === null) return;
    this.stopListening();
    await this.hooks.wipeLocal?.();
    await this.engine.acknowledgeWipe(at);
    this.hooks.onData?.();
    await this.publish({ phase: this.idlePhase(), wipePending: null });
    void this.syncNow();
  }

  /** "না": this phone keeps its data and stays paused (nothing goes up). Only reminds again after a restart. */
  keepAfterWipe(): void {
    // nothing changes: the pause is the meta key; the screens stop asking until the app restarts
  }

  /** "এই ফোনের তথ্য আবার পাঠান": the user chose to send this phone's data to the (erased) shop again. */
  async resumeUpload(): Promise<void> {
    this.stopListening();
    // the shop is empty: everything this phone has goes up again, not only what was unsent
    await this.engine.forgetSyncState();
    await this.engine.acknowledgeWipe();
    await this.publish({ phase: this.idlePhase(), wipePending: null });
    void this.syncNow();
  }

  /** Something was saved on this phone: push it in a few seconds. */
  localChange(): void {
    if (!this.remote) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.syncNow();
    }, SAVE_DEBOUNCE_MS);
  }

  // ── run ──────────────────────────────────────────────────────

  /** "এখন সিঙ্ক করুন" and every trigger. Resolves when this run (and any queued one) is done. */
  syncNow(): Promise<void> {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = this.loop().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async loop(): Promise<void> {
    let ok: boolean;
    do {
      this.again = false;
      ok = await this.runOnce();
    } while (ok && this.again && this.remote && this.online);
  }

  /** false = failed (a retry is scheduled). */
  private async runOnce(): Promise<boolean> {
    const remote = this.remote;
    if (!remote || !this.online) {
      await this.publish({ phase: this.idlePhase() });
      return true;
    }
    await this.publish({ phase: 'syncing' });
    try {
      // another phone erased the shop: this phone sends nothing and fetches nothing until the user answers
      const wiped = await this.engine.checkWipe();
      if (wiped !== null) {
        this.stopListening();
        await this.publish({ phase: 'wiped', lastError: null, wipePending: wiped });
        return true;
      }
      // first sync: pull (and take the cloud's shop) before pushing anything of this phone's
      const first = !(await this.engine.hasPulled()) ? await this.engine.firstSync(this.hooks.adoptShop) : null;
      if (first?.applied) await this.applied();
      if (this.fullPull && !first) {
        const n = await this.engine.pullAll();
        if (n) await this.applied();
      }
      this.fullPull = false;
      if (first?.adopted) await this.publish({ notice: 'shop_adopted' });
      const pushed = await this.engine.push();
      if (!this.unlisten.length) {
        const applied = first ? 0 : await this.engine.pull();
        if (applied) await this.applied();
        if (this.active && this.remote === remote) await this.listen();
        if (this.listenError) {
          const e = this.listenError;
          this.listenError = null;
          throw e;
        }
        if (first) this.hooks.onFirstSync?.(first);
      }
      const more = await this.engine.push();
      await this.engine.markSynced();
      this.failures = 0;
      this.hooks.afterSync?.();
      await this.publish({ phase: pushed.budgetHit || more.budgetHit ? 'budget' : 'idle', lastError: null, wipePending: null });
      return true;
    } catch (e) {
      this.failures++;
      await this.publish({ phase: 'error', lastError: errorText(e) });
      this.scheduleRetry();
      return false;
    }
  }

  private async applied(): Promise<void> {
    const local = this.hooks.afterApply ? await this.engine.exclusive(this.hooks.afterApply) : 0;
    this.hooks.onData?.();
    if (local) this.localChange();
  }

  private scheduleRetry(): void {
    if (this.retryTimer || !this.remote || !this.online) return;
    const ms = BACKOFF_MS[Math.min(this.failures - 1, BACKOFF_MS.length - 1)]!;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.syncNow();
    }, ms);
  }

  /** Delay of the next retry (tests, status). */
  get retryInMs(): number | null {
    return this.retryTimer ? BACKOFF_MS[Math.min(this.failures - 1, BACKOFF_MS.length - 1)]! : null;
  }

  private listenError: unknown = null;

  private async listen(): Promise<void> {
    const remote = this.remote;
    if (!remote) return;
    this.listenError = null;
    // the shop is erased by another phone: look at once (checkWipe), don't wait for the next save
    this.unlisten.push(
      remote.listenWipe(
        (t) => {
          if (t) void this.syncNow();
        },
        () => undefined, // the table listeners report a lost connection
      ),
    );
    for (const t of SYNC_TABLES) {
      if (this.listenError) return;
      const since = await this.engine.since(t.name);
      this.unlisten.push(
        remote.listen(
          t.name,
          since,
          (docs: RemoteDoc[]) => void this.onDocs(t.name, docs),
          (e) => {
            // permission / network: drop listeners, a retry re-attaches them
            if (this.listenError) return;
            this.listenError = e;
            this.stopListening();
            if (this.running) return; // runOnce reports it
            this.listenError = null;
            this.failures++;
            void this.publish({ phase: 'error', lastError: errorText(e) });
            this.scheduleRetry();
          },
        ),
      );
    }
  }

  private async onDocs(table: string, docs: RemoteDoc[]): Promise<void> {
    try {
      const n = await this.engine.receive(table, docs);
      if (n) await this.applied();
      await this.publish({});
    } catch (e) {
      await this.publish({ lastError: errorText(e) });
    }
  }

  private stopListening(): void {
    for (const off of this.unlisten.splice(0)) off();
  }

  private clearTimers(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.retryTimer = this.saveTimer = null;
  }

  /** App closing (tests). */
  dispose(): void {
    this.stopListening();
    this.clearTimers();
    this.subs.clear();
  }
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
