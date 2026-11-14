import { customerCandidates, importCustomers } from '../repo';
import { migratedDb, testWriter } from './nodeDb';

describe('customer list import', () => {
  it('candidates: shop customers with phone (suppliers and archived left out)', async () => {
    const db = await migratedDb();
    const w = testWriter();
    await importCustomers(db, w, [{ name: 'করিম', phone: '01711123456', note: 'ভাই' }, { name: 'মিনা', phone: null, note: null }]);
    await db.runAsync("INSERT INTO customers (id, name, party_type, device_id, created_at, updated_at) VALUES ('s1', 'রহিম ট্রেডার্স', 'supplier', 'd', 1, 1)");
    await db.runAsync("INSERT INTO customers (id, name, archived, device_id, created_at, updated_at) VALUES ('a1', 'পুরনো', 1, 'd', 1, 1)");
    expect(await customerCandidates(db)).toEqual([
      { name: 'করিম', aliases: [], phone: '01711123456', label: 'আগে থেকে' },
      { name: 'মিনা', aliases: [], phone: null, label: 'আগে থেকে' },
    ]);
  });

  it('saves normal customer rows (UUID, device, times) in one go; returns how many', async () => {
    const db = await migratedDb();
    const w = testWriter();
    const n = await importCustomers(db, w, [
      { name: 'করিম', phone: '01711123456', note: 'ভাই · মসজিদের পাশে' },
      { name: 'Karim', phone: null, note: null },
    ]);
    expect(n).toBe(2);
    const rows = await db.getAllAsync('SELECT id, name, phone, note, party_type, archived, device_id, created_at, updated_at FROM customers ORDER BY name');
    expect(rows).toEqual([
      expect.objectContaining({ name: 'Karim', phone: null, note: null, party_type: 'customer', archived: 0, device_id: 'dev-1' }),
      expect.objectContaining({ name: 'করিম', phone: '01711123456', note: 'ভাই · মসজিদের পাশে', party_type: 'customer' }),
    ]);
    for (const r of rows as { id: string; created_at: number; updated_at: number }[]) {
      expect(r.id).toMatch(/^id-/);
      expect(r.updated_at).toBe(r.created_at);
    }
  });

  it('a failure saves nothing', async () => {
    const db = await migratedDb();
    const w = testWriter();
    await expect(importCustomers(db, w, [{ name: 'করিম', phone: null, note: null }, { name: null as unknown as string, phone: null, note: null }])).rejects.toThrow();
    expect(await db.getAllAsync('SELECT * FROM customers')).toEqual([]);
  });
});

describe('customer aliases', () => {
  it('learned alias → map, import candidates; never a customer name or a second time', async () => {
    const { addCustomerAlias, customerAliasMap, customerCandidates: cands, importCustomers: imp } = await import('../repo');
    const db = await migratedDb();
    const w = testWriter();
    await imp(db, w, [{ name: 'করিম', phone: null, note: null }, { name: 'মিনা', phone: null, note: null }]);
    expect(await addCustomerAlias(db, w, ' কোরিম ', 'করিম')).toBe(true);
    expect(await addCustomerAlias(db, w, 'কোরিম', 'করিম')).toBe(false);
    expect(await addCustomerAlias(db, w, 'মিনা', 'করিম')).toBe(false);
    expect(await addCustomerAlias(db, w, 'x', 'কেউ না')).toBe(false);
    expect(await customerAliasMap(db)).toEqual({ কোরিম: 'করিম' });
    expect((await cands(db)).find((c) => c.name === 'করিম')!.aliases).toEqual(['কোরিম']);
  });

  it('the pilot wipe clears aliases with the customers', async () => {
    const { addCustomerAlias, wipePilotData } = await import('../repo');
    const db = await migratedDb();
    const w = testWriter();
    await importCustomers(db, w, [{ name: 'করিম', phone: null, note: null }]);
    await addCustomerAlias(db, w, 'কোরিম', 'করিম');
    await wipePilotData(db);
    expect(await db.getAllAsync('SELECT * FROM customer_aliases')).toEqual([]);
  });
});
