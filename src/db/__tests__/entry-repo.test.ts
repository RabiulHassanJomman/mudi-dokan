import { basketFromParse } from '../../domain/basket';
import { entryFromParse, withEntryCustomer, type EntryDraft } from '../../domain/entry';
import { parseCommand } from '../../parser';
import type { ParseContext } from '../../parser/types';
import {
  createVoiceLog,
  customerBalances,
  customerHistory,
  ensureDevice,
  findProduct,
  findProducts,
  getCustomer,
  getVoiceLog,
  knownNames,
  saveBasket,
  saveEntry,
  setCustomerPhone,
  setParsed,
  todayTotals,
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

async function draftOf(db: TestDb, text: string, tab: ParseContext['tab'] = 'sale'): Promise<EntryDraft> {
  const names = await knownNames(db);
  const parsed = parseCommand(text, { tab, knownCustomers: names.customers, knownProducts: names.products });
  const products = await findProducts(db, parsed.product ? [parsed.product] : []);
  return entryFromParse(parsed, { products, knownCustomers: names.customers, tab })!;
}

/** Parse → draft → (fix) → save, like the confirm card. */
async function save(db: TestDb, w: W, text: string, fix: (d: EntryDraft) => EntryDraft = (d) => d, tab: ParseContext['tab'] = 'sale') {
  const d = fix(await draftOf(db, text, tab));
  const logId = await createVoiceLog(db, w, { transcript: text, source: 'voice', contextTab: tab ?? 'sale' });
  await setParsed(db, w, logId, parseCommand(text, { tab }));
  const entryId = await saveEntry(db, w, d, logId, []);
  return { logId, entryId };
}
const newCustomer = (d: EntryDraft) => withEntryCustomer(d, d.customerName ?? '', true);

describe('saveEntry', () => {
  it('baki for a new customer: customer + ledger row linked to the voice log; log knows the intent', async () => {
    const { db, w, raw } = await setup();
    const { logId, entryId } = await save(db, w, 'করিম ৫০০ টাকা বাকি', newCustomer);
    expect(raw.prepare('SELECT name FROM customers').all()).toEqual([{ name: 'করিম' }]);
    expect(raw.prepare('SELECT id, kind, amount_poisha, party_type, voice_log_id FROM ledger').all()).toEqual([
      { id: entryId, kind: 'baki', amount_poisha: 50000, party_type: 'customer', voice_log_id: logId },
    ]);
    const log = await getVoiceLog(db, logId);
    expect(log).toMatchObject({ outcome: 'saved', intent: 'baki', entry_table: 'ledger', entry_id: entryId });
    expect(JSON.parse(log!.final_json!)).toMatchObject({ intent: 'baki', customer: 'করিম', amount: 500 });
  });

  it('joma for a known customer reuses it', async () => {
    const { db, w, raw } = await setup();
    await save(db, w, 'করিম ৫০০ টাকা বাকি', newCustomer);
    await save(db, w, 'করিম ২০০ টাকা জমা দিল');
    expect(raw.prepare('SELECT COUNT(*) AS n FROM customers').get()).toEqual({ n: 1 });
    expect(raw.prepare('SELECT kind, amount_poisha FROM ledger ORDER BY created_at').all()).toEqual([
      { kind: 'baki', amount_poisha: 50000 },
      { kind: 'joma', amount_poisha: 20000 },
    ]);
  });

  it('confirming a new customer is not a correction: outcome stays "saved" (edit still listed)', async () => {
    const { db, w } = await setup();
    const d = newCustomer(await draftOf(db, 'করিম ৫০০ টাকা বাকি'));
    const logId = await createVoiceLog(db, w, { transcript: 'করিম ৫০০ টাকা বাকি', source: 'voice', contextTab: 'sale' });
    await saveEntry(db, w, d, logId, ['customerNew']);
    expect(await getVoiceLog(db, logId)).toMatchObject({ outcome: 'saved', edits_json: '["customerNew"]' });
    const d2 = await draftOf(db, 'করিম ৫০০ টাকা বাকি');
    const log2 = await createVoiceLog(db, w, { transcript: 'করিম ৫০০ টাকা বাকি', source: 'voice', contextTab: 'sale' });
    await saveEntry(db, w, d2, log2, ['customerNew', 'amountPoisha']);
    expect(await getVoiceLog(db, log2)).toMatchObject({ outcome: 'saved_edited' });
  });

  it('an unconfirmed unknown customer is refused', async () => {
    const { db, w } = await setup();
    await expect(save(db, w, 'করিম ৫০০ টাকা বাকি')).rejects.toThrow(/customer_unknown/);
  });

  it('expense and owner withdrawal go to their own tables', async () => {
    const { db, w, raw } = await setup();
    await save(db, w, 'বিদ্যুৎ বিল ৫০০ টাকা খরচ');
    const { logId } = await save(db, w, 'মালিক ৩০০ নিল');
    expect(raw.prepare('SELECT item, amount_poisha, device_name FROM expenses').all()).toEqual([
      { item: 'বিদ্যুৎ বিল', amount_poisha: 50000, device_name: 'আব্বু' },
    ]);
    expect(raw.prepare('SELECT person, amount_poisha FROM owner_withdrawals').all()).toEqual([{ person: 'মালিক', amount_poisha: 30000 }]);
    expect(await getVoiceLog(db, logId)).toMatchObject({ intent: 'owner_withdrawal', entry_table: 'owner_withdrawals' });
  });

  it('purchase of a new product creates it with the said sell price', async () => {
    const { db, w, raw } = await setup();
    await save(db, w, 'নতুন চাল ৫০ কেজি কেনা ৫৫ বেচা ৬০');
    expect(raw.prepare('SELECT name, unit, sell_price_poisha FROM products').all()).toEqual([{ name: 'চাল', unit: 'kg', sell_price_poisha: 6000 }]);
    expect(raw.prepare('SELECT quantity, buy_price_poisha, sell_price_poisha, total_poisha, paid_cash FROM purchases').all()).toEqual([
      { quantity: 50, buy_price_poisha: 5500, sell_price_poisha: 6000, total_poisha: 275000, paid_cash: 1 },
    ]);
  });

  it('purchases update the average cost; a later sale records it; a new sell price is stored', async () => {
    const { db, w, raw } = await setup();
    await save(db, w, 'নতুন চাল ৫০ কেজি কেনা ৫০ বেচা ৬০');
    await save(db, w, 'চাল ৫০ কেজি কিনলাম কেজি ৬০ বেচা ৭০');
    const chal = await findProduct(db, 'চাল');
    expect(chal).toMatchObject({ costPricePoisha: 5500, sellPricePoisha: 7000 });
    // a sale now saves the average cost at the time of sale
    const parsed = parseCommand('চাল ২ কেজি', { tab: 'sale' });
    const b = basketFromParse(parsed, await findProducts(db, ['চাল']));
    const logId = await createVoiceLog(db, w, { transcript: 'চাল ২ কেজি', source: 'voice', contextTab: 'sale' });
    await saveBasket(db, w, b, logId, []);
    expect(raw.prepare('SELECT cost_price_poisha, cost_known, amount_poisha FROM sales').all()).toEqual([
      { cost_price_poisha: 5500, cost_known: 1, amount_poisha: 14000 },
    ]);
  });
});

describe('customers: balances, history, phone', () => {
  async function shop() {
    const s = await setup();
    await save(s.db, s.w, 'করিম ৫০০ টাকা বাকি', newCustomer);
    await save(s.db, s.w, 'রহিম ১০০ টাকা বাকি', newCustomer);
    await save(s.db, s.w, 'করিম ২০০ টাকা জমা দিল');
    // a credit sale adds a baki row for its basket
    const parsed = parseCommand('রহিম চাল ২ কেজি ১২০ টাকা বাকিতে নিল', { tab: 'sale', knownCustomers: ['করিম', 'রহিম'] });
    const b = basketFromParse(parsed, new Map());
    const logId = await createVoiceLog(s.db, s.w, { transcript: 'রহিম চাল ২ কেজি ১২০ টাকা বাকিতে নিল', source: 'voice', contextTab: 'sale', audioPath: '/a.wav' });
    await saveBasket(s.db, s.w, b, logId, []);
    return s;
  }

  it('balance = baki − joma, biggest first; total owed', async () => {
    const { db } = await shop();
    const list = await customerBalances(db);
    expect(list.map((c) => [c.name, c.balance_poisha])).toEqual([
      ['করিম', 30000],
      ['রহিম', 22000],
    ]);
  });

  it('history: newest first, with the products of a credit sale and its clip', async () => {
    const { db } = await shop();
    const rahim = (await customerBalances(db)).find((c) => c.name === 'রহিম')!;
    const h = await customerHistory(db, rahim.id);
    expect(h.map((r) => [r.kind, r.amount_poisha, r.products])).toEqual([
      ['baki', 12000, 'চাল'],
      ['baki', 10000, null],
    ]);
    expect(h[0]).toMatchObject({ audio_path: '/a.wav', transcript: 'রহিম চাল ২ কেজি ১২০ টাকা বাকিতে নিল' });
  });

  it('phone number can be saved (customers are master data)', async () => {
    const { db, w } = await shop();
    const karim = (await customerBalances(db)).find((c) => c.name === 'করিম')!;
    await setCustomerPhone(db, w, karim.id, '01712345678');
    expect(await getCustomer(db, karim.id)).toMatchObject({ name: 'করিম', phone: '01712345678', balance_poisha: 30000 });
  });

  it("today's baki counts plain baki entries too, not only credit sales", async () => {
    const { db } = await shop();
    expect(await todayTotals(db, 0)).toEqual({ sales: 12000, baki: 72000 });
  });
});
