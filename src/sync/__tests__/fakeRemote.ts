/** Test double for Firestore: one shared in-memory store, server clock, realtime listeners, offline switch. */
import type { DocData, Remote, RemoteDoc, Tombstone } from '../engine';

interface Stored {
  data: DocData;
  serverAt: number;
}

export class FakeCloud {
  /** shops/{uid}/{table}/{id} */
  store = new Map<string, Map<string, Map<string, Stored>>>();
  clock = 1_000;
  writes = 0;
  reads = 0;
  batches = 0;
  private listeners: { uid: string; table: string; since: number; cb: (d: RemoteDoc[]) => void }[] = [];
  /** shops/{uid}/meta/wipe */
  tombstones = new Map<string, Tombstone>();
  private wipeListeners: { uid: string; cb: (t: Tombstone | null) => void }[] = [];
  deletes = 0;

  /** Every document of the shop (rules: delete is allowed for the shop's own account). */
  deleteAll(uid: string): number {
    let n = 0;
    for (const c of this.store.get(uid)?.values() ?? []) {
      n += c.size;
      c.clear();
    }
    this.deletes += n;
    return n;
  }

  writeWipe(uid: string, t: Tombstone) {
    this.tombstones.set(uid, { ...t });
    for (const l of this.wipeListeners.filter((x) => x.uid === uid)) l.cb({ ...t });
  }

  listenWipe(uid: string, cb: (t: Tombstone | null) => void) {
    const l = { uid, cb };
    this.wipeListeners.push(l);
    const t = this.tombstones.get(uid);
    if (t) cb({ ...t });
    return () => {
      this.wipeListeners = this.wipeListeners.filter((x) => x !== l);
    };
  }

  private coll(uid: string, table: string) {
    let shop = this.store.get(uid);
    if (!shop) this.store.set(uid, (shop = new Map()));
    let c = shop.get(table);
    if (!c) shop.set(table, (c = new Map()));
    return c;
  }

  docs(uid: string, table: string): DocData[] {
    return [...this.coll(uid, table).values()].map((s) => s.data);
  }

  /** A client for one phone signed in to `uid`. */
  client(uid: string): FakeRemote {
    return new FakeRemote(this, uid);
  }

  write(uid: string, table: string, docs: readonly { id: string; data: DocData }[]) {
    if (docs.length > 500) throw new Error('batch too large');
    const at = ++this.clock;
    this.batches++;
    const c = this.coll(uid, table);
    for (const d of docs) {
      c.set(d.id, { data: { ...d.data }, serverAt: at });
      this.writes++;
    }
    for (const l of this.listeners.filter((x) => x.uid === uid && x.table === table)) {
      const changed = docs.map((d) => ({ id: d.id, data: { ...d.data }, serverAt: at }));
      this.reads += changed.length;
      l.cb(changed);
    }
  }

  fetch(uid: string, table: string, since: number): RemoteDoc[] {
    const out = [...this.coll(uid, table).entries()]
      .filter(([, s]) => s.serverAt > since)
      .map(([id, s]) => ({ id, data: { ...s.data }, serverAt: s.serverAt }));
    this.reads += Math.max(1, out.length);
    return out;
  }

  listen(uid: string, table: string, since: number, cb: (d: RemoteDoc[]) => void) {
    const l = { uid, table, since, cb };
    this.listeners.push(l);
    const initial = this.fetch(uid, table, since);
    if (initial.length) cb(initial);
    return () => {
      this.listeners = this.listeners.filter((x) => x !== l);
    };
  }
}

export class FakeRemote implements Remote {
  offline = false;
  failListen = false;
  constructor(
    private readonly cloud: FakeCloud,
    readonly uid: string,
  ) {}

  private check() {
    if (this.offline) throw new Error('unavailable: offline');
  }

  async write(table: string, docs: readonly { id: string; data: DocData }[]) {
    this.check();
    this.cloud.write(this.uid, table, docs);
  }

  async fetchSince(table: string, since: number) {
    this.check();
    return this.cloud.fetch(this.uid, table, since);
  }

  listen(table: string, since: number, onDocs: (d: RemoteDoc[]) => void, onError?: (e: unknown) => void) {
    if (this.failListen) {
      onError?.(new Error('permission-denied'));
      return () => undefined;
    }
    return this.cloud.listen(this.uid, table, since, onDocs);
  }

  async deleteAll() {
    this.check();
    return this.cloud.deleteAll(this.uid);
  }

  async readWipe() {
    this.check();
    const t = this.cloud.tombstones.get(this.uid);
    return t ? { ...t } : null;
  }

  async writeWipe(t: Tombstone) {
    this.check();
    this.cloud.writeWipe(this.uid, t);
  }

  listenWipe(onChange: (t: Tombstone | null) => void) {
    return this.cloud.listenWipe(this.uid, onChange);
  }
}
