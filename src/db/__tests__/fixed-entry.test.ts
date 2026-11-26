/** Android parsing, saved: নগদ goods sale and money-only কেনা, next to বাকি and জমা. */
import { dayStart, today } from '../../domain/cash';
import { entryFromFixed, entryReadback, setEntryAmount, stepPurchase, withEntryCustomer, GOODS_PRODUCT_ID } from '../../domain/entry';
import { entryFromStored } from '../../domain/fix';
import { buildHistory } from '../../domain/history';
import { recentLine } from '../../domain/recent';
import { stockView, stockWords } from '../../domain/stock';
import { parseFixed } from '../../parser/fixed';
import { FakeCloud } from '../../sync/__tests__/fakeRemote';
import {
  cashFlows, createVoiceLog, customerByName, entryForFix, findProducts, goodsSaleForFix, historyRows, knownNames, mergeItems,
  pickProducts, profitInput, recentEntries, saveEntry, saveEntryFix, stockList, todayTotals, voidEntry, wipeCounts,
} from '../repo';
import { DAY0, phoneOf, syncPhone, type TestDb } from './shopHelpers';

type Phone = Awaited<ReturnType<typeof phoneOf>>;

async function draftOf(db: TestDb, said: string) {
  const names = await knownNames(db);
  const cmd = parseFixed(said, { knownProducts: names.products, knownCustomers: names.customers });
  const products = await findProducts(db, cmd.goods);
  return entryFromFixed(cmd, { products, knownCustomers: names.customers });
}

async function say(p: Phone, said: string, newCustomer = false) {
  let d = (await draftOf(p.db, said))!;
  if (newCustomer) d = withEntryCustomer(d, d.customerName!, true);
  const log = await createVoiceLog(p.db, p.w, { transcript: said, source: 'voice', contextTab: 'sale', engine: 'android' });
  return saveEntry(p.db, p.w, d, log, []);
}

const START = dayStart(today(DAY0));
const flows = (db: TestDb) => cashFlows(db, START, START + 2 * 86_400_000);
const CASH = 'নগদ বিক্রি আদা, চাল ১০০ টাকা';
const BOUGHT = '১০০০ টাকার আলু কেনা হয়েছে';

describe('drafts', () => {
  it('an incomplete sentence gives no draft', async () => {
    const p = await phoneOf('A', null);
    expect(await draftOf(p.db, 'নগদ বিক্রি আদা')).toBeNull();
    expect(await draftOf(p.db, 'আজকের হিসাব')).toBeNull();
  });

  it('reads back all four', async () => {
    const p = await phoneOf('A', null);
    expect(entryReadback((await draftOf(p.db, CASH))!)).toBe('নগদ বিক্রি: আদা, চাল, ১০০ টাকা। ঠিক আছে?');
    expect(entryReadback((await draftOf(p.db, BOUGHT))!)).toBe('কেনা: আলু, ১০০০ টাকা। ঠিক আছে?');
    const baki = withEntryCustomer((await draftOf(p.db, 'সাজু বাকি নিয়েছে আদা, চাল ১০০ টাকা'))!, 'সাজু', true);
    expect(entryReadback(baki)).toBe('সাজু, ১০০ টাকা বাকি: আদা, চাল। ঠিক আছে?');
    const joma = withEntryCustomer((await draftOf(p.db, 'সাজু ৫০ টাকা জমা দিয়েছে'))!, 'সাজু', true);
    expect(entryReadback(joma)).toBe('সাজু, ৫০ টাকা জমা। ঠিক আছে?');
  });

  it('an unknown buyer on a নগদ sale is asked about; no buyer is fine', async () => {
    const p = await phoneOf('A', null);
    expect((await draftOf(p.db, CASH))!.problems).toEqual([]);
    expect((await draftOf(p.db, 'সাজু নগদ নিয়েছে চাল ১০০ টাকা'))!.problems).toEqual(['customer_unknown']);
  });

  it('a money-only purchase has no quantity to step; its total can be changed', async () => {
    const p = await phoneOf('A', null);
    const d = (await draftOf(p.db, BOUGHT))!;
    expect(stepPurchase(d, 1)).toEqual(d);
    expect(setEntryAmount(d, 90000)).toMatchObject({ amountPoisha: 90000, problems: [], purchase: { quantity: null } });
    expect(setEntryAmount(d, null).problems).toEqual(['no_price']);
  });
});

describe('নগদ goods sale', () => {
  it('counts as a cash sale with unknown cost; the hidden product shows nowhere', async () => {
    const p = await phoneOf('A', null);
    await say(p, CASH);
    await say(p, 'নগদ বিক্রি ডাল ৫০ টাকা');
    expect(await todayTotals(p.db, START)).toEqual({ sales: 15000, baki: 0 });
    expect(await flows(p.db)).toMatchObject({ sales: 15000, cashSales: 15000, bakiGiven: 0 });
    expect(await profitInput(p.db, START, START + 2 * 86_400_000)).toMatchObject({ salesPoisha: 15000, knownSalesPoisha: 0, unknownLines: 2 });
    expect(await p.db.getAllAsync('SELECT id, archived FROM products')).toEqual([{ id: GOODS_PRODUCT_ID, archived: 1 }]);
    expect(await stockList(p.db)).toEqual([]);
    expect(await pickProducts(p.db)).toEqual([]);
    expect((await knownNames(p.db)).products).toEqual([]);
    expect((await mergeItems(p.db)).products).toEqual([]);
    expect((await wipeCounts(p.db)).products).toBe(0);
  });

  it('history and the home list show the goods, no quantity', async () => {
    const p = await phoneOf('A', null);
    const id = await say(p, CASH);
    const [recent] = await recentEntries(p.db);
    expect(recent).toMatchObject({ kind: 'sale', id, title: 'আদা, চাল', quantity: null, unit: null, amount_poisha: 10000, credit: 0 });
    expect(recentLine(recent!).words).toBe('বিক্রি: আদা, চাল, ১০০ টাকা।');
    const [item] = buildHistory(await historyRows(p.db, START, START + 2 * 86_400_000));
    expect(item).toMatchObject({ table: 'sales', id, title: 'আদা, চাল', quantity: null, unit: null, amount_poisha: 10000 });
  });

  it('✏️ writes a correction, বাতিল voids it', async () => {
    const p = await phoneOf('A', null);
    const id = await say(p, CASH);
    const stored = (await goodsSaleForFix(p.db, id))!;
    const d = entryFromStored(stored);
    expect(d).toMatchObject({ kind: 'goods_sale', note: 'আদা, চাল', amountPoisha: 10000, customerName: null });
    expect(await saveEntryFix(p.db, p.w, stored, d)).toBe(false);
    expect(await saveEntryFix(p.db, p.w, stored, { ...setEntryAmount(d, 12000), note: 'আদা' })).toBe(true);
    expect((await recentEntries(p.db))[0]).toMatchObject({ id, title: 'আদা', amount_poisha: 12000 });
    expect(await p.db.getFirstAsync('SELECT COUNT(*) AS n FROM sales')).toEqual({ n: 2 });
    await voidEntry(p.db, p.w, 'sales', id);
    expect(await flows(p.db)).toMatchObject({ cashSales: 0 });
    expect(await goodsSaleForFix(p.db, id)).toBeNull();
  });

  it('a confirmed buyer is saved and owes nothing', async () => {
    const p = await phoneOf('A', null);
    await say(p, 'সাজু নগদ নিয়েছে চাল ১০০ টাকা', true);
    expect((await customerByName(p.db, 'সাজু'))!.balance_poisha).toBe(0);
    expect((await recentEntries(p.db))[0]).toMatchObject({ customer: 'সাজু', credit: 0 });
  });

  it('an ordinary sale is not a goods sale', async () => {
    const p = await phoneOf('A', null);
    expect(await goodsSaleForFix(p.db, 'nothing')).toBeNull();
  });
});

describe('money-only কেনা', () => {
  it('lowers cash, adds no quantity, leaves the average cost alone', async () => {
    const p = await phoneOf('A', null);
    await say(p, BOUGHT);
    await say(p, '৫০০ টাকার আলু কিনলাম');
    expect(await flows(p.db)).toMatchObject({ cashPurchases: 150000 });
    expect(await p.db.getAllAsync('SELECT quantity, buy_price_poisha, total_poisha, paid_cash FROM v_purchases ORDER BY at')).toEqual([
      { quantity: 0, buy_price_poisha: 0, total_poisha: 100000, paid_cash: 1 },
      { quantity: 0, buy_price_poisha: 0, total_poisha: 50000, paid_cash: 1 },
    ]);
    const [row] = await stockList(p.db);
    expect(row).toMatchObject({ name: 'আলু', purchases: 0, spentPoisha: 150000, costPricePoisha: null });
    const view = stockView(row!);
    expect(view).toMatchObject({ stock: null, low: false, spentPoisha: 150000 });
    expect(stockWords(view)).toBe('আলু কিনতে মোট ১৫০০ টাকা খরচ হয়েছে।');
  });

  it('history shows the money without a quantity; ✏️ changes the total', async () => {
    const p = await phoneOf('A', null);
    const id = await say(p, BOUGHT);
    expect((await recentEntries(p.db))[0]).toMatchObject({ kind: 'purchase', title: 'আলু', quantity: null, amount_poisha: 100000 });
    expect(buildHistory(await historyRows(p.db, START, START + 2 * 86_400_000))[0]).toMatchObject({ quantity: null, amount_poisha: 100000 });
    const stored = (await entryForFix(p.db, 'purchases', id))!;
    const d = entryFromStored(stored);
    expect(d.purchase).toMatchObject({ amountOnly: true, quantity: null });
    expect(await saveEntryFix(p.db, p.w, stored, d)).toBe(false);
    expect(await saveEntryFix(p.db, p.w, stored, setEntryAmount(d, 80000))).toBe(true);
    expect(await flows(p.db)).toMatchObject({ cashPurchases: 80000 });
  });
});

it('both phones get the goods text and the money-only purchase', async () => {
  const cloud = new FakeCloud();
  const a = await phoneOf('A', cloud);
  const b = await phoneOf('B', cloud, 'shop-uid', DAY0 + 5000);
  await say(a, CASH);
  await say(b, 'নগদ বিক্রি ডাল ৫০ টাকা');
  await say(a, BOUGHT);
  await syncPhone(a);
  await syncPhone(b);
  await syncPhone(a);
  for (const p of [a, b]) {
    expect(await p.db.getAllAsync('SELECT note FROM v_sales ORDER BY note')).toEqual([{ note: 'আদা, চাল' }, { note: 'ডাল' }].sort((x, y) => x.note.localeCompare(y.note)));
    expect(await flows(p.db)).toMatchObject({ cashSales: 15000, cashPurchases: 100000 });
    expect(await p.db.getFirstAsync("SELECT COUNT(*) AS n FROM products WHERE id = 'goods-sale'")).toEqual({ n: 1 });
  }
});

it('বাকি without goods: a plain baki, read back without goods', async () => {
  const p = await phoneOf('A', null);
  const d = withEntryCustomer((await draftOf(p.db, 'সাজু বাকি ১০০ টাকা'))!, 'সাজু', true);
  expect(d).toMatchObject({ kind: 'baki', note: null, amountPoisha: 10000, problems: [] });
  expect(entryReadback(d)).toBe('সাজু, ১০০ টাকা বাকি। ঠিক আছে?');
  await say(p, 'সাজু বাকি ১০০ টাকা', true);
  expect((await customerByName(p.db, 'সাজু'))!.balance_poisha).toBe(10000);
  expect(await todayTotals(p.db, START)).toEqual({ sales: 0, baki: 10000 });
});

it('নগদ বিক্রি without goods: a cash sale of the amount, shown as নগদ বিক্রি', async () => {
  const p = await phoneOf('A', null);
  const d = (await draftOf(p.db, 'নগদ বিক্রি ১০০ টাকা'))!;
  expect(d).toMatchObject({ kind: 'goods_sale', note: null, amountPoisha: 10000, problems: [] });
  const id = await say(p, 'নগদ বিক্রি ১০০ টাকা');
  expect(await flows(p.db)).toMatchObject({ sales: 10000, cashSales: 10000 });
  const [recent] = await recentEntries(p.db);
  expect(recent).toMatchObject({ id, kind: 'sale', title: 'নগদ বিক্রি', quantity: null, amount_poisha: 10000 });
  expect(buildHistory(await historyRows(p.db, START, START + 2 * 86_400_000))[0]).toMatchObject({ title: 'নগদ বিক্রি' });
});
