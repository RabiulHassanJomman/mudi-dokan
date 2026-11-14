import { basketFromParse } from '../../domain/basket';
import { entryFromParse } from '../../domain/entry';
import { parseCommand } from '../../parser';
import {
  createVoiceLog,
  ensureDevice,
  findProducts,
  getVoiceLog,
  knownNames,
  saveBasket,
  saveEntry,
  setGeminiResult,
  setOutcome,
  type Db,
  type Writer,
} from '../../db/repo';
import { migratedDb, testWriter } from '../../db/__tests__/nodeDb';
import {
  BACKOFF_MS,
  MAX_FORM_ATTEMPTS,
  MIN_GAP_MS,
  RATE_WAIT_MS,
  RateGate,
  classify,
  discardPending,
  enqueueUnderstanding,
  nextReady,
  pendingCounts,
  pendingItems,
  runUnderstandQueue,
  type UnderstandResult,
} from '../understand';

const T0 = 1_763_000_000_000;

type TestDb = Awaited<ReturnType<typeof migratedDb>>;

async function shop() {
  const db = await migratedDb();
  const w = testWriter(T0);
  await ensureDevice(db, w, 'owner');
  return { db, w };
}

/** A command said while offline: the clip, tab and time wait in the queue. */
async function said(db: TestDb, w: Writer, text: string, tab = 'sale', at = T0 + 1000) {
  const id = await createVoiceLog(db, w, { transcript: '', source: 'voice', contextTab: tab, audioPath: `file:///doc/${text}.aac`, engine: 'gemini', keepPending: true });
  await db.runAsync('UPDATE voice_logs SET created_at = ? WHERE id = ?', at, id);
  await enqueueUnderstanding(db, id, tab, at);
  return id;
}

/** Fake Gemini: understands with the rule parser (the clip's file name is what was said). */
function fakeGemini(db: Db, w: Writer, script: Record<string, UnderstandResult | 'ok'> = {}) {
  const calls: { id: string; at: number }[] = [];
  const fn = async (id: string, clip: string, tab: string): Promise<UnderstandResult> => {
    calls.push({ id, at: clock.now });
    const s = script[id];
    if (s && s !== 'ok') return s;
    const text = decodeURIComponent(clip.split('/').pop()!.replace(/\.aac$/, ''));
    const names = await knownNames(db);
    const parsed = parseCommand(text, { tab: tab as 'sale', knownProducts: names.products, knownCustomers: names.customers });
    await setGeminiResult(db, w, id, { model: 'm', parsed, transcript: text, error: null, ms: 900, usage: null });
    return { ok: true, parsed, error: null };
  };
  return { fn, calls };
}

const clock = { now: T0 + 10_000 };
const deps = (db: Db, understand: (id: string, clip: string, tab: string) => Promise<UnderstandResult>, gate = new RateGate()) => ({
  db,
  understand,
  gate,
  now: () => clock.now,
  sleep: async (ms: number) => {
    clock.now += ms;
  },
});

beforeEach(() => {
  clock.now = T0 + 10_000;
});

describe('classify', () => {
  it('understood / not understood / no key', () => {
    expect(classify({ ok: true, parsed: { intent: 'sale' }, error: null })).toEqual({ kind: 'ready' });
    expect(classify({ ok: true, parsed: { intent: 'unknown' }, error: null })).toEqual({ kind: 'unclear' });
    expect(classify({ ok: false, parsed: null, error: 'error: no EXPO_PUBLIC_GEMINI_KEY in this build' })).toEqual({ kind: 'nokey' });
  });
  it('429, overload, offline, bad key, bad form', () => {
    expect(classify({ ok: false, parsed: null, error: 'api: HTTP 429: quota' })).toMatchObject({ stop: 'rate', waitMs: RATE_WAIT_MS });
    expect(classify({ ok: false, parsed: null, error: 'api: HTTP 503: overloaded' })).toMatchObject({ stop: 'rate' });
    expect(classify({ ok: false, parsed: null, error: 'api: network: Network request failed' })).toMatchObject({ stop: 'offline' });
    expect(classify({ ok: false, parsed: null, error: 'timeout: no answer in 8000 ms' })).toMatchObject({ stop: 'offline' });
    expect(classify({ ok: false, parsed: null, error: 'api: HTTP 403: API key' })).toMatchObject({ stop: 'error' });
    expect(classify({ ok: false, parsed: null, error: 'invalid: bad intent' })).toMatchObject({ stop: null, form: true });
  });
});

describe('RateGate', () => {
  it('15 requests a minute: calls are MIN_GAP_MS apart', () => {
    const g = new RateGate();
    expect(g.waitMs(1000)).toBe(0);
    g.mark(1000);
    expect(g.waitMs(1000)).toBe(MIN_GAP_MS);
    expect(g.waitMs(1000 + MIN_GAP_MS)).toBe(0);
    expect(MIN_GAP_MS * 15).toBeGreaterThanOrEqual(60_000);
  });
});

describe('the queue', () => {
  it('lists what waits, in the order it was said, with count by state', async () => {
    const { db, w } = await shop();
    const b = await said(db, w, 'চাল ২ কেজি', 'sale', T0 + 2000);
    const a = await said(db, w, 'ডাল ১ কেজি', 'sale', T0 + 1000);
    const items = await pendingItems(db);
    expect(items.map((i) => i.id)).toEqual([a, b]);
    expect(items[0]).toMatchObject({ tab: 'sale', state: 'waiting', queuedAt: T0 + 1000, clip: 'file:///doc/ডাল ১ কেজি.aac', attempts: 0 });
    expect(await pendingCounts(db)).toEqual({ waiting: 2, ready: 0, unclear: 0 });
  });

  it('online: understands in order, one call per MIN_GAP_MS; results wait for confirmation, nothing is saved', async () => {
    const { db, w } = await shop();
    const ids = [await said(db, w, 'চাল ২ কেজি ১২০ টাকা', 'sale', T0 + 1000), await said(db, w, 'ডাল ১ কেজি ৯০ টাকা', 'sale', T0 + 2000), await said(db, w, 'বিদ্যুৎ বিল ৫০০ টাকা', 'expense', T0 + 3000)];
    const g = fakeGemini(db, w);
    const r = await runUnderstandQueue(deps(db, g.fn));
    expect(r).toEqual({ ready: 3, unclear: 0, failed: 0, stopped: null });
    expect(g.calls.map((c) => c.id)).toEqual(ids);
    const gaps = g.calls.slice(1).map((c, i) => c.at - g.calls[i]!.at);
    expect(gaps.every((x) => x >= MIN_GAP_MS)).toBe(true);
    expect(await pendingCounts(db)).toEqual({ waiting: 0, ready: 3, unclear: 0 });
    // Gemini's answer is kept on the log for the confirm card
    const log = (await getVoiceLog(db, ids[0]!))!;
    expect(JSON.parse(log.gemini_json!)).toMatchObject({ intent: 'sale' });
    expect(log.outcome).toBe('pending');
    // nothing saved until হ্যাঁ
    for (const t of ['sales', 'ledger', 'expenses', 'purchases']) expect(await db.getFirstAsync(`SELECT COUNT(*) AS n FROM ${t}`)).toEqual({ n: 0 });
    expect((await nextReady(db))?.id).toBe(ids[0]);
  });

  it('offline: stops at once, keeps everything, retries the moment the network is back', async () => {
    const { db, w } = await shop();
    const a = await said(db, w, 'চাল ২ কেজি ১২০ টাকা');
    const b = await said(db, w, 'ডাল ১ কেজি ৯০ টাকা', 'sale', T0 + 2000);
    const off: UnderstandResult = { ok: false, parsed: null, error: 'api: network: Network request failed' };
    const g = fakeGemini(db, w, { [a]: off });
    const r = await runUnderstandQueue(deps(db, g.fn));
    expect(r).toEqual({ ready: 0, unclear: 0, failed: 1, stopped: 'offline' });
    expect(g.calls).toHaveLength(1); // b not even tried
    expect(await pendingCounts(db)).toEqual({ waiting: 2, ready: 0, unclear: 0 });
    expect((await pendingItems(db))[0]).toMatchObject({ id: a, attempts: 1, nextAt: clock.now });
    // network back
    const g2 = fakeGemini(db, w);
    const r2 = await runUnderstandQueue(deps(db, g2.fn));
    expect(r2).toMatchObject({ ready: 2, stopped: null });
    expect(g2.calls.map((c) => c.id)).toEqual([a, b]);
  });

  it('429: the pass ends, nothing is tried for a minute, then the queue goes on', async () => {
    const { db, w } = await shop();
    const a = await said(db, w, 'চাল ২ কেজি ১২০ টাকা');
    const b = await said(db, w, 'ডাল ১ কেজি ৯০ টাকা', 'sale', T0 + 2000);
    const limited: UnderstandResult = { ok: false, parsed: null, error: 'api: HTTP 429: Resource has been exhausted' };
    const g = fakeGemini(db, w, { [a]: limited });
    expect(await runUnderstandQueue(deps(db, g.fn))).toMatchObject({ failed: 1, stopped: 'rate' });
    const started = clock.now;
    // too early: nothing due
    clock.now = started + RATE_WAIT_MS - 1;
    const early = fakeGemini(db, w);
    expect(await runUnderstandQueue(deps(db, early.fn))).toMatchObject({ ready: 0, stopped: null });
    expect(early.calls).toHaveLength(0);
    clock.now = started + RATE_WAIT_MS + 1;
    const late = fakeGemini(db, w);
    expect(await runUnderstandQueue(deps(db, late.fn))).toMatchObject({ ready: 2 });
    expect(late.calls.map((c) => c.id)).toEqual([a, b]);
  });

  it('other errors back off per item (30 s, 2 min …) and the pass goes on to the next', async () => {
    const { db, w } = await shop();
    const a = await said(db, w, 'চাল ২ কেজি ১২০ টাকা');
    const b = await said(db, w, 'ডাল ১ কেজি ৯০ টাকা', 'sale', T0 + 2000);
    const g = fakeGemini(db, w, { [a]: { ok: false, parsed: null, error: 'weird failure' } });
    expect(await runUnderstandQueue(deps(db, g.fn))).toMatchObject({ ready: 1, failed: 1, stopped: null });
    const item = (await pendingItems(db)).find((i) => i.id === a)!;
    expect(item).toMatchObject({ state: 'waiting', attempts: 1, error: 'weird failure' });
    expect(item.nextAt).toBeGreaterThanOrEqual(T0 + 10_000 + BACKOFF_MS[0]);
    expect(item.nextAt).toBeLessThan(T0 + 10_000 + BACKOFF_MS[0] + 2 * MIN_GAP_MS);
    expect(b).toBeTruthy();
  });

  it('a bad answer three times (form) becomes unclear; "unknown" and a missing clip too', async () => {
    const { db, w } = await shop();
    const a = await said(db, w, 'চাল ২ কেজি ১২০ টাকা');
    const bad: UnderstandResult = { ok: false, parsed: null, error: 'invalid: intent' };
    const g = fakeGemini(db, w, { [a]: bad });
    for (let i = 0; i < MAX_FORM_ATTEMPTS; i++) {
      clock.now += 3 * BACKOFF_MS[BACKOFF_MS.length - 1]!;
      await runUnderstandQueue(deps(db, g.fn));
    }
    expect((await pendingItems(db))[0]).toMatchObject({ id: a, state: 'unclear', attempts: MAX_FORM_ATTEMPTS });

    const u = await said(db, w, 'হুঁ হুঁ', 'sale', T0 + 5000);
    const unknown = fakeGemini(db, w, { [u]: { ok: true, parsed: { intent: 'unknown' }, error: null } });
    await runUnderstandQueue(deps(db, unknown.fn));
    const m = await said(db, w, 'ডাল ১ কেজি ৯০ টাকা', 'sale', T0 + 6000);
    const none = fakeGemini(db, w);
    await runUnderstandQueue({ ...deps(db, none.fn), clipExists: async () => false });
    const byId = Object.fromEntries((await pendingItems(db)).map((i) => [i.id, i.state]));
    expect(byId[u]).toBe('unclear');
    expect(byId[m]).toBe('unclear');
  });

  it('no Gemini key: the pass ends, the clips stay waiting', async () => {
    const { db, w } = await shop();
    await said(db, w, 'চাল ২ কেজি ১২০ টাকা');
    const r = await runUnderstandQueue(deps(db, async () => ({ ok: false, parsed: null, error: 'error: no EXPO_PUBLIC_GEMINI_KEY in this build' })));
    expect(r.stopped).toBe('nokey');
    expect(await pendingCounts(db)).toEqual({ waiting: 1, ready: 0, unclear: 0 });
  });

  it('stops between items when told to (network lost)', async () => {
    const { db, w } = await shop();
    await said(db, w, 'চাল ২ কেজি ১২০ টাকা');
    await said(db, w, 'ডাল ১ কেজি ৯০ টাকা', 'sale', T0 + 2000);
    const g = fakeGemini(db, w);
    let n = 0;
    const r = await runUnderstandQueue({ ...deps(db, g.fn), keepGoing: () => n++ < 1 });
    expect(r).toMatchObject({ ready: 1, stopped: 'cancelled' });
  });
});

describe('review: confirm each, with the original time', () => {
  it('হ্যাঁ saves with entry_at = when it was said, and leaves the queue; the entry belongs to that day', async () => {
    const { db, w } = await shop();
    const yesterday = T0 - 20 * 3_600_000;
    const id = await said(db, w, 'চাল ২ কেজি ১২০ টাকা', 'sale', yesterday);
    await runUnderstandQueue(deps(db, fakeGemini(db, w).fn));
    const item = (await nextReady(db))!;
    expect(item).toMatchObject({ id, state: 'ready', queuedAt: yesterday, intent: null });
    const names = await knownNames(db);
    const parsed = JSON.parse((await getVoiceLog(db, id))!.gemini_json!);
    const products = await findProducts(db, (parsed.items ?? []).map((i: { product?: string }) => i.product ?? ''));
    const basket = basketFromParse(parsed, products, names.customers);
    await saveBasket(db, w, basket, id, [], item.queuedAt);
    const sale = (await db.getFirstAsync<{ at: number; created_at: number; entry_at: number }>('SELECT at, created_at, entry_at FROM v_sales'))!;
    expect(sale.entry_at).toBe(yesterday);
    expect(sale.at).toBe(yesterday);
    expect(sale.created_at).toBeGreaterThan(yesterday);
    expect(await pendingCounts(db)).toEqual({ waiting: 0, ready: 0, unclear: 0 });
    expect((await getVoiceLog(db, id))!.outcome).toBe('saved');
    expect(await nextReady(db)).toBeNull();
  });

  it('other entries (খরচ) keep the time too', async () => {
    const { db, w } = await shop();
    const at = T0 - 5 * 3_600_000;
    const id = await said(db, w, 'বিদ্যুৎ বিল ৫০০ টাকা', 'expense', at);
    await runUnderstandQueue(deps(db, fakeGemini(db, w).fn));
    const parsed = JSON.parse((await getVoiceLog(db, id))!.gemini_json!);
    const draft = entryFromParse(parsed, { products: new Map(), knownCustomers: [], tab: 'expense' })!;
    await saveEntry(db, w, draft, id, [], at);
    expect(await db.getFirstAsync('SELECT at FROM v_expenses')).toEqual({ at });
    expect(await pendingCounts(db)).toEqual({ waiting: 0, ready: 0, unclear: 0 });
  });

  it('না leaves the queue and saves nothing; the item can be left unfinished (stays ready)', async () => {
    const { db, w } = await shop();
    const a = await said(db, w, 'চাল ২ কেজি ১২০ টাকা');
    const b = await said(db, w, 'ডাল ১ কেজি ৯০ টাকা', 'sale', T0 + 2000);
    await runUnderstandQueue(deps(db, fakeGemini(db, w).fn));
    await setOutcome(db, w, a, 'cancelled'); // না
    expect(await pendingCounts(db)).toEqual({ waiting: 0, ready: 1, unclear: 0 }); // b still waits for a decision
    expect((await nextReady(db))?.id).toBe(b);
    expect(await db.getFirstAsync('SELECT COUNT(*) AS n FROM sales')).toEqual({ n: 0 });
    expect((await getVoiceLog(db, a))!.outcome).toBe('cancelled');
  });

  it('✕ discards: the clip is thrown away (never on Drive → expired), the queue and upload entries go', async () => {
    const { db, w } = await shop();
    const a = await said(db, w, 'চাল ২ কেজি ১২০ টাকা');
    expect(await db.getFirstAsync('SELECT COUNT(*) AS n FROM audio_queue')).toEqual({ n: 1 });
    const clip = await discardPending(db, w, a);
    expect(clip).toBe('file:///doc/চাল ২ কেজি ১২০ টাকা.aac');
    const log = (await getVoiceLog(db, a))!;
    expect(log).toMatchObject({ outcome: 'cancelled', audio_path: null, audio_status: 'expired' });
    expect(await pendingCounts(db)).toEqual({ waiting: 0, ready: 0, unclear: 0 });
    expect(await db.getFirstAsync('SELECT COUNT(*) AS n FROM audio_queue')).toEqual({ n: 0 });
  });
});
