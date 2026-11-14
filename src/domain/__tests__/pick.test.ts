import { basketFromParse, type ProductInfo } from '../basket';
import { filterProducts, halfAllowed, pickUnits, pickedCommand, pickText, type PickProduct } from '../pick';

const chal: ProductInfo = { id: 'p1', name: 'চাল', unit: 'kg', sellPricePoisha: 6000, costPricePoisha: 5500 };

describe('unit chips', () => {
  it('per product unit, always with টাকার', () => {
    expect(pickUnits('kg')).toEqual(['kg', 'g', 'taka']);
    expect(pickUnits('litre')).toEqual(['litre', 'ml', 'taka']);
    expect(pickUnits('piece')).toEqual(['piece', 'dozen', 'taka']);
    expect(pickUnits('packet')).toEqual(['packet', 'taka']);
    expect(pickUnits('dozen')).toEqual(['dozen', 'piece', 'taka']);
  });
  it('no product yet (or a new one): কেজি / গ্রাম / টাকার', () => {
    expect(pickUnits(null)).toEqual(['kg', 'g', 'taka']);
  });
  it('½ only for units that come in halves', () => {
    expect(halfAllowed('kg')).toBe(true);
    expect(halfAllowed('litre')).toBe(true);
    expect(halfAllowed('dozen')).toBe(true);
    expect(halfAllowed('g')).toBe(false);
    expect(halfAllowed('piece')).toBe(false);
    expect(halfAllowed('taka')).toBe(false);
  });
});

describe('purchase (Pick from the মাল কেনা tab)', () => {
  it('no টাকার chip; a new product also offers লিটার / পিস', () => {
    expect(pickUnits('kg', true)).toEqual(['kg', 'g']);
    expect(pickUnits(null, true)).toEqual(['kg', 'g', 'litre', 'piece']);
  });
  it('quantity + total paid → purchase command (the card works out the buy price)', () => {
    const item = { product: 'চাল', value: 50, mode: 'kg' as const, purchase: { totalTaka: 2750 } };
    expect(pickText(item)).toBe('চাল ৫০ কেজি কেনা ৳ ২,৭৫০');
    expect(pickedCommand(item)).toMatchObject({ intent: 'purchase', product: 'চাল', quantity: { value: 50, unit: 'kg' }, amount: 2750, missing: [] });
  });
  it('no price typed: the card asks for it', () => {
    const item = { product: 'চাল', value: 50, mode: 'kg' as const, purchase: { totalTaka: null } };
    expect(pickText(item)).toBe('চাল ৫০ কেজি কেনা');
    expect(pickedCommand(item)).toMatchObject({ intent: 'purchase', missing: ['buyPrice'] });
    expect(pickedCommand(item).amount).toBeUndefined();
  });
});

describe('pick → command for the confirm card', () => {
  it('quantity in a unit', () => {
    const p = pickedCommand({ product: 'চাল', value: 2.5, mode: 'kg' });
    expect(p).toMatchObject({
      intent: 'sale',
      confidence: 'high',
      missing: [],
      product: 'চাল',
      quantity: { value: 2.5, unit: 'kg' },
      items: [{ product: 'চাল', quantity: { value: 2.5, unit: 'kg' } }],
    });
    expect(p.amount).toBeUndefined();
    expect(p.raw).toBe('চাল ২½ কেজি');
  });

  it('টাকার: an amount, the confirm card works out the quantity', () => {
    const p = pickedCommand({ product: 'চিনি', value: 100, mode: 'taka' });
    expect(p).toMatchObject({ intent: 'sale', amount: 100, items: [{ product: 'চিনি', total: 100, priceKind: 'total' }] });
    expect(p.items![0]!.quantity).toBeUndefined();
    expect(p.raw).toBe('১০০ টাকার চিনি');
  });

  it('feeds the same basket as voice: stored price, quantity from টাকার', () => {
    const b1 = basketFromParse(pickedCommand({ product: 'চাল', value: 2, mode: 'kg' }), new Map([['চাল', chal]]));
    expect(b1.items[0]).toMatchObject({ quantity: 2, unit: 'kg', pricePoisha: 6000, amountPoisha: 12000, problems: [] });
    const b2 = basketFromParse(pickedCommand({ product: 'চাল', value: 120, mode: 'taka' }), new Map([['চাল', chal]]));
    expect(b2.items[0]).toMatchObject({ quantity: 2, amountPoisha: 12000 });
    const g = basketFromParse(pickedCommand({ product: 'চাল', value: 500, mode: 'g' }), new Map([['চাল', chal]]));
    expect(g.items[0]).toMatchObject({ quantity: 0.5, unit: 'kg', amountPoisha: 3000 });
  });

  it('readable text for the log and TTS', () => {
    expect(pickText({ product: 'ডিম', value: 1, mode: 'dozen' })).toBe('ডিম ১ ডজন');
    expect(pickText({ product: 'তেল', value: 500, mode: 'ml' })).toBe('তেল ৫০০ মিলি');
    expect(pickText({ product: 'চাল', value: 1500, mode: 'taka' })).toBe('১,৫০০ টাকার চাল');
  });
});

describe('product search', () => {
  const list: PickProduct[] = [
    { id: '1', name: 'চাল', unit: 'kg', sellPricePoisha: 6000, aliases: ['চাউল'] },
    { id: '2', name: 'মসুর ডাল', unit: 'kg', sellPricePoisha: 11000, aliases: [] },
    { id: '3', name: 'ডাল', unit: 'kg', sellPricePoisha: 10000, aliases: [] },
    { id: '4', name: 'পেঁয়াজ', unit: 'kg', sellPricePoisha: 8000, aliases: ['পিয়াজ'] },
  ];
  const names = (q: string) => filterProducts(list, q).map((p) => p.name);

  it('empty query: everything, in the given (most-sold) order', () => {
    expect(names('')).toEqual(['চাল', 'মসুর ডাল', 'ডাল', 'পেঁয়াজ']);
    expect(names('  ')).toEqual(['চাল', 'মসুর ডাল', 'ডাল', 'পেঁয়াজ']);
  });
  it('starts-with first, then contains', () => {
    expect(names('ডাল')).toEqual(['ডাল', 'মসুর ডাল']);
  });
  it('matches aliases', () => {
    expect(names('চাউ')).toEqual(['চাল']);
    expect(names('পিয়া')).toEqual(['পেঁয়াজ']);
  });
  it('no match → empty (the screen offers it as a new product)', () => {
    expect(names('নুডলস')).toEqual([]);
  });
});
