import { draftFromParse, withCredit, withCustomer, withPrice, type SaleDraft } from '../../domain/saleDraft';
import { parseCommand } from '../../parser';
import {
  createVoiceLog,
  ensureDevice,
  findProduct,
  getVoiceLog,
  knownNames,
  pilotStats,
  recentSales,
  saveSale,
  setOutcome,
  todayTotals,
} from '../repo';
import { migratedDb, testWriter } from './nodeDb';

const p = (t: string) => parseCommand(t, { tab: 'sale' });

async function setup() {
  const db = await migratedDb();
  const w = testWriter();
  await ensureDevice(db, w, 'owner');
  return { db, w, raw: db.raw };
}

async function sell(db: Awaited<ReturnType<typeof setup>>['db'], w: ReturnType<typeof testWriter>, text: string, fix?: (d: SaleDraft) => SaleDraft) {
  const parsed = p(text);
  const product = parsed.product ? await findProduct(db, parsed.product) : null;
  const first = draftFromParse(parsed, product);
  const final = fix ? fix(first) : first;
  const logId = await createVoiceLog(db, w, { transcript: text, source: 'typed', contextTab: 'sale', parsed });
  const saleId = await saveSale(db, w, final, logId, fix ? ['edited'] : []);
  return { saleId, logId };
}

describe('device', () => {
  it('registers this phone once', async () => {
    const { db, w, raw } = await setup();
    await ensureDevice(db, w, 'staff');
    expect(raw.prepare('SELECT id, device_name, role FROM devices').all()).toEqual([
      { id: 'dev-1', device_name: 'আব্বু', role: 'owner' },
    ]);
  });
});

describe('saveSale', () => {
  it('creates a new product from the first sale and logs it as saved', async () => {
    const { db, w, raw } = await setup();
    const { saleId, logId } = await sell(db, w, 'চাল ২ কেজি ১২০ টাকা');
    expect(raw.prepare('SELECT name, unit, sell_price_poisha FROM products').all()).toEqual([
      { name: 'চাল', unit: 'kg', sell_price_poisha: 6000 },
    ]);
    expect(raw.prepare('SELECT quantity, amount_poisha, cost_known, voice_log_id FROM sales WHERE id = ?').get(saleId)).toEqual({
      quantity: 2, amount_poisha: 12000, cost_known: 0, voice_log_id: logId,
    });
    expect(await getVoiceLog(db, logId)).toMatchObject({ outcome: 'saved', entry_table: 'sales', entry_id: saleId });
  });

  it('second sale uses the stored price; stock goes down', async () => {
    const { db, w, raw } = await setup();
    await sell(db, w, 'চাল ২ কেজি ১২০ টাকা');
    await sell(db, w, 'চাল ৫০০ গ্রাম');
    expect(raw.prepare('SELECT quantity, amount_poisha FROM sales ORDER BY created_at').all()).toEqual([
      { quantity: 2, amount_poisha: 12000 },
      { quantity: 0.5, amount_poisha: 3000 },
    ]);
    expect(raw.prepare('SELECT stock FROM v_stock').get()).toEqual({ stock: -2.5 });
  });

  it('uses the average buy price as cost when purchases exist', async () => {
    const { db, w, raw } = await setup();
    await sell(db, w, 'চাল ১ কেজি ৬০ টাকা');
    const pid = (raw.prepare('SELECT id FROM products').get() as { id: string }).id;
    for (const [id, q, price] of [['pu1', 10, 5000], ['pu2', 30, 5400]] as const) {
      raw.prepare(
        `INSERT INTO purchases (id, product_id, quantity, buy_price_poisha, total_poisha, device_name, device_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'আব্বু', 'dev-1', 1, 1)`,
      ).run(id, pid, q, price, q * price);
    }
    expect((await findProduct(db, 'চাল'))?.costPricePoisha).toBe(5300);
    const { saleId } = await sell(db, w, 'চাল ১ কেজি');
    expect(raw.prepare('SELECT cost_price_poisha, cost_known FROM sales WHERE id = ?').get(saleId)).toEqual({
      cost_price_poisha: 5300, cost_known: 1,
    });
  });

  it('credit sale writes the customer and a baki ledger row', async () => {
    const { db, w, raw } = await setup();
    await sell(db, w, 'চাল ১ কেজি ৬০ টাকা');
    const { saleId } = await sell(db, w, 'করিম চাল ১ কেজি বাকিতে নিল');
    expect(raw.prepare('SELECT name FROM customers').all()).toEqual([{ name: 'করিম' }]);
    expect(raw.prepare('SELECT kind, amount_poisha, sale_id FROM ledger').all()).toEqual([
      { kind: 'baki', amount_poisha: 6000, sale_id: saleId },
    ]);
    await sell(db, w, 'করিম চাল ২ কেজি বাকিতে নিল');
    expect(raw.prepare('SELECT COUNT(*) AS n FROM customers').get()).toEqual({ n: 1 });
    expect(await knownNames(db)).toEqual({ products: ['চাল'], customers: ['করিম'] });
  });

  it('logs edits as saved_edited', async () => {
    const { db, w } = await setup();
    const { logId } = await sell(db, w, 'আটা ২ কেজি', (d) => withPrice(d, 6000));
    expect(await getVoiceLog(db, logId)).toMatchObject({ outcome: 'saved_edited', edits_json: '["edited"]' });
  });

  it('refuses an incomplete draft and writes nothing', async () => {
    const { db, w, raw } = await setup();
    const parsed = p('আটা ২ কেজি');
    const logId = await createVoiceLog(db, w, { transcript: 'আটা ২ কেজি', source: 'typed', contextTab: 'sale', parsed });
    await expect(saveSale(db, w, draftFromParse(parsed, null), logId, [])).rejects.toThrow(/no_price/);
    expect(raw.prepare('SELECT COUNT(*) AS n FROM products').get()).toEqual({ n: 0 });
  });

  it('rolls back everything if a write fails', async () => {
    const { db, w, raw } = await setup();
    const parsed = p('চাল ১ কেজি ৬০ টাকা');
    const logId = await createVoiceLog(db, w, { transcript: 'x', source: 'typed', contextTab: 'sale', parsed });
    const bad = withCustomer(withCredit(draftFromParse(parsed, null), true), 'করিম');
    raw.exec("CREATE TRIGGER boom BEFORE INSERT ON ledger BEGIN SELECT RAISE(ABORT, 'boom'); END;");
    await expect(saveSale(db, w, bad, logId, [])).rejects.toThrow(/boom/);
    for (const t of ['products', 'customers', 'sales', 'ledger']) {
      expect({ t, ...(raw.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as object) }).toEqual({ t, n: 0 });
    }
    expect(await getVoiceLog(db, logId)).toMatchObject({ outcome: 'pending' });
  });
});

describe('voice log & pilot stats', () => {
  it('records STT errors, keeps outcomes final, computes accuracy', async () => {
    const { db, w } = await setup();
    await sell(db, w, 'চাল ২ কেজি ১২০ টাকা'); // saved
    await sell(db, w, 'চাল ১ কেজি'); // saved
    await sell(db, w, 'চাল ৩ কেজি', (d) => d); // saved_edited
    const c = await createVoiceLog(db, w, { transcript: 'চাউল দুই', source: 'voice', contextTab: 'sale' });
    await setOutcome(db, w, c, 'cancelled');
    await setOutcome(db, w, c, 'saved'); // ignored: already decided
    await createVoiceLog(db, w, { transcript: '', source: 'voice', contextTab: 'sale', sttError: 'no-speech' });
    const u = await createVoiceLog(db, w, { transcript: 'করিম ৫০০ জমা', source: 'voice', contextTab: 'sale' });
    await setOutcome(db, w, u, 'unsupported');

    expect(await getVoiceLog(db, c)).toMatchObject({ outcome: 'cancelled' });
    expect(await pilotStats(db)).toEqual({
      total: 6, saved: 2, edited: 1, cancelled: 1, unsupported: 1, sttError: 1, accuracy: 50,
    });
  });

  it('recent sales and today totals', async () => {
    const { db, w } = await setup();
    await sell(db, w, 'চাল ২ কেজি ১২০ টাকা');
    await sell(db, w, 'করিম চাল ১ কেজি বাকিতে নিল');
    const recent = await recentSales(db, 5);
    expect(recent.map((r) => [r.product, r.quantity, r.amount_poisha, r.credit, r.customer])).toEqual([
      ['চাল', 1, 6000, 1, 'করিম'],
      ['চাল', 2, 12000, 0, null],
    ]);
    expect(await todayTotals(db, 0)).toEqual({ sales: 18000, baki: 6000 });
  });
});
