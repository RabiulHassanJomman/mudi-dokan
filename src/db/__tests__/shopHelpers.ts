/** Test helpers: phones of one shop on node:sqlite, selling and entering by the rule parser. */
import { basketFromParse, withCustomer } from '../../domain/basket';
import { entryFromParse, withEntryCustomer, type EntryDraft } from '../../domain/entry';
import { parseCommand } from '../../parser';
import type { ParseContext } from '../../parser/types';
import { SyncEngine } from '../../sync/engine';
import type { FakeCloud } from '../../sync/__tests__/fakeRemote';
import { createVoiceLog, ensureDevice, findProducts, knownNames, repointMerged, saveBasket, saveEntry, type Writer } from '../repo';
import { migratedDb } from './nodeDb';

export type TestDb = Awaited<ReturnType<typeof migratedDb>>;

export const DAY0 = 1_763_000_000_000;

export interface Phone {
  name: string;
  db: TestDb;
  w: Writer & { set(ms: number): void };
  engine: SyncEngine;
}

export function writerFor(name: string, start = DAY0): Phone['w'] {
  let t = start;
  let n = 0;
  return {
    deviceId: `dev-${name}`,
    deviceName: name,
    newId: () => `${name}-${++n}`,
    now: () => (t += 1000),
    set: (ms: number) => {
      t = ms;
    },
  };
}

/** A phone signed in to `uid` on the fake cloud (or offline of it when cloud is null). */
export async function phoneOf(name: string, cloud: FakeCloud | null, uid = 'shop-uid', start = DAY0, clock?: () => number): Promise<Phone> {
  const db = await migratedDb();
  const w = writerFor(name, start);
  await ensureDevice(db, w, 'owner');
  const engine = new SyncEngine(db, clock ?? (() => w.now()));
  if (cloud) {
    engine.setRemote(cloud.client(uid));
    await engine.useAccount(uid);
  }
  return { name, db, w, engine };
}

export async function syncPhone(p: Phone) {
  await p.engine.push();
  await p.engine.pull();
  await repointMerged(p.db, p.w);
  await p.engine.push();
}

export async function sell(db: TestDb, w: Writer, text: string, newCustomer = false, entryAt: number | null = null) {
  const names = await knownNames(db);
  const parsed = parseCommand(text, { tab: 'sale', knownProducts: names.products, knownCustomers: names.customers });
  const products = await findProducts(db, (parsed.items ?? []).map((i) => i.product ?? ''));
  let b = basketFromParse(parsed, products, names.customers);
  if (newCustomer && b.customerName) b = withCustomer(b, b.customerName, true);
  const logId = await createVoiceLog(db, w, { transcript: text, source: 'voice', contextTab: 'sale', audioPath: 'file:///doc/v.wav' });
  return saveBasket(db, w, b, logId, [], entryAt);
}

export async function enter(db: TestDb, w: Writer, text: string, tab: ParseContext['tab'], fix: (d: EntryDraft) => EntryDraft = (d) => d, entryAt: number | null = null) {
  const names = await knownNames(db);
  const parsed = parseCommand(text, { tab, knownCustomers: names.customers, knownProducts: names.products, deviceRole: 'owner', deviceName: w.deviceName });
  const products = await findProducts(db, parsed.product ? [parsed.product] : []);
  const d = fix(entryFromParse(parsed, { products, knownCustomers: names.customers, tab })!);
  const logId = await createVoiceLog(db, w, { transcript: text, source: 'voice', contextTab: tab ?? 'sale' });
  return saveEntry(db, w, d, logId, [], entryAt);
}

export const asNewCustomer = (d: EntryDraft) => withEntryCustomer(d, d.customerName ?? '', true);
