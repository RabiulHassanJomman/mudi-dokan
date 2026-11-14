/** মুছুন on real SQLite: void (synced, hidden from lists and totals), customer/product archive rules. */
import { buildHistory } from '../../domain/history';
import { visibleHistory } from '../../domain/delete';
import { FakeCloud } from '../../sync/__tests__/fakeRemote';
import {
  archiveParty,
  cashDay,
  customerBalances,
  customerByName,
  customerDeleteCheck,
  historyRows,
  productDeleteCheck,
  recentEntries,
  stockList,
  todayTotals,
  voidEntry,
  findProducts,
} from '../repo';
import { DAY0, asNewCustomer, enter, phoneOf, sell, syncPhone, type Phone } from './shopHelpers';

const dayOf = (ms: number) => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

async function shopA(cloud: FakeCloud | null = null) {
  const a = await phoneOf('A', cloud);
  await enter(a.db, a.w, 'চাল ৫০ কেজি কিনলাম ৫০ টাকা করে', 'purchase');
  return a;
}

describe('void an entry (মুছুন)', () => {
  it('a sale: hidden from the recent list, today totals, cash and stock; the clip row stays', async () => {
    const a = await shopA();
    const basket = await sell(a.db, a.w, 'চাল ২ কেজি ১২০ টাকা');
        const sold = async () => (await todayTotals(a.db, dayOf(DAY0))).sales;
    expect(await sold()).toBe(12000);
    const left = async () => {
      const r = (await stockList(a.db))[0]!;
      return r.bought - r.sold;
    };
    expect(await left()).toBe(48);

    await voidEntry(a.db, a.w, 'sales', basket);
    expect(await sold()).toBe(0);
    expect((await recentEntries(a.db, 10)).some((r) => r.kind === 'sale')).toBe(false);
    expect(await left()).toBe(50);
    // append-only: the sale and its voided correction are both rows
    expect(await a.db.getFirstAsync('SELECT COUNT(*) AS n, SUM(voided) AS v FROM sales')).toEqual({ n: 2, v: 1 });
  });

  it('a credit sale takes its baki with it; a baki entry, জমা, expense and purchase can each be deleted', async () => {
    const a = await shopA();
    const basket = await sell(a.db, a.w, 'করিম চাল ২ কেজি বাকিতে নিল ১২০ টাকা', true);
    expect((await customerBalances(a.db))[0]).toMatchObject({ name: 'করিম', balance_poisha: 12000 });
    await voidEntry(a.db, a.w, 'sales', basket);
    expect((await customerBalances(a.db))[0]).toMatchObject({ name: 'করিম', balance_poisha: 0 });

    const baki = await enter(a.db, a.w, 'করিম ৩০০ টাকা বাকি', 'ledger');
    const joma = await enter(a.db, a.w, 'করিম ১০০ টাকা দিল', 'ledger');
    expect((await customerBalances(a.db))[0]!.balance_poisha).toBe(20000);
    await voidEntry(a.db, a.w, 'ledger', joma);
    expect((await customerBalances(a.db))[0]!.balance_poisha).toBe(30000);
    await voidEntry(a.db, a.w, 'ledger', baki);
    expect((await customerBalances(a.db))[0]!.balance_poisha).toBe(0);

    const day = new Date(DAY0).toISOString().slice(0, 10);
    const exp = await enter(a.db, a.w, 'বিদ্যুৎ বিল ৫০০ টাকা', 'expense');
    const before = (await cashDay(a.db, day)).expectedPoisha;
    await voidEntry(a.db, a.w, 'expenses', exp);
    expect((await cashDay(a.db, day)).expectedPoisha).toBe(before + 50000);
    const buy = await enter(a.db, a.w, 'ডাল ১০ কেজি কিনলাম ৯০ টাকা করে', 'purchase');
    expect((await stockList(a.db)).some((s) => s.name === 'ডাল')).toBe(true);
    await voidEntry(a.db, a.w, 'purchases', buy);
    expect((await stockList(a.db)).find((s) => s.name === 'ডাল')).toMatchObject({ bought: 0, purchases: 0 });
  });

  it('History still has the voided one: struck through, shown only with the toggle', async () => {
    const a = await shopA();
    const keep = await sell(a.db, a.w, 'চাল ১ কেজি ৬০ টাকা');
    const gone = await sell(a.db, a.w, 'চাল ২ কেজি ১২০ টাকা');
    await voidEntry(a.db, a.w, 'sales', gone);
    const items = buildHistory(await historyRows(a.db, dayOf(DAY0), dayOf(DAY0) + 86_400_000));
    expect(visibleHistory(items, false).filter((i) => i.kind === 'sale').map((i) => i.id)).toEqual([keep]);
    const all = visibleHistory(items, true).filter((i) => i.kind === 'sale');
    expect(all.map((i) => [i.id, i.voided])).toEqual(expect.arrayContaining([[keep, false], [gone, true]]));
  });

  it('deleting is synced: the other phone hides it too, nothing is left to push back', async () => {
    const cloud = new FakeCloud();
    const a = await shopA(cloud);
    const b = await phoneOf('B', cloud, 'shop-uid', DAY0 + 5000);
    const basket = await sell(a.db, a.w, 'করিম চাল ২ কেজি বাকিতে নিল ১২০ টাকা', true);
    await syncPhone(a);
    await syncPhone(b);
    expect((await customerBalances(b.db))[0]).toMatchObject({ name: 'করিম', balance_poisha: 12000 });

    await voidEntry(a.db, a.w, 'sales', basket);
    await syncPhone(a);
    await syncPhone(b);
    expect((await customerBalances(b.db))[0]).toMatchObject({ balance_poisha: 0 });
    expect((await recentEntries(b.db, 10)).some((r) => r.kind === 'sale')).toBe(false);
    expect(await b.db.getFirstAsync('SELECT SUM(voided) AS v FROM sales')).toEqual({ v: 1 });
    expect(await a.engine.pendingCount()).toBe(0);
    expect(await b.engine.pendingCount()).toBe(0);
  });

  it('both phones delete the same entry: both void rows are kept, still one hidden entry', async () => {
    const cloud = new FakeCloud();
    const a = await shopA(cloud);
    const b = await phoneOf('B', cloud, 'shop-uid', DAY0 + 5000);
    const exp = await enter(a.db, a.w, 'বিদ্যুৎ বিল ৫০০ টাকা', 'expense');
    await syncPhone(a);
    await syncPhone(b);
    await voidEntry(a.db, a.w, 'expenses', exp);
    await voidEntry(b.db, b.w, 'expenses', exp);
    await syncPhone(a);
    await syncPhone(b);
    await syncPhone(a);
    for (const p of [a, b]) {
      expect(await p.db.getFirstAsync('SELECT COUNT(*) AS n FROM v_expenses')).toEqual({ n: 0 });
      expect(await p.db.getFirstAsync('SELECT COUNT(*) AS n FROM expenses')).toEqual({ n: 3 });
    }
  });
});

describe('delete a customer or product', () => {
  const names = (p: Phone) => customerBalances(p.db).then((r) => r.map((c) => c.name));

  it('a customer with no entries is deleted (hidden everywhere, synced)', async () => {
    const cloud = new FakeCloud();
    const a = await shopA(cloud);
    const b = await phoneOf('B', cloud, 'shop-uid', DAY0 + 5000);
    await enter(a.db, a.w, 'রহিম ২০০ টাকা বাকি', 'ledger', asNewCustomer);
    const rahim = (await customerByName(a.db, 'রহিম'))!;
    const basket = await sell(a.db, a.w, 'রহিম চাল ১ কেজি বাকিতে নিল ৬০ টাকা');
    expect(await customerDeleteCheck(a.db, rahim.id)).toEqual({ entries: 3, balancePoisha: 26000 });
    // owes: no
    await expect(archiveParty(a.db, a.w, 'customers', rahim.id)).rejects.toThrow(/baki/);
    expect(await names(a)).toEqual(['রহিম']);

    // everything paid / voided → entries remain (paid) → only hide
    await enter(a.db, a.w, 'রহিম ২৬০ টাকা দিল', 'ledger');
    expect(await customerDeleteCheck(a.db, rahim.id)).toMatchObject({ balancePoisha: 0 });
    expect(await archiveParty(a.db, a.w, 'customers', rahim.id)).toBe('hide');
    expect(await names(a)).toEqual([]);
    expect(basket).toBeTruthy();

    await syncPhone(a);
    await syncPhone(b);
    expect(await names(b)).toEqual([]);
    expect(await b.db.getFirstAsync("SELECT archived FROM customers WHERE name = 'রহিম'")).toEqual({ archived: 1 });
    // the history still names him
    expect((await recentEntries(b.db, 10)).some((r) => r.title.includes('রহিম'))).toBe(true);
  });

  it('after every entry is deleted, a customer can be deleted for real (plan = delete)', async () => {
    const a = await shopA();
    const e = await enter(a.db, a.w, 'সুমি ১০০ টাকা বাকি', 'ledger', asNewCustomer);
    const sumi = (await customerByName(a.db, 'সুমি'))!;
    expect((await customerDeleteCheck(a.db, sumi.id)).entries).toBe(1);
    await voidEntry(a.db, a.w, 'ledger', e);
    expect(await customerDeleteCheck(a.db, sumi.id)).toEqual({ entries: 0, balancePoisha: 0 });
    expect(await archiveParty(a.db, a.w, 'customers', sumi.id)).toBe('delete');
    expect(await names(a)).toEqual([]);
    // a customer made again with the same name is a fresh one
    await enter(a.db, a.w, 'সুমি ৫০ টাকা বাকি', 'ledger', asNewCustomer);
    expect(await names(a)).toEqual(['সুমি']);
  });

  it('a product: no entries → delete, else hide; gone from the stock list and the pick list', async () => {
    const a = await phoneOf('A', null);
    await enter(a.db, a.w, 'চিনি ৫ কেজি কিনলাম ১২০ টাকা করে', 'purchase');
    const sugar = (await findProducts(a.db, ['চিনি'])).get('চিনি')!;
    expect(await productDeleteCheck(a.db, sugar.id)).toEqual({ entries: 1, balancePoisha: 0 });
    expect(await archiveParty(a.db, a.w, 'products', sugar.id)).toBe('hide');
    expect((await stockList(a.db)).map((s) => s.name)).not.toContain('চিনি');
    expect(await a.db.getFirstAsync("SELECT archived FROM products WHERE id = ?", sugar.id)).toEqual({ archived: 1 });
  });
});
