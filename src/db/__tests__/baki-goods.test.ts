/** "সাজুর বাকি তেল, আটা, ময়দা, সুজি, মোট ৫০০ টাকা": a baki with the goods as a note, no stock change. */
import { entryFromFixed, entryReadback, withEntryCustomer } from '../../domain/entry';
import { parseFixed } from '../../parser';
import { createVoiceLog, customerBalances, customerHistory, customerByName, ensureDevice, saveEntry, stockList, voidEntry } from '../repo';
import { FakeCloud } from '../../sync/__tests__/fakeRemote';
import { DAY0, phoneOf, syncPhone } from './shopHelpers';
import { migratedDb, testWriter } from './nodeDb';

const SAID = 'সাজুর বাকি তেল, আটা, ময়দা, সুজি, মোট ৫০০ টাকা';

async function saveIt(db: Awaited<ReturnType<typeof migratedDb>>, w: ReturnType<typeof testWriter>, known: string[]) {
  const cmd = parseFixed(SAID, { knownProducts: ['তেল'], knownCustomers: known });
  let d = entryFromFixed(cmd, { products: new Map(), knownCustomers: known })!;
  if (!known.includes('সাজু')) d = withEntryCustomer(d, 'সাজু', true);
  const log = await createVoiceLog(db, w, { transcript: SAID, source: 'voice', contextTab: 'sale' });
  return { draft: d, id: await saveEntry(db, w, d, log, []) };
}

it('the confirm text reads the customer, the amount, বাকি and the goods; nothing is saved before হ্যাঁ', async () => {
  const d = withEntryCustomer(entryFromFixed(parseFixed(SAID), { products: new Map(), knownCustomers: [] })!, 'সাজু', true);
  expect(d).toMatchObject({ kind: 'baki', customerName: 'সাজু', amountPoisha: 50000, note: 'তেল, আটা, ময়দা, সুজি', problems: [] });
  expect(entryReadback(d)).toBe('সাজু, ৫০০ টাকা বাকি: তেল, আটা, ময়দা, সুজি। ঠিক আছে?');
});

it('হ্যাঁ: সাজু owes ৳ ৫০০, the goods are on his খাতা line, stock and sales are untouched', async () => {
  const db = await migratedDb();
  const w = testWriter();
  await ensureDevice(db, w, 'owner');
  await saveIt(db, w, []);
  const c = (await customerByName(db, 'সাজু'))!;
  expect(c.balance_poisha).toBe(50000);
  expect((await customerBalances(db))[0]).toMatchObject({ name: 'সাজু', balance_poisha: 50000 });
  const lines = await customerHistory(db, c.id);
  expect(lines).toHaveLength(1);
  expect(lines[0]).toMatchObject({ kind: 'baki', amount_poisha: 50000, note: 'তেল, আটা, ময়দা, সুজি', products: null });
  expect(await stockList(db)).toEqual([]);
  expect(await db.getFirstAsync('SELECT COUNT(*) AS n FROM sales')).toEqual({ n: 0 });
  expect(await db.getFirstAsync("SELECT outcome FROM voice_logs")).toEqual({ outcome: 'saved' });
});

it('an existing customer is matched by name; paying back and deleting work as for any baki', async () => {
  const db = await migratedDb();
  const w = testWriter();
  await ensureDevice(db, w, 'owner');
  const first = await saveIt(db, w, []);
  const second = await saveIt(db, w, ['সাজু']);
  expect((await customerByName(db, 'সাজু'))!.balance_poisha).toBe(100000);
  await voidEntry(db, w, 'ledger', second.id);
  expect((await customerByName(db, 'সাজু'))!.balance_poisha).toBe(50000);
  expect(first.id).not.toBe(second.id);
});

it('syncs to the other phone with its note', async () => {
  const cloud = new FakeCloud();
  const a = await phoneOf('A', cloud);
  const b = await phoneOf('B', cloud, 'shop-uid', DAY0 + 5000);
  await saveIt(a.db, a.w, []);
  await syncPhone(a);
  await syncPhone(b);
  expect(await b.db.getFirstAsync('SELECT amount_poisha, note FROM v_ledger')).toEqual({ amount_poisha: 50000, note: 'তেল, আটা, ময়দা, সুজি' });
});
