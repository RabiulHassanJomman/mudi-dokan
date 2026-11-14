import { createVoiceLog, ensureDevice, getSetup, pickProducts, saveSetup, setOutcome, type Writer } from '../repo';
import { migratedDb, testWriter } from './nodeDb';

const draft = { shopName: 'রহমান স্টোর', deviceName: 'আব্বু', role: 'owner' as const, openingCashPoisha: 500000 };

async function setup() {
  const db = await migratedDb();
  const w = testWriter();
  // the phone registers itself before Setup with the placeholder name
  await ensureDevice(db, { ...w, deviceName: 'এই ফোন' }, null);
  return { db, w, raw: db.raw };
}

describe('getSetup / saveSetup', () => {
  it('nothing yet: the placeholder device, no shop, no cash', async () => {
    const { db } = await setup();
    expect(await getSetup(db, 'dev-1')).toEqual({ shopName: null, deviceName: 'এই ফোন', role: 'staff', openingCashPoisha: null });
  });

  it('first run: shop row, device renamed + role, opening cash as a day_close opening entry', async () => {
    const { db, w, raw } = await setup();
    await saveSetup(db, w, draft, '2026-11-14');
    expect(raw.prepare('SELECT id, name FROM shop').all()).toEqual([{ id: 'shop', name: 'রহমান স্টোর' }]);
    expect(raw.prepare('SELECT id, device_name, role FROM devices').all()).toEqual([{ id: 'dev-1', device_name: 'আব্বু', role: 'owner' }]);
    expect(raw.prepare('SELECT business_date, kind, opening_cash_poisha, device_name, corrects_id FROM day_close').all()).toEqual([
      { business_date: '2026-11-14', kind: 'opening', opening_cash_poisha: 500000, device_name: 'আব্বু', corrects_id: null },
    ]);
    expect(await getSetup(db, 'dev-1')).toEqual(draft);
  });

  it('edit from settings: shop/device updated in place, changed cash is a correction row (never an UPDATE)', async () => {
    const { db, w, raw } = await setup();
    await saveSetup(db, w, draft, '2026-11-14');
    await saveSetup(db, w, { ...draft, shopName: 'রহমান জেনারেল স্টোর', deviceName: 'কর্মচারী ১', role: 'staff', openingCashPoisha: 450000 }, '2026-11-15');
    expect(raw.prepare('SELECT name FROM shop').all()).toEqual([{ name: 'রহমান জেনারেল স্টোর' }]);
    expect(raw.prepare('SELECT device_name, role FROM devices').all()).toEqual([{ device_name: 'কর্মচারী ১', role: 'staff' }]);
    const rows = raw.prepare('SELECT id, business_date, opening_cash_poisha, corrects_id FROM day_close ORDER BY created_at').all() as {
      id: string; business_date: string; opening_cash_poisha: number; corrects_id: string | null;
    }[];
    expect(rows).toHaveLength(2);
    // the correction keeps the original business day
    expect(rows[1]).toMatchObject({ business_date: '2026-11-14', opening_cash_poisha: 450000, corrects_id: rows[0]!.id });
    expect((await getSetup(db, 'dev-1')).openingCashPoisha).toBe(450000);
  });

  it('saving the same cash again adds no row', async () => {
    const { db, w, raw } = await setup();
    await saveSetup(db, w, draft, '2026-11-14');
    await saveSetup(db, w, { ...draft, shopName: 'অন্য নাম' }, '2026-11-14');
    expect(raw.prepare('SELECT COUNT(*) AS n FROM day_close').get()).toEqual({ n: 1 });
  });

  it('a phone that never registered is inserted', async () => {
    const db = await migratedDb();
    const w: Writer = { ...testWriter(), deviceId: 'dev-9' };
    await saveSetup(db, w, draft, '2026-11-14');
    expect(db.raw.prepare('SELECT id, device_name, role FROM devices').all()).toEqual([{ id: 'dev-9', device_name: 'আব্বু', role: 'owner' }]);
  });

  it('all or nothing: a failure leaves the old setup', async () => {
    const { db, w, raw } = await setup();
    await expect(saveSetup(db, w, { ...draft, role: 'boss' as never }, '2026-11-14')).rejects.toThrow();
    expect(raw.prepare('SELECT COUNT(*) AS n FROM shop').get()).toEqual({ n: 0 });
    expect(raw.prepare('SELECT COUNT(*) AS n FROM day_close').get()).toEqual({ n: 0 });
  });
});

describe('pickProducts', () => {
  it('active products, most sold first, with aliases', async () => {
    const { db, raw } = await setup();
    const row = (id: string) => `'${id}', 'dev-1', 1, 1`;
    raw.exec(`INSERT INTO products (id, name, unit, sell_price_poisha, archived, device_id, created_at, updated_at) VALUES
      ('p1', 'চাল', 'kg', 6000, 0, 'dev-1', 1, 1), ('p2', 'ডাল', 'kg', 11000, 0, 'dev-1', 2, 2),
      ('p3', 'পুরনো', 'kg', 100, 1, 'dev-1', 3, 3), ('p4', 'তেল', 'litre', NULL, 0, 'dev-1', 4, 4)`);
    raw.exec(`INSERT INTO product_aliases (id, alias, product_id, device_id, created_at, updated_at) VALUES (${row('a1').replace("'a1'", "'a1', 'চাউল', 'p1'")})`);
    const sale = (id: string, p: string) =>
      raw.exec(`INSERT INTO sales (id, product_id, quantity, sell_price_poisha, amount_poisha, cost_price_poisha, device_name, device_id, created_at, updated_at)
        VALUES ('${id}', '${p}', 1, 1, 1, 0, 'আব্বু', 'dev-1', 5, 5)`);
    sale('s1', 'p2');
    sale('s2', 'p2');
    sale('s3', 'p1');
    expect(await pickProducts(db)).toEqual([
      { id: 'p2', name: 'ডাল', unit: 'kg', sellPricePoisha: 11000, aliases: [] },
      { id: 'p1', name: 'চাল', unit: 'kg', sellPricePoisha: 6000, aliases: ['চাউল'] },
      { id: 'p4', name: 'তেল', unit: 'litre', sellPricePoisha: null, aliases: [] },
    ]);
  });
});

describe('ownerNames (parser ctx.ownerNames)', () => {
  it('device names of মালিক phones only; an existing device keeps its saved name and role', async () => {
    const { ownerNames } = await import('../repo');
    const db = await migratedDb();
    const w = testWriter();
    await saveSetup(db, w, { shopName: 'রহমান স্টোর', deviceName: 'রফিক', role: 'owner', openingCashPoisha: 0 }, '2026-11-14');
    await db.runAsync(
      "INSERT INTO devices (id, device_name, role, device_id, created_at, updated_at) VALUES ('d2', 'কর্মচারী ১', 'staff', 'd2', 1, 1)",
    );
    expect(await ownerNames(db)).toEqual(['রফিক']);
    expect((await getSetup(db, w.deviceId)).deviceName).toBe('রফিক');
  });
});
