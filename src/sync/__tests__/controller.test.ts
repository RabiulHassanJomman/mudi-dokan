/** When sync runs: start, debounced save, network back, backoff, listeners, sign-out. */
import { createVoiceLog, ensureDevice, repointMerged, saveSetup, type Writer } from '../../db/repo';
import { migratedDb } from '../../db/__tests__/nodeDb';
import { SAVE_DEBOUNCE_MS, SyncController, type SyncStatus } from '../controller';
import { SyncEngine } from '../engine';
import { FakeCloud } from './fakeRemote';

async function phone(cloud: FakeCloud, name: string) {
  const db = await migratedDb();
  let n = 0;
  let t = 1_794_000_000_000;
  const w: Writer = { deviceId: `dev-${name}`, deviceName: name, newId: () => `${name}-${++n}`, now: () => (t += 1000) };
  await ensureDevice(db, w, 'owner');
  const engine = new SyncEngine(db, () => t);
  const events = { data: 0, first: 0 };
  const ctl = new SyncController(engine, {
    afterApply: () => repointMerged(db, w),
    onData: () => events.data++,
    onFirstSync: () => events.first++,
  });
  const remote = cloud.client('uid');
  const signIn = () => ctl.setAccount({ uid: 'uid', email: 'shop@example.com', remote });
  return { db, w, engine, ctl, remote, events, signIn };
}

/** Let queued promises (timers advanced by jest) settle. */
const flush = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
  await new Promise((r) => jest.requireActual<typeof globalThis>('timers').setImmediate(r));
};

afterEach(() => jest.useRealTimers());

describe('SyncController', () => {
  it('signed out: nothing runs, status says so; sign-in uploads everything', async () => {
    const cloud = new FakeCloud();
    const a = await phone(cloud, 'A');
    const seen: SyncStatus[] = [];
    a.ctl.subscribe((s) => seen.push(s));
    a.ctl.localChange();
    await a.ctl.syncNow();
    expect(cloud.writes).toBe(0);
    expect(a.ctl.current.phase).toBe('signed_out');
    await a.signIn();
    await a.ctl.syncNow();
    expect(cloud.writes).toBe(1);
    expect(a.ctl.current).toMatchObject({ phase: 'idle', email: 'shop@example.com', stats: { pending: 0, writesToday: 1 } });
    expect(a.events.first).toBe(1);
    expect(seen.map((s) => s.phase)).toContain('syncing');
    a.ctl.dispose();
  });

  it('a save is pushed after the debounce, once for many saves', async () => {
    jest.useFakeTimers();
    const cloud = new FakeCloud();
    const a = await phone(cloud, 'A');
    await a.signIn();
    await a.ctl.syncNow();
    const batches = cloud.batches;
    for (let i = 0; i < 3; i++) {
      await createVoiceLog(a.db, a.w, { transcript: `x${i}`, source: 'typed', contextTab: 'sale' });
      a.ctl.localChange();
    }
    jest.advanceTimersByTime(SAVE_DEBOUNCE_MS - 1);
    await flush();
    expect(cloud.batches).toBe(batches);
    jest.advanceTimersByTime(1);
    await flush();
    await a.ctl.syncNow();
    expect(cloud.batches).toBe(batches + 1);
    expect(cloud.docs('uid', 'voice_logs')).toHaveLength(3);
    a.ctl.dispose();
  });

  it('offline: waits; network back → pushes', async () => {
    const cloud = new FakeCloud();
    const a = await phone(cloud, 'A');
    a.ctl.setOnline(false);
    await a.signIn();
    await a.ctl.syncNow();
    expect(a.ctl.current.phase).toBe('offline');
    expect(cloud.writes).toBe(0);
    a.ctl.setOnline(true);
    await a.ctl.syncNow();
    expect(cloud.writes).toBe(1);
    a.ctl.dispose();
  });

  it('a failure retries with growing backoff and recovers', async () => {
    jest.useFakeTimers();
    const cloud = new FakeCloud();
    const a = await phone(cloud, 'A');
    a.remote.offline = true; // the network says online, the server doesn't answer
    await a.signIn();
    await a.ctl.syncNow();
    expect(a.ctl.current.phase).toBe('error');
    expect(a.ctl.retryInMs).toBe(2000);
    jest.advanceTimersByTime(2000);
    await flush();
    await a.ctl.syncNow().catch(() => undefined);
    expect(a.ctl.retryInMs).toBeGreaterThan(2000);
    a.remote.offline = false;
    await a.ctl.syncNow();
    expect(a.ctl.current.phase).toBe('idle');
    expect(a.ctl.retryInMs).toBeNull();
    expect(cloud.writes).toBe(1);
    a.ctl.dispose();
  });

  it('realtime: the other phone’s save shows up, screens told to reload', async () => {
    const cloud = new FakeCloud();
    const a = await phone(cloud, 'A');
    const b = await phone(cloud, 'B');
    await a.signIn();
    await b.signIn();
    await a.ctl.syncNow();
    await b.ctl.syncNow();
    const before = b.events.data;
    await saveSetup(a.db, a.w, { shopName: 'রহিম স্টোর', deviceName: 'আব্বু', role: 'owner', openingCashPoisha: 100000 }, '2026-11-12');
    await a.ctl.syncNow();
    await flush();
    await b.engine.exclusive(async () => undefined);
    await flush();
    expect(b.db.raw.prepare('SELECT name FROM shop').get()).toEqual({ name: 'রহিম স্টোর' });
    expect(b.events.data).toBeGreaterThan(before);
    a.ctl.dispose();
    b.ctl.dispose();
  });

  it('background: listeners off (no reads); foreground: catches up', async () => {
    const cloud = new FakeCloud();
    const a = await phone(cloud, 'A');
    const b = await phone(cloud, 'B');
    await a.signIn();
    await b.signIn();
    await a.ctl.syncNow();
    await b.ctl.syncNow();
    b.ctl.setActive(false);
    await saveSetup(a.db, a.w, { shopName: 'দোকান', deviceName: 'আব্বু', role: 'owner', openingCashPoisha: 100000 }, '2026-11-12');
    await a.ctl.syncNow();
    await flush();
    expect(b.db.raw.prepare('SELECT COUNT(*) AS n FROM shop').get()).toEqual({ n: 0 });
    b.ctl.setActive(true);
    await b.ctl.syncNow();
    expect(b.db.raw.prepare('SELECT name FROM shop').get()).toEqual({ name: 'দোকান' });
    a.ctl.dispose();
    b.ctl.dispose();
  });

  it('sign-out keeps local data and stops syncing', async () => {
    const cloud = new FakeCloud();
    const a = await phone(cloud, 'A');
    await a.signIn();
    await a.ctl.syncNow();
    await a.ctl.setAccount(null);
    await createVoiceLog(a.db, a.w, { transcript: 'x', source: 'typed', contextTab: 'sale' });
    await a.ctl.syncNow();
    expect(cloud.docs('uid', 'voice_logs')).toHaveLength(0);
    expect(a.ctl.current).toMatchObject({ phase: 'signed_out', email: null });
    expect(a.db.raw.prepare('SELECT COUNT(*) AS n FROM devices').get()).toEqual({ n: 1 });
    a.ctl.dispose();
  });

  it('a listener error (e.g. rules) drops listeners and retries', async () => {
    jest.useFakeTimers();
    const cloud = new FakeCloud();
    const a = await phone(cloud, 'A');
    a.remote.failListen = true;
    await a.signIn();
    await a.ctl.syncNow();
    expect(a.ctl.current).toMatchObject({ phase: 'error', lastError: 'permission-denied' });
    expect(a.ctl.retryInMs).not.toBeNull();
    a.ctl.dispose();
  });
});
