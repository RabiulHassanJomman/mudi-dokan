import { convertGemini, GeminiOutputError } from '../convert';

const names = { knownProducts: ['চাল', 'তেল', 'ডিম', 'সাবান'], productAliases: { চাউল: 'চাল', 'লাক্স সাবান': 'সাবান' } };
const NULLS = { customer: null, credit: false, amount: null, item: null, person: null, note: null, items: [] };
const line = (product: string | null, quantity: number | null, unit: string, unitPrice: number | null, total: number | null) => ({
  product, quantity, unit, unitPrice, total,
});

describe('convertGemini: schema check', () => {
  it.each([
    ['not an object', 'হ্যালো'],
    ['unknown intent', { ...NULLS, intent: 'refund' }],
    ['items not a list', { ...NULLS, intent: 'sale', items: 'চাল' }],
    ['negative quantity', { ...NULLS, intent: 'sale', items: [line('চাল', -2, 'kg', null, null)] }],
    ['unknown unit', { ...NULLS, intent: 'sale', items: [line('চাল', 2, 'pound', null, null)] }],
    ['amount as text', { ...NULLS, intent: 'baki', customer: 'করিম', amount: '৩০০' }],
    ['credit as text', { ...NULLS, intent: 'sale', credit: 'yes' }],
  ])('rejects %s', (_, json) => {
    expect(() => convertGemini(json, names)).toThrow(GeminiOutputError);
  });
});

describe('convertGemini: sale', () => {
  it('maps an alias to the product, recomputes the total from a per-unit price', () => {
    const { parsed, transcript } = convertGemini(
      { transcript: 'চাউল ৩ কেজি ৬০ টাকা করে', intent: 'sale', ...NULLS, amount: 1000, items: [line('চাউল', 3, 'kg', 60, 999)] },
      names,
    );
    expect(transcript).toBe('চাউল ৩ কেজি ৬০ টাকা করে');
    expect(parsed).toMatchObject({
      intent: 'sale',
      product: 'চাল',
      quantity: { value: 3, unit: 'kg' },
      amount: 180,
      items: [{ product: 'চাল', quantity: { value: 3, unit: 'kg' }, unitPrice: 60, priceUnit: 'kg', total: 180, priceKind: 'unit' }],
      missing: [],
      confidence: 'high',
      raw: 'চাউল ৩ কেজি ৬০ টাকা করে',
    });
  });

  it('a spoken line total gives the per-unit price; the basket amount is the sum of lines', () => {
    const { parsed } = convertGemini(
      {
        ...NULLS, intent: 'sale', customer: 'করিম', credit: true, amount: 5,
        items: [line('চাল', 2, 'kg', null, 200), line('তেল', 1, 'litre', null, 190)],
      },
      names,
    );
    expect(parsed.amount).toBe(390);
    expect(parsed.credit).toBe(true);
    expect(parsed.customer).toBe('করিম');
    expect(parsed.product).toBeUndefined();
    expect(parsed.items![0]).toEqual({ product: 'চাল', quantity: { value: 2, unit: 'kg' }, total: 200, unitPrice: 100, priceUnit: 'kg', priceKind: 'total' });
  });

  it('no price said: no amount, nothing invented', () => {
    const { parsed } = convertGemini({ ...NULLS, intent: 'sale', items: [line('ডিম', 6, 'piece', null, null), line('চাল', 1, 'kg', null, 60)] }, names);
    expect(parsed.amount).toBeUndefined();
    expect(parsed.items![0]).toEqual({ product: 'ডিম', quantity: { value: 6, unit: 'piece' } });
  });

  it('unit "none" = no unit; "১০০ টাকার চিনি" has no quantity', () => {
    const { parsed } = convertGemini({ ...NULLS, intent: 'sale', items: [line('ডিম', 4, 'none', null, null)] }, names);
    expect(parsed.items![0]!.quantity).toEqual({ value: 4 });
    const money = convertGemini({ ...NULLS, intent: 'sale', items: [line('চাল', null, 'none', null, 100)] }, names).parsed;
    expect(money.items![0]).toEqual({ product: 'চাল', total: 100, priceKind: 'total' });
    expect(money.missing).toEqual([]);
  });

  it('a product in neither the list nor the aliases is kept as spoken and marked low', () => {
    const { parsed } = convertGemini({ ...NULLS, intent: 'sale', items: [line('মসুর ডাল', 1, 'kg', null, null)] }, names);
    expect(parsed.product).toBe('মসুর ডাল');
    expect(parsed).toMatchObject({ confidence: 'low', lowReasons: ['unmatched_product'] });
  });

  it('missing fields like the rule parser: credit without a name, a line without product', () => {
    const { parsed } = convertGemini({ ...NULLS, intent: 'sale', credit: true, items: [line(null, 2, 'kg', null, null)] }, names);
    expect(parsed.missing).toEqual(['product', 'customer']);
  });
});

describe('convertGemini: other intents', () => {
  it('baki / joma: customer and amount, no items', () => {
    expect(convertGemini({ ...NULLS, intent: 'baki', customer: 'মিনা', amount: 300 }, names).parsed).toMatchObject({
      intent: 'baki', customer: 'মিনা', amount: 300, missing: [],
    });
    expect(convertGemini({ ...NULLS, intent: 'joma', amount: 300 }, names).parsed.missing).toEqual(['customer']);
  });

  it('expense and owner_withdrawal', () => {
    expect(convertGemini({ ...NULLS, intent: 'expense', item: 'বিদ্যুৎ বিল', amount: 500 }, names).parsed).toMatchObject({
      intent: 'expense', item: 'বিদ্যুৎ বিল', amount: 500, missing: [],
    });
    expect(convertGemini({ ...NULLS, intent: 'owner_withdrawal', person: 'আব্বু', amount: 1000, note: 'বাসার জন্য' }, names).parsed).toMatchObject({
      intent: 'owner_withdrawal', person: 'আব্বু', amount: 1000, note: 'বাসার জন্য',
    });
  });

  it('purchase: top-level product, quantity, buy/sell price, new product', () => {
    const { parsed } = convertGemini(
      { ...NULLS, intent: 'purchase', product: 'চাউল', quantity: 50, unit: 'kg', buyPrice: 55, sellPrice: 60, isNewProduct: true },
      names,
    );
    expect(parsed).toMatchObject({ intent: 'purchase', product: 'চাল', quantity: { value: 50, unit: 'kg' }, buyPrice: 55, sellPrice: 60, isNewProduct: true, missing: [] });
    expect(parsed.items).toBeUndefined();
  });

  it('stock and balance questions', () => {
    expect(convertGemini({ ...NULLS, intent: 'stock_query', product: 'চাউল' }, names).parsed).toMatchObject({ intent: 'stock_query', product: 'চাল' });
    expect(convertGemini({ ...NULLS, intent: 'balance_query', customer: 'করিম' }, names).parsed).toMatchObject({ intent: 'balance_query', customer: 'করিম', missing: [] });
    expect(convertGemini({ ...NULLS, intent: 'total_baki_query' }, names).parsed).toMatchObject({ intent: 'total_baki_query', missing: [], confidence: 'high' });
    // a balance question with no name = all customers, like the rule parser
    expect(convertGemini({ ...NULLS, intent: 'balance_query' }, names).parsed).toMatchObject({ intent: 'total_baki_query', missing: [] });
  });

  it('unknown is low confidence', () => {
    expect(convertGemini({ ...NULLS, intent: 'unknown', transcript: '' }, names).parsed).toMatchObject({
      intent: 'unknown', confidence: 'low', lowReasons: ['unknown_intent'], raw: '',
    });
  });
});

describe('convertGemini: customer aliases', () => {
  it('a learned spelling of a customer comes back as the customer', () => {
    const withAliases = { ...names, customerAliases: { কোরিম: 'করিম' } };
    expect(convertGemini({ ...NULLS, intent: 'baki', customer: 'কোরিম', amount: 300 }, withAliases).parsed.customer).toBe('করিম');
    expect(convertGemini({ ...NULLS, intent: 'sale', customer: 'কোরিম', credit: true, items: [line('চাল', 1, 'kg', null, 60)] }, withAliases).parsed.customer).toBe('করিম');
    expect(convertGemini({ ...NULLS, intent: 'baki', customer: 'রহিম', amount: 300 }, withAliases).parsed.customer).toBe('রহিম');
  });
});
