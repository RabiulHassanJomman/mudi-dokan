import { basketFromParse, removeItem, setItemPrice, stepItem, withCredit, withCustomer, type BasketDraft } from '../../domain/basket';
import { parseCommand } from '../../parser';
import {
  createVoiceLog,
  ensureDevice,
  findProducts,
  getVoiceLog,
  knownNames,
  pilotStats,
  recentBaskets,
  saveBasket,
  setOutcome,
  setSttOk,
  wipePilotData,
  todayTotals,
} from '../repo';
import { migratedDb, testWriter } from './nodeDb';

type TestDb = Awaited<ReturnType<typeof migratedDb>>;
const p = (t: string) => parseCommand(t, { tab: 'sale' });

async function setup() {
  const db = await migratedDb();
  const w = testWriter();
  await ensureDevice(db, w, 'owner');
  return { db, w, raw: db.raw };
}

async function draft(db: TestDb, text: string): Promise<BasketDraft> {
  const parsed = p(text);
  return basketFromParse(parsed, await findProducts(db, (parsed.items ?? []).map((i) => i.product ?? '')));
}

async function sell(db: TestDb, w: ReturnType<typeof testWriter>, text: string, fix?: (b: BasketDraft) => BasketDraft) {
  const first = await draft(db, text);
  const final = fix ? fix(first) : first;
  const logId = await createVoiceLog(db, w, { transcript: text, source: 'typed', contextTab: 'sale', parsed: p(text) });
  const basketId = await saveBasket(db, w, final, logId, fix ? ['edited'] : []);
  return { basketId, logId };
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

describe('saveBasket', () => {
  it('one line: creates the product, links sale, basket and voice log', async () => {
    const { db, w, raw } = await setup();
    const { basketId, logId } = await sell(db, w, 'চাল ২ কেজি ১২০ টাকা');
    expect(raw.prepare('SELECT name, unit, sell_price_poisha FROM products').all()).toEqual([
      { name: 'চাল', unit: 'kg', sell_price_poisha: 6000 },
    ]);
    expect(raw.prepare('SELECT quantity, amount_poisha, cost_known, basket_id, voice_log_id FROM sales').all()).toEqual([
      { quantity: 2, amount_poisha: 12000, cost_known: 0, basket_id: basketId, voice_log_id: logId },
    ]);
    expect(await getVoiceLog(db, logId)).toMatchObject({ outcome: 'saved', entry_table: 'sales', entry_id: basketId });
  });

  it('multi-line credit basket: a sale row per line, one baki row for the total', async () => {
    const { db, w, raw } = await setup();
    const text = 'করিম বাকিতে নিয়েছে দুই কেজি চাল ২০০ টাকা ৩ কেজি চাল ৪০০ টাকা ৫ কেজি তেল ৬০০ টাকা';
    const { basketId, logId } = await sell(db, w, text);
    expect(
      raw.prepare(
        `SELECT p.name, s.quantity, s.amount_poisha, s.credit, s.basket_id, s.voice_log_id
         FROM sales s JOIN products p ON p.id = s.product_id ORDER BY s.rowid`,
      ).all(),
    ).toEqual([
      { name: 'চাল', quantity: 2, amount_poisha: 20000, credit: 1, basket_id: basketId, voice_log_id: logId },
      { name: 'চাল', quantity: 3, amount_poisha: 40000, credit: 1, basket_id: basketId, voice_log_id: logId },
      { name: 'তেল', quantity: 5, amount_poisha: 60000, credit: 1, basket_id: basketId, voice_log_id: logId },
    ]);
    // the new product চাল is created once even though it is on two lines
    expect(raw.prepare('SELECT COUNT(*) AS n FROM products').get()).toEqual({ n: 2 });
    expect(raw.prepare('SELECT kind, amount_poisha, basket_id, voice_log_id FROM ledger').all()).toEqual([
      { kind: 'baki', amount_poisha: 120000, basket_id: basketId, voice_log_id: logId },
    ]);
    expect(raw.prepare('SELECT name FROM customers').all()).toEqual([{ name: 'করিম' }]);
    const log = await getVoiceLog(db, logId);
    expect(JSON.parse(log!.final_json!)).toMatchObject({
      credit: true,
      customer: 'করিম',
      total_poisha: 120000,
      items: [{ product: 'চাল', quantity: 2 }, { product: 'চাল', quantity: 3 }, { product: 'তেল', quantity: 5 }],
    });
  });

  it('numbers the lines of a basket (line_no, from 1)', async () => {
    const { db, w, raw } = await setup();
    const { basketId } = await sell(db, w, 'চাল ১ কেজি ৬০ টাকা ডাল ১ কেজি ১১০ টাকা তেল ১ কেজি ১৭৫ টাকা');
    expect(
      raw.prepare('SELECT p.name, s.line_no FROM sales s JOIN products p ON p.id = s.product_id WHERE basket_id = ? ORDER BY line_no').all(basketId),
    ).toEqual([
      { name: 'চাল', line_no: 1 },
      { name: 'ডাল', line_no: 2 },
      { name: 'তেল', line_no: 3 },
    ]);
  });

  it('a mismatched unit is saved 1:1 in the product unit, spoken unit kept', async () => {
    const { db, w, raw } = await setup();
    raw.prepare(
      `INSERT INTO products (id, name, unit, sell_price_poisha, device_id, created_at, updated_at)
       VALUES ('oil', 'তেল', 'litre', 17000, 'dev-1', 1, 1)`,
    ).run();
    await sell(db, w, '৫ কেজি তেল');
    expect(raw.prepare('SELECT quantity, spoken_unit, sell_price_poisha, amount_poisha FROM sales').all()).toEqual([
      { quantity: 5, spoken_unit: 'kg', sell_price_poisha: 17000, amount_poisha: 85000 },
    ]);
  });

  it('second sale reuses the stored price; stock goes down', async () => {
    const { db, w, raw } = await setup();
    await sell(db, w, 'চাল ২ কেজি ১২০ টাকা');
    await sell(db, w, 'চাল ৫০০ গ্রাম ডাল ১ কেজি ১১০ টাকা');
    expect(raw.prepare('SELECT quantity, amount_poisha FROM sales ORDER BY rowid').all()).toEqual([
      { quantity: 2, amount_poisha: 12000 },
      { quantity: 0.5, amount_poisha: 3000 },
      { quantity: 1, amount_poisha: 11000 },
    ]);
    expect(raw.prepare("SELECT stock FROM v_stock WHERE name = 'চাল'").get()).toEqual({ stock: -2.5 });
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
    expect((await findProducts(db, ['চাল'])).get('চাল')?.costPricePoisha).toBe(5300);
    const { basketId } = await sell(db, w, 'চাল ১ কেজি');
    expect(raw.prepare('SELECT cost_price_poisha, cost_known FROM sales WHERE basket_id = ?').get(basketId)).toEqual({
      cost_price_poisha: 5300,
      cost_known: 1,
    });
  });

  it('edited basket logs saved_edited and the final lines', async () => {
    const { db, w, raw } = await setup();
    const { logId } = await sell(db, w, 'আটা ২ কেজি চাল ১ কেজি ৬০ টাকা', (b) =>
      removeItem(setItemPrice(stepItem(b, '0', 1), '0', 6000), '1'),
    );
    expect(await getVoiceLog(db, logId)).toMatchObject({ outcome: 'saved_edited', edits_json: '["edited"]' });
    expect(raw.prepare('SELECT quantity, amount_poisha FROM sales').all()).toEqual([{ quantity: 2.5, amount_poisha: 15000 }]);
  });

  it('refuses an incomplete basket and writes nothing', async () => {
    const { db, w, raw } = await setup();
    const b = await draft(db, 'আটা ২ কেজি');
    const logId = await createVoiceLog(db, w, { transcript: 'আটা ২ কেজি', source: 'typed', contextTab: 'sale' });
    await expect(saveBasket(db, w, b, logId, [])).rejects.toThrow(/not complete/);
    expect(raw.prepare('SELECT COUNT(*) AS n FROM products').get()).toEqual({ n: 0 });
  });

  it('rolls back everything if a write fails', async () => {
    const { db, w, raw } = await setup();
    const b = withCustomer(withCredit(await draft(db, 'চাল ১ কেজি ৬০ টাকা ডাল ১ কেজি ১১০ টাকা'), true), 'করিম');
    const logId = await createVoiceLog(db, w, { transcript: 'x', source: 'typed', contextTab: 'sale' });
    raw.exec("CREATE TRIGGER boom BEFORE INSERT ON ledger BEGIN SELECT RAISE(ABORT, 'boom'); END;");
    await expect(saveBasket(db, w, b, logId, [])).rejects.toThrow(/boom/);
    for (const t of ['products', 'customers', 'sales', 'ledger']) {
      expect({ t, ...(raw.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as object) }).toEqual({ t, n: 0 });
    }
    expect(await getVoiceLog(db, logId)).toMatchObject({ outcome: 'pending' });
  });
});

describe('reads', () => {
  it('known names', async () => {
    const { db, w } = await setup();
    await sell(db, w, 'করিম চাল ১ কেজি ৬০ টাকা বাকিতে নিল');
    await sell(db, w, 'করিম চাল ২ কেজি বাকিতে নিল');
    expect(await knownNames(db)).toEqual({ products: ['চাল'], customers: ['করিম'] });
  });

  it('recent baskets list products in line order even when saved in the same millisecond', async () => {
    const { db, raw } = await setup();
    const sameMs = { ...testWriter(), now: () => 5_000 };
    const text = 'তেল ১ কেজি ১৭৫ টাকা চাল ১ কেজি ৬০ টাকা ডাল ১ কেজি ১১০ টাকা';
    const logId = await createVoiceLog(db, sameMs, { transcript: text, source: 'typed', contextTab: 'sale' });
    await saveBasket(db, sameMs, await draft(db, text), logId, []);
    expect(raw.prepare('SELECT COUNT(DISTINCT created_at) AS n FROM sales').get()).toEqual({ n: 1 });
    expect((await recentBaskets(db, 1))[0]!.products).toBe('তেল, চাল, ডাল');
  });

  it('recent baskets group lines; today totals', async () => {
    const { db, w } = await setup();
    await sell(db, w, 'চাল ২ কেজি ১২০ টাকা');
    await sell(db, w, 'করিম বাকিতে নিল চাল ১ কেজি ডাল ১ কেজি ১১০ টাকা');
    const recent = await recentBaskets(db, 5);
    expect(recent.map((r) => [r.products, r.lines, r.amount_poisha, r.credit, r.customer])).toEqual([
      ['চাল, ডাল', 2, 17000, 1, 'করিম'],
      ['চাল', 1, 12000, 0, null],
    ]);
    expect(recent[1]).toMatchObject({ quantity: 2, unit: 'kg' });
    expect(await todayTotals(db, 0)).toEqual({ sales: 29000, baki: 17000 });
  });

  it('pilot stats', async () => {
    const { db, w } = await setup();
    await sell(db, w, 'চাল ২ কেজি ১২০ টাকা');
    await sell(db, w, 'চাল ১ কেজি');
    await sell(db, w, 'চাল ৩ কেজি', (b) => b);
    const c = await createVoiceLog(db, w, { transcript: 'চাউল দুই', source: 'voice', contextTab: 'sale' });
    await setOutcome(db, w, c, 'cancelled');
    await setOutcome(db, w, c, 'saved'); // ignored: already decided
    await createVoiceLog(db, w, { transcript: '', source: 'voice', contextTab: 'sale', sttError: 'no-speech' });
    const u = await createVoiceLog(db, w, { transcript: 'করিম ৫০০ জমা', source: 'voice', contextTab: 'sale' });
    await setOutcome(db, w, u, 'unsupported');
    expect(await getVoiceLog(db, c)).toMatchObject({ outcome: 'cancelled' });
    expect(await pilotStats(db)).toEqual({
      total: 6, saved: 2, edited: 1, cancelled: 1, unsupported: 1, sttError: 1, picked: 0, sttChecked: 0, sttOk: 0, accuracy: 50,
    });
  });

  it('stt_ok: the reviewer marks whether STT heard right', async () => {
    const { db, w } = await setup();
    const id = await createVoiceLog(db, w, { transcript: 'চাউল দুই', source: 'voice', contextTab: 'sale' });
    expect(await getVoiceLog(db, id)).toMatchObject({ stt_ok: null });
    await setSttOk(db, w, id, false);
    expect(await getVoiceLog(db, id)).toMatchObject({ stt_ok: 0 });
    await setSttOk(db, w, id, null);
    expect(await getVoiceLog(db, id)).toMatchObject({ stt_ok: null });
  });
});

describe('wipePilotData', () => {
  it('empties sales, products, customers, logs; keeps the device; append-only still holds', async () => {
    const { db, w, raw } = await setup();
    await sell(db, w, 'করিম বাকিতে নিল চাল ১ কেজি ৬০ টাকা');
    await createVoiceLog(db, w, { transcript: 'x', source: 'voice', contextTab: 'sale', audioPath: 'file:///a.wav' });
    const audio = await wipePilotData(db);
    expect(audio).toEqual(['file:///a.wav']);
    for (const t of ['products', 'customers', 'sales', 'ledger', 'voice_logs', 'product_aliases']) {
      expect({ t, ...(raw.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as object) }).toEqual({ t, n: 0 });
    }
    expect(raw.prepare('SELECT COUNT(*) AS n FROM devices').get()).toEqual({ n: 1 });
    // triggers are back
    await sell(db, w, 'চাল ১ কেজি ৬০ টাকা');
    expect(() => raw.exec('DELETE FROM sales')).toThrow(/append-only/);
    expect(() => raw.exec('UPDATE sales SET quantity = 9')).toThrow(/append-only/);
  });
});
