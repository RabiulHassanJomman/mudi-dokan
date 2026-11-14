/** Build step 5 on real SQLite: cash day, দিন শেষ, লাভ, History, ✏️ fix and undo. */
import { basketFromParse, removeItem, renameItem, setItemTotal, stepItem, withCredit, withCustomer } from '../../domain/basket';
import { addDays, countedPoisha, dayStart, expectedCash, profitOf } from '../../domain/cash';
import { entryFromParse, setEntryAmount, withEntryCustomer, type EntryDraft } from '../../domain/entry';
import { basketFromStored, entryFromStored } from '../../domain/fix';
import { buildHistory } from '../../domain/history';
import { parseCommand } from '../../parser';
import type { ParseContext } from '../../parser/types';
import {
  basketForFix,
  cashDay,
  createVoiceLog,
  customerBalances,
  ensureDevice,
  entryForFix,
  findProducts,
  historyRows,
  knownNames,
  profitInput,
  recentEntries,
  saveBasket,
  saveBasketFix,
  saveDayClose,
  saveEntry,
  saveEntryFix,
  saveSetup,
  stockList,
  todayTotals,
  voidEntry,
  type Writer,
} from '../repo';
import { migratedDb } from './nodeDb';

type TestDb = Awaited<ReturnType<typeof migratedDb>>;

const D1 = '2026-11-12';
const D2 = '2026-11-13';
const D3 = '2026-11-14';
const at = (date: string, h: number) => dayStart(date) + h * 3_600_000;

/** A writer whose clock the test moves (each call adds a second within the hour). */
function clock(start: number) {
  let t = start;
  let n = 0;
  const w: Writer & { set(ms: number): void } = {
    deviceId: 'dev-1',
    deviceName: 'আব্বু',
    newId: () => `id-${++n}`,
    now: () => (t += 1000),
    set: (ms) => {
      t = ms;
    },
  };
  return w;
}

async function setup() {
  const db = await migratedDb();
  const w = clock(at(D1, 8));
  await ensureDevice(db, w, 'owner');
  return { db, w };
}

async function sell(db: TestDb, w: Writer, text: string, opts: { newCustomer?: boolean } = {}) {
  const names = await knownNames(db);
  const parsed = parseCommand(text, { tab: 'sale', knownProducts: names.products, knownCustomers: names.customers });
  const products = await findProducts(db, (parsed.items ?? []).map((i) => i.product ?? ''));
  let b = basketFromParse(parsed, products, names.customers);
  if (opts.newCustomer && b.customerName) b = withCustomer(b, b.customerName, true);
  const logId = await createVoiceLog(db, w, { transcript: text, source: 'voice', contextTab: 'sale', audioPath: `file:///${text}.wav` });
  return saveBasket(db, w, b, logId, []);
}

async function enter(db: TestDb, w: Writer, text: string, tab: ParseContext['tab'], fix: (d: EntryDraft) => EntryDraft = (d) => d) {
  const names = await knownNames(db);
  const parsed = parseCommand(text, { tab, knownCustomers: names.customers, knownProducts: names.products, deviceRole: 'owner', deviceName: 'আব্বু' });
  const products = await findProducts(db, parsed.product ? [parsed.product] : []);
  const d = fix(entryFromParse(parsed, { products, knownCustomers: names.customers, tab })!);
  const logId = await createVoiceLog(db, w, { transcript: text, source: 'voice', contextTab: tab ?? 'sale' });
  return saveEntry(db, w, d, logId, []);
}
const asNew = (d: EntryDraft) => withEntryCustomer(d, d.customerName ?? '', true);

/** Setup day D1 at 08:00 with ৳5,000; a purchase so চাল has a cost. */
async function shop() {
  const { db, w } = await setup();
  await saveSetup(db, w, { shopName: 'দোকান', deviceName: 'আব্বু', role: 'owner', openingCashPoisha: 500000 }, D1);
  await enter(db, w, 'চাল ৫০ কেজি কিনলাম ৫০ টাকা করে', 'purchase'); // −2500 cash
  return { db, w };
}

describe('cash day', () => {
  it('setup day: opening = Setup, expected = opening + cash in − cash out', async () => {
    const { db, w } = await shop();
    w.set(at(D1, 10));
    await sell(db, w, 'চাল ২ কেজি ১২০ টাকা'); // +120
    await sell(db, w, 'করিম চাল ১ কেজি বাকিতে নিল ৬০ টাকা', { newCustomer: true }); // credit: no cash
    await enter(db, w, 'করিম ৫০ টাকা জমা', 'ledger'); // +50
    await enter(db, w, 'বিদ্যুৎ বিল ৩০০ টাকা খরচ', 'expense'); // −300
    await enter(db, w, 'মালিক ২০০ টাকা নিল', 'sale'); // −200
    const d = await cashDay(db, D1);
    expect(d).toMatchObject({ openingPoisha: 500000, source: 'setup', close: null });
    expect(d.flows).toEqual({ sales: 18000, cashSales: 12000, bakiGiven: 6000, joma: 5000, expenses: 30000, cashPurchases: 250000, withdrawals: 20000 });
    expect(d.expectedPoisha).toBe(500000 + 12000 + 5000 - 30000 - 250000 - 20000);
  });

  it("দিন শেষ: the counted cash is the next day's opening; a recount corrects the close", async () => {
    const { db, w } = await shop();
    const d1 = await cashDay(db, D1);
    expect(d1.expectedPoisha).toBe(250000);
    w.set(at(D1, 21));
    const notes = { 1000: 2, 500: 1 } as const;
    await saveDayClose(db, w, d1, notes, countedPoisha(notes)); // 2500 counted (expected 2500)
    await saveDayClose(db, w, d1, { 1000: 2, 200: 2 }, 240000); // recount: 2400
    const again = await cashDay(db, D1);
    expect(again.close).toMatchObject({ counted_cash_poisha: 240000, expected_cash_poisha: 250000 });
    expect(JSON.parse(again.close!.note_counts_json!)).toEqual({ 1000: 2, 200: 2 });
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM v_day_close WHERE kind = 'close'").get()).toEqual({ n: 1 });

    w.set(at(D2, 9));
    await sell(db, w, 'চাল ১ কেজি ৬০ টাকা');
    const d2 = await cashDay(db, D2);
    expect(d2).toMatchObject({ openingPoisha: 240000, source: 'close', expectedPoisha: 246000 });
  });

  it('a day not closed carries on into the next', async () => {
    const { db, w } = await shop();
    w.set(at(D2, 9));
    await sell(db, w, 'চাল ১ কেজি ৬০ টাকা');
    const d3 = await cashDay(db, D3);
    // D1 expected 2500, D2 +60, nothing on D3
    expect(d3).toMatchObject({ openingPoisha: 256000, source: 'carry', expectedPoisha: 256000 });
  });

  it('no Setup yet: opening 0', async () => {
    const { db } = await setup();
    expect(await cashDay(db, D1)).toMatchObject({ openingPoisha: 0, source: 'none', expectedPoisha: 0 });
  });

  it('todayTotals and the cash use the entry time, not the fix time', async () => {
    const { db, w } = await shop();
    w.set(at(D1, 10));
    const b = await sell(db, w, 'চাল ২ কেজি ১২০ টাকা');
    w.set(at(D2, 10)); // fixed the next day
    const draft = basketFromStored(await basketForFix(db, b), []);
    const k = draft.items[0]!.key;
    await saveBasketFix(db, w, b, stepItem(stepItem(draft, k, -1), k, -1)); // 2 → 1 kg (½ steps)
    expect((await cashDay(db, D1)).flows.cashSales).toBe(6000);
    expect((await cashDay(db, D2)).flows.cashSales).toBe(0);
    expect(await todayTotals(db, dayStart(D2))).toEqual({ sales: 0, baki: 0 });
  });
});

describe('profit', () => {
  it('বিক্রি, মোট লাভ, খরচ, আসল লাভ; unknown buy price left out and counted', async () => {
    const { db, w } = await shop(); // চাল cost 50/kg
    w.set(at(D1, 10));
    await sell(db, w, 'চাল ২ কেজি ১২০ টাকা'); // profit 20
    await sell(db, w, 'ডাল ১ কেজি ১১০ টাকা'); // new product: cost unknown
    await enter(db, w, 'চা নাস্তা ৫ টাকা খরচ', 'expense');
    const p = profitOf(await profitInput(db, dayStart(D1), dayStart(D2)));
    expect(p).toEqual({ sales: 23000, gross: 2000, expenses: 500, net: 1500, unknownLines: 1 });
  });

  it('an undone sale is not in the profit', async () => {
    const { db, w } = await shop();
    w.set(at(D1, 10));
    const b = await sell(db, w, 'চাল ২ কেজি ১২০ টাকা');
    await voidEntry(db, w, 'sales', b);
    expect(profitOf(await profitInput(db, dayStart(D1), dayStart(D2))).sales).toBe(0);
  });
});

describe('✏️ fix a sale basket', () => {
  it('changed line → correction; unchanged line → nothing; removed → voided; baki follows the total', async () => {
    const { db, w } = await shop();
    w.set(at(D1, 10));
    const b = await sell(db, w, 'করিম বাকিতে নিল চাল ২ কেজি ১২০ টাকা চাল ৩ কেজি ১৮০ টাকা', { newCustomer: true });
    expect((await customerBalances(db))[0]).toMatchObject({ name: 'করিম', balance_poisha: 30000 });

    let draft = basketFromStored(await basketForFix(db, b), ['করিম']);
    const [l1, l2] = draft.items;
    draft = setItemTotal(stepItem(stepItem(draft, l1!.key, -1), l1!.key, -1), l1!.key, 6000); // 1 kg ৳60
    expect(await saveBasketFix(db, w, b, draft)).toBe(true);
    expect((await customerBalances(db))[0]!.balance_poisha).toBe(24000);
    // only the changed line got a correction (+ the baki row)
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM sales WHERE corrects_id IS NOT NULL').get()).toEqual({ n: 1 });

    // nothing changed → nothing written
    const same = basketFromStored(await basketForFix(db, b), ['করিম']);
    expect(await saveBasketFix(db, w, b, same)).toBe(false);

    // remove line 2
    const fewer = basketFromStored(await basketForFix(db, b), ['করিম']);
    await saveBasketFix(db, w, b, removeItem(fewer, l2!.key));
    expect((await customerBalances(db))[0]!.balance_poisha).toBe(6000);
    const stock = (await stockList(db)).find((s) => s.name === 'চাল')!;
    expect(stock.sold).toBe(1);

    const [h] = buildHistory(await historyRows(db, dayStart(D1), dayStart(D2))).filter((i) => i.kind === 'sale');
    expect(h).toMatchObject({ id: b, title: 'চাল', amount_poisha: 6000, fixed: true, oldAmountPoisha: 30000, oldQuantity: 2, quantity: 1 });
    expect(h!.audio_path).toContain('.wav');
  });

  it('credit → cash voids the baki row; cash → credit adds one', async () => {
    const { db, w } = await shop();
    w.set(at(D1, 10));
    const b = await sell(db, w, 'চাল ২ কেজি ১২০ টাকা');
    let d = basketFromStored(await basketForFix(db, b), []);
    d = withCustomer(withCredit(d, true), 'রহিম', true);
    await saveBasketFix(db, w, b, d);
    expect((await customerBalances(db)).find((c) => c.name === 'রহিম')!.balance_poisha).toBe(12000);
    expect((await cashDay(db, D1)).flows).toMatchObject({ cashSales: 0, bakiGiven: 12000 });

    d = basketFromStored(await basketForFix(db, b), ['রহিম']);
    await saveBasketFix(db, w, b, withCredit(d, false));
    expect((await customerBalances(db)).find((c) => c.name === 'রহিম')!.balance_poisha).toBe(0);
    expect((await cashDay(db, D1)).flows).toMatchObject({ cashSales: 12000, bakiGiven: 0 });
  });

  it('renaming a line to a new product creates it; the original rows are untouched', async () => {
    const { db, w } = await shop();
    w.set(at(D1, 10));
    const b = await sell(db, w, 'চাল ২ কেজি ১২০ টাকা');
    const before = db.raw.prepare('SELECT * FROM sales').all();
    const d = basketFromStored(await basketForFix(db, b), []);
    await saveBasketFix(db, w, b, renameItem(d, d.items[0]!.key, 'মিনিকেট', null));
    expect(db.raw.prepare('SELECT * FROM sales WHERE corrects_id IS NULL').all()).toEqual(before);
    const [h] = buildHistory(await historyRows(db, dayStart(D1), dayStart(D2))).filter((i) => i.kind === 'sale');
    expect(h).toMatchObject({ title: 'মিনিকেট', fixed: true });
    // the new product's cost is unknown
    expect(profitOf(await profitInput(db, dayStart(D1), dayStart(D2))).unknownLines).toBe(1);
  });
});

describe('✏️ fix other entries', () => {
  it('joma amount, expense amount, purchase quantity: one correction each, cash follows', async () => {
    const { db, w } = await shop();
    w.set(at(D1, 10));
    const l = await enter(db, w, 'রহিম ৫০০ টাকা জমা', 'ledger', asNew);
    const e = await enter(db, w, 'বিদ্যুৎ বিল ৩০০ টাকা খরচ', 'expense');
    const before = (await cashDay(db, D1)).expectedPoisha;

    const sl = (await entryForFix(db, 'ledger', l))!;
    expect(await saveEntryFix(db, w, sl, setEntryAmount(entryFromStored(sl), 40000))).toBe(true);
    const se = (await entryForFix(db, 'expenses', e))!;
    await saveEntryFix(db, w, se, setEntryAmount(entryFromStored(se), 25000));
    expect((await cashDay(db, D1)).expectedPoisha).toBe(before - 10000 + 5000);
    // unchanged → nothing
    const se2 = (await entryForFix(db, 'expenses', (await recentEntries(db, 1))[0]!.id))!;
    expect(await saveEntryFix(db, w, se2, entryFromStored(se2))).toBe(false);

    const hist = buildHistory(await historyRows(db, dayStart(D1), dayStart(D2)));
    expect(hist.find((i) => i.kind === 'joma')).toMatchObject({ fixed: true, amount_poisha: 40000, oldAmountPoisha: 50000 });
    expect(hist.find((i) => i.kind === 'expense')).toMatchObject({ fixed: true, amount_poisha: 25000, oldAmountPoisha: 30000 });
  });

  it('purchase: quantity fix changes the stock', async () => {
    const { db, w } = await shop();
    const p = (await recentEntries(db, 1))[0]!;
    expect(p.kind).toBe('purchase');
    const s = (await entryForFix(db, 'purchases', p.id))!;
    const d = entryFromStored(s);
    await saveEntryFix(db, w, s, { ...d, purchase: { ...d.purchase!, quantity: 40 }, amountPoisha: 200000 });
    expect((await stockList(db)).find((r) => r.name === 'চাল')!.bought).toBe(40);
  });
});

describe('undo ("ভুল হয়েছে")', () => {
  it('the last entry is voided by a correction; nothing is deleted', async () => {
    const { db, w } = await shop();
    w.set(at(D1, 10));
    const b = await sell(db, w, 'করিম চাল ১ কেজি বাকিতে নিল ৬০ টাকা', { newCustomer: true });
    const last = (await recentEntries(db, 1))[0]!;
    expect(last).toMatchObject({ kind: 'sale', id: b });
    const n = (db.raw.prepare('SELECT COUNT(*) AS n FROM sales').get() as { n: number }).n;
    expect(await voidEntry(db, w, 'sales', b)).toHaveLength(2); // the line + its baki row
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM sales').get()).toEqual({ n: n + 1 });
    expect((await customerBalances(db))[0]!.balance_poisha).toBe(0);
    expect((await recentEntries(db, 1))[0]!.kind).toBe('purchase');
    const h = buildHistory(await historyRows(db, dayStart(D1), dayStart(D2))).find((i) => i.kind === 'sale');
    expect(h).toMatchObject({ voided: true, amount_poisha: 6000 });
  });

  it('undo an expense', async () => {
    const { db, w } = await shop();
    w.set(at(D1, 10));
    const e = await enter(db, w, 'চা নাস্তা ৫০ টাকা খরচ', 'expense');
    await voidEntry(db, w, 'expenses', e);
    expect((await cashDay(db, D1)).flows.expenses).toBe(0);
    await expect(voidEntry(db, w, 'expenses', e)).rejects.toThrow(/not found/);
  });

  it('expectedCash helper agrees with the repo', async () => {
    const { db } = await shop();
    const d = await cashDay(db, addDays(D1, 0));
    expect(expectedCash(d.openingPoisha, d.flows)).toBe(d.expectedPoisha);
  });
});
