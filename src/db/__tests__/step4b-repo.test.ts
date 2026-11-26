/**
 * Build step 4b on the real schema: the মাল list (stock = bought − sold), aliases
 * (choose a closest product → product_aliases → parser ctx), a customer on a cash
 * sale, the home list of every entry type, and "করিমের বাকি কত?".
 */
import { basketFromParse, chooseProduct, withCustomer } from '../../domain/basket';
import { choosePurchaseProduct, entryFromParse, withEntryCustomer, type EntryDraft } from '../../domain/entry';
import { stockView } from '../../domain/stock';
import { parseCommand } from '../../parser';
import type { ParseContext } from '../../parser/types';
import {
  addProductAlias,
  createVoiceLog,
  customerByName,
  ensureDevice,
  findProduct,
  findProducts,
  knownNames,
  pickProducts,
  productAliasMap,
  recentEntries,
  saveBasket,
  saveEntry,
  stockList,
} from '../repo';
import { migratedDb, testWriter } from './nodeDb';

type TestDb = Awaited<ReturnType<typeof migratedDb>>;
type W = ReturnType<typeof testWriter>;

async function setup() {
  const db = await migratedDb();
  const w = testWriter();
  await ensureDevice(db, w, 'owner');
  return { db, w, raw: db.raw };
}

async function ctxOf(db: TestDb, tab: ParseContext['tab'] = 'sale'): Promise<ParseContext> {
  const names = await knownNames(db);
  return { tab, knownProducts: names.products, knownCustomers: names.customers, productAliases: await productAliasMap(db) };
}

async function sell(db: TestDb, w: W, text: string, fix = (b: ReturnType<typeof basketFromParse>) => b) {
  const ctx = await ctxOf(db);
  const parsed = parseCommand(text, ctx);
  const products = await findProducts(db, (parsed.items ?? []).map((i) => i.product ?? ''));
  const b = fix(basketFromParse(parsed, products, ctx.knownCustomers));
  const logId = await createVoiceLog(db, w, { transcript: text, source: 'voice', contextTab: 'sale', parsed });
  return saveBasket(db, w, b, logId, []);
}

async function entry(db: TestDb, w: W, text: string, fix: (d: EntryDraft) => EntryDraft = (d) => d, tab: ParseContext['tab'] = 'sale') {
  const ctx = await ctxOf(db, tab);
  const parsed = parseCommand(text, ctx);
  const products = await findProducts(db, parsed.product ? [parsed.product] : []);
  const d = fix(entryFromParse(parsed, { products, knownCustomers: ctx.knownCustomers ?? [], tab })!);
  const logId = await createVoiceLog(db, w, { transcript: text, source: 'voice', contextTab: tab ?? 'sale', parsed });
  return saveEntry(db, w, d, logId, []);
}
const newCustomer = (d: EntryDraft) => withEntryCustomer(d, d.customerName ?? '', true);

describe('stockList (মাল)', () => {
  it('bought − sold per product; never-bought products have no purchases', async () => {
    const { db, w } = await setup();
    await entry(db, w, 'নতুন চাল ৫০ কেজি কেনা ৫৫ বেচা ৬০');
    await entry(db, w, 'চাল ১০ কেজি কিনলাম ৫৫০ টাকা');
    await sell(db, w, 'চাল ৮ কেজি');
    await sell(db, w, 'চাল আড়াই কেজি');
    await sell(db, w, 'ডাল ২ কেজি ২২০ টাকা'); // new product at its first sale
    const list = await stockList(db);
    expect(list).toEqual([
      { id: expect.any(String), name: 'চাল', unit: 'kg', sellPricePoisha: 6000, costPricePoisha: 5500, bought: 60, sold: 10.5, purchases: 2, spentPoisha: 0 },
      { id: expect.any(String), name: 'ডাল', unit: 'kg', sellPricePoisha: 11000, costPricePoisha: null, bought: 0, sold: 2, purchases: 0, spentPoisha: 0 },
    ]);
    expect(list.map(stockView).map((v) => [v.name, v.stock, v.low])).toEqual([
      ['চাল', 49.5, false],
      ['ডাল', null, false],
    ]);
  });

  it('counts only the effective version of a corrected row', async () => {
    const { db, w, raw } = await setup();
    await entry(db, w, 'নতুন চাল ৫০ কেজি কেনা ৫৫ বেচা ৬০');
    const first = raw.prepare('SELECT * FROM purchases').get() as Record<string, unknown>;
    raw
      .prepare(
        `INSERT INTO purchases (id, product_id, quantity, buy_price_poisha, total_poisha, corrects_id, device_name, device_id, created_at, updated_at)
         VALUES ('fix', ?, 40, 5500, 220000, ?, 'আব্বু', 'dev-1', 2, 2)`,
      )
      .run(first.product_id as string, first.id as string);
    expect((await stockList(db))[0]).toMatchObject({ bought: 40, purchases: 1 });
  });
});

describe('aliases', () => {
  it('choosing a closest product on a sale saves the spoken name; the next parse knows it', async () => {
    const { db, w, raw } = await setup();
    await entry(db, w, 'নতুন চাল ৫০ কেজি কেনা ৫৫ বেচা ৬০');
    const chal = (await findProduct(db, 'চাল'))!;
    await sell(db, w, 'চাউল ২ কেজি', (b) => chooseProduct(b, b.items[0]!.key, chal));
    expect(raw.prepare('SELECT alias, product_id FROM product_aliases').all()).toEqual([{ alias: 'চাউল', product_id: chal.id }]);
    expect(raw.prepare('SELECT COUNT(*) AS n FROM products').get()).toEqual({ n: 1 });
    expect(await productAliasMap(db)).toEqual({ চাউল: 'চাল' });
    expect((await pickProducts(db))[0]!.aliases).toEqual(['চাউল']);

    // next time: the parser maps it, the line is চাল straight away
    const parsed = parseCommand('চাউল ৩ কেজি', await ctxOf(db));
    expect(parsed).toMatchObject({ product: 'চাল', confidence: 'high' });
    // the same alias again is not stored twice
    await sell(db, w, 'চাউল ১ কেজি');
    await addProductAlias(db, w, 'চাউল', chal.id);
    expect(raw.prepare('SELECT COUNT(*) AS n FROM product_aliases').get()).toEqual({ n: 1 });
  });

  it('on a purchase too', async () => {
    const { db, w, raw } = await setup();
    await entry(db, w, 'নতুন পেঁয়াজ ১০ কেজি কেনা ৪০ বেচা ৫০');
    const p = (await findProduct(db, 'পেঁয়াজ'))!;
    await entry(db, w, 'পিয়াজ ৫ কেজি কিনলাম ২০০ টাকা', (d) => choosePurchaseProduct(d, p));
    expect(raw.prepare('SELECT alias FROM product_aliases').all()).toEqual([{ alias: 'পিয়াজ' }]);
    expect((await stockList(db))[0]).toMatchObject({ name: 'পেঁয়াজ', bought: 15 });
  });

  it('a name that is already a product is never an alias', async () => {
    const { db, w, raw } = await setup();
    await entry(db, w, 'নতুন চাল ৫০ কেজি কেনা ৫৫ বেচা ৬০');
    const chal = (await findProduct(db, 'চাল'))!;
    await addProductAlias(db, w, 'চাল', chal.id);
    expect(raw.prepare('SELECT COUNT(*) AS n FROM product_aliases').get()).toEqual({ n: 0 });
  });
});

describe('cash sale with a customer', () => {
  it('the sale row carries the customer; no baki row', async () => {
    const { db, w, raw } = await setup();
    await entry(db, w, 'করিম ২০০ টাকা বাকি', newCustomer);
    await sell(db, w, 'করিম চাল ২ কেজি ১২০ টাকা');
    await sell(db, w, 'রহিম চাল ১ কেজি নিল ৬০ টাকা', (b) => withCustomer(b, 'রহিম', true));
    expect(raw.prepare('SELECT c.name, s.credit FROM sales s JOIN customers c ON c.id = s.customer_id ORDER BY s.created_at').all()).toEqual([
      { name: 'করিম', credit: 0 },
      { name: 'রহিম', credit: 0 },
    ]);
    expect(raw.prepare("SELECT COUNT(*) AS n FROM ledger WHERE kind = 'baki'").get()).toEqual({ n: 1 });
    expect(await customerByName(db, 'করিম')).toMatchObject({ name: 'করিম', balance_poisha: 20000 });
  });
});

describe('recentEntries (home)', () => {
  it('every entry type, newest first; a credit sale is one row (its baki row is not repeated)', async () => {
    const { db, w } = await setup();
    await entry(db, w, 'নতুন চাল ৫০ কেজি কেনা ৫৫ বেচা ৬০');
    await sell(db, w, 'করিম চাল ২ কেজি বাকিতে নিল', (b) => withCustomer(b, 'করিম', true));
    await entry(db, w, 'করিম ১০০ টাকা জমা');
    await entry(db, w, 'বিদ্যুৎ বিল ৫০০ টাকা খরচ');
    await entry(db, w, 'মালিক ৩০০ নিল');
    await sell(db, w, 'চাল ১ কেজি আর ডাল ১ কেজি ১১০ টাকা');
    const rows = await recentEntries(db, 10);
    expect(rows.map((r) => [r.kind, r.title, r.amount_poisha, r.credit, r.customer, r.lines])).toEqual([
      ['sale', 'চাল, ডাল', 17000, 0, null, 2],
      ['owner_withdrawal', 'মালিক', 30000, 0, null, 0],
      ['expense', 'বিদ্যুৎ বিল', 50000, 0, null, 0],
      ['joma', 'করিম', 10000, 0, null, 0],
      ['sale', 'চাল', 12000, 1, 'করিম', 1],
      ['purchase', 'চাল', 275000, 0, null, 0],
    ]);
    expect(rows.find((r) => r.kind === 'purchase')).toMatchObject({ quantity: 50, unit: 'kg' });
    expect((await recentEntries(db, 3)).length).toBe(3);
  });
});

describe('customerByName ("করিমের বাকি কত?")', () => {
  it('known name → balance; unknown → null', async () => {
    const { db, w } = await setup();
    await entry(db, w, 'করিম ৫০০ টাকা বাকি', newCustomer);
    await entry(db, w, 'করিম ২০০ টাকা জমা');
    expect(await customerByName(db, 'করিম')).toMatchObject({ balance_poisha: 30000 });
    expect(await customerByName(db, 'রহিম')).toBeNull();
  });
});
