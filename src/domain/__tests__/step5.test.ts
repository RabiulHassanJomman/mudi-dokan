/** Build step 5 domain: History rows, fix drafts, renaming on the confirm card. */
import { basketFromParse, renameItem, type ProductInfo } from '../basket';
import { entryFromParse, renamePurchaseProduct } from '../entry';
import { basketFromStored, entryFromStored, type StoredSaleLine } from '../fix';
import { buildHistory, historyLine, historyWords, matchesFilter, type RawEntry } from '../history';
import { parseCommand } from '../../parser';

const T = 1_763_100_000_000;
const raw = (r: Partial<RawEntry> & Pick<RawEntry, 'table' | 'id'>): RawEntry => ({
  corrects_id: null,
  voided: 0,
  at: T,
  created_at: T,
  kind: null,
  basket_id: null,
  line_no: null,
  sale_id: null,
  title: 'চাল',
  quantity: null,
  unit: null,
  amount_poisha: 0,
  credit: 0,
  customer: null,
  audio_path: null,
  ...r,
});

const CHAL: ProductInfo = { id: 'p1', name: 'চাল', unit: 'kg', sellPricePoisha: 6000, costPricePoisha: 5500 };
const DAL: ProductInfo = { id: 'p2', name: 'ডাল', unit: 'kg', sellPricePoisha: 11000, costPricePoisha: 9500 };

describe('buildHistory', () => {
  it('one row per basket, newest first; a credit sale’s baki row is not shown alone', () => {
    const items = buildHistory([
      raw({ table: 'sales', id: 's1', basket_id: 'b1', line_no: 1, title: 'চাল', quantity: 2, unit: 'kg', amount_poisha: 12000, at: T }),
      raw({ table: 'sales', id: 's2', basket_id: 'b2', line_no: 1, title: 'চাল', quantity: 1, unit: 'kg', amount_poisha: 6000, credit: 1, customer: 'করিম', at: T + 10 }),
      raw({ table: 'sales', id: 's3', basket_id: 'b2', line_no: 2, title: 'ডাল', quantity: 1, unit: 'kg', amount_poisha: 11000, credit: 1, customer: 'করিম', at: T + 10 }),
      raw({ table: 'ledger', id: 'l1', kind: 'baki', basket_id: 'b2', title: 'করিম', amount_poisha: 17000, at: T + 10 }),
      raw({ table: 'ledger', id: 'l2', kind: 'joma', title: 'রহিম', amount_poisha: 50000, at: T + 20 }),
      raw({ table: 'expenses', id: 'e1', title: 'বিদ্যুৎ বিল', amount_poisha: 50000, at: T + 30 }),
    ]);
    expect(items.map((i) => [i.kind, i.id, i.title, i.amount_poisha])).toEqual([
      ['expense', 'e1', 'বিদ্যুৎ বিল', 50000],
      ['joma', 'l2', 'রহিম', 50000],
      ['sale', 'b2', 'চাল, ডাল', 17000],
      ['sale', 'b1', 'চাল', 12000],
    ]);
    expect(items[2]).toMatchObject({ lines: 2, credit: 1, customer: 'করিম', fixed: false, voided: false });
  });

  it('a fixed line: latest values, the first version kept as old ("~~৩ কেজি~~ → ১ কেজি")', () => {
    const [d] = buildHistory([
      raw({ table: 'sales', id: 's1', basket_id: 'b1', line_no: 1, title: 'ডাল', quantity: 3, unit: 'kg', amount_poisha: 33000 }),
      raw({ table: 'sales', id: 's1b', corrects_id: 's1', basket_id: 'b1', line_no: 1, title: 'ডাল', quantity: 2, unit: 'kg', amount_poisha: 22000, created_at: T + 50 }),
      raw({ table: 'sales', id: 's1c', corrects_id: 's1b', basket_id: 'b1', line_no: 1, title: 'ডাল', quantity: 1, unit: 'kg', amount_poisha: 11000, created_at: T + 90 }),
    ]);
    expect(d).toMatchObject({ id: 'b1', quantity: 1, amount_poisha: 11000, fixed: true, oldQuantity: 3, oldAmountPoisha: 33000, created_at: T });
    expect(historyLine(d!)).toMatchObject({ old: '৩ কেজি', now: '১ কেজি' });
    expect(historyLine(d!).words).toBe('বিক্রি: ডাল ১ কেজি, ১১০ টাকা। আগে ছিল ৩ কেজি।');
  });

  it('a fixed amount (quantity same) shows the old taka', () => {
    const [e] = buildHistory([
      raw({ table: 'expenses', id: 'e1', title: 'বিল', amount_poisha: 50000 }),
      raw({ table: 'expenses', id: 'e2', corrects_id: 'e1', title: 'বিল', amount_poisha: 45000 }),
    ]);
    expect(e).toMatchObject({ id: 'e2', fixed: true, oldAmountPoisha: 50000 });
    expect(historyLine(e!)).toMatchObject({ old: '৳ ৫০০', now: '৳ ৪৫০' });
    expect(historyLine(e!).words).toBe('খরচ: বিল, ৪৫০ টাকা। আগে ছিল ৫০০ টাকা।');
  });

  it('an undone entry is struck (voided), with its old values and a বাতিল badge', () => {
    const items = buildHistory([
      raw({ table: 'sales', id: 's1', basket_id: 'b1', line_no: 1, title: 'চাল', quantity: 2, unit: 'kg', amount_poisha: 12000 }),
      raw({ table: 'sales', id: 's1x', corrects_id: 's1', voided: 1, basket_id: 'b1', line_no: 1, title: 'চাল', quantity: 2, unit: 'kg', amount_poisha: 12000 }),
      raw({ table: 'owner_withdrawals', id: 'o1', title: 'মালিক', amount_poisha: 30000 }),
      raw({ table: 'owner_withdrawals', id: 'o1x', corrects_id: 'o1', voided: 1, title: 'মালিক', amount_poisha: 30000 }),
    ]);
    expect(items.map((i) => [i.id, i.voided, i.fixed, i.amount_poisha])).toEqual([
      ['b1', true, false, 12000],
      ['o1x', true, false, 30000],
    ]);
    expect(historyLine(items[0]!)).toMatchObject({ badge: 'বাতিল', old: null });
  });

  it('a removed basket line: the basket total drops, the rest stays', () => {
    const [b] = buildHistory([
      raw({ table: 'sales', id: 's1', basket_id: 'b1', line_no: 1, title: 'চাল', quantity: 2, unit: 'kg', amount_poisha: 12000 }),
      raw({ table: 'sales', id: 's2', basket_id: 'b1', line_no: 2, title: 'ডাল', quantity: 1, unit: 'kg', amount_poisha: 11000 }),
      raw({ table: 'sales', id: 's2x', corrects_id: 's2', voided: 1, basket_id: 'b1', line_no: 2, title: 'ডাল', quantity: 1, unit: 'kg', amount_poisha: 11000 }),
    ]);
    expect(b).toMatchObject({ title: 'চাল', lines: 1, quantity: 2, amount_poisha: 12000, fixed: true, oldAmountPoisha: 23000, voided: false });
  });

  it('filters: বিক্রি, বাকি (incl. credit sales), খরচ (incl. মালিক নিল, কেনা)', () => {
    const items = buildHistory([
      raw({ table: 'sales', id: 's1', basket_id: 'b1', amount_poisha: 1 }),
      raw({ table: 'sales', id: 's2', basket_id: 'b2', amount_poisha: 1, credit: 1, customer: 'করিম' }),
      raw({ table: 'ledger', id: 'l1', kind: 'joma', title: 'রহিম', amount_poisha: 1 }),
      raw({ table: 'expenses', id: 'e1', title: 'বিল', amount_poisha: 1 }),
      raw({ table: 'owner_withdrawals', id: 'o1', title: 'মালিক', amount_poisha: 1 }),
      raw({ table: 'purchases', id: 'p1', title: 'চাল', quantity: 50, unit: 'kg', amount_poisha: 1 }),
    ]);
    const ids = (f: Parameters<typeof matchesFilter>[1]) => items.filter((i) => matchesFilter(i, f)).map((i) => i.id).sort();
    expect(ids('all')).toHaveLength(6);
    expect(ids('sale')).toEqual(['b1', 'b2']);
    expect(ids('baki')).toEqual(['b2', 'l1']);
    expect(ids('expense')).toEqual(['e1', 'o1', 'p1']);
  });

  it('TTS', () => {
    expect(historyWords([], 'আজকের খাতা')).toBe('আজকের খাতা। কোনো লেখা নেই।');
    const items = buildHistory([raw({ table: 'sales', id: 's1', basket_id: 'b1', amount_poisha: 12000 })]);
    expect(historyWords(items, 'আজকের খাতা')).toBe('আজকের খাতা। ১টি লেখা। বিক্রি ১২০ টাকা। শুনতে প্লে চাপুন, ঠিক করতে কলম চাপুন।');
  });
});

describe('fix: saved entry → the confirm card draft', () => {
  const line = (l: Partial<StoredSaleLine> & Pick<StoredSaleLine, 'id'>): StoredSaleLine => ({
    line_no: 1, product: CHAL, quantity: 2, sell_price_poisha: 6000, amount_poisha: 12000, cost_price_poisha: 5200, cost_known: 1, credit: 0, customer: null, ...l,
  });

  it('a basket: lines keyed by row id, in line order, ready to save', () => {
    const b = basketFromStored(
      [line({ id: 's2', line_no: 2, product: DAL, quantity: 1, sell_price_poisha: 11000, amount_poisha: 11000, credit: 1, customer: 'করিম' }), line({ id: 's1', credit: 1, customer: 'করিম' })],
      ['করিম'],
    );
    expect(b.items.map((i) => [i.key, i.productName, i.quantity, i.amountPoisha])).toEqual([
      ['s1', 'চাল', 2, 12000],
      ['s2', 'ডাল', 1, 11000],
    ]);
    expect(b).toMatchObject({ credit: true, customerName: 'করিম', customerOk: true, totalPoisha: 23000, problems: [] });
    // the line's own cost at sale time is kept
    expect(b.items[0]!.product!.costPricePoisha).toBe(5200);
  });

  it('a basket line with unknown cost uses the product’s cost (null if none)', () => {
    const b = basketFromStored([line({ id: 's1', cost_known: 0, cost_price_poisha: 0, product: { ...CHAL, costPricePoisha: null } })], []);
    expect(b.items[0]!.product!.costPricePoisha).toBeNull();
  });

  it('entries', () => {
    expect(entryFromStored({ table: 'ledger', id: 'l1', kind: 'joma', customer: 'রহিম', amount_poisha: 50000, item: null, person: null, note: null, product: null, quantity: null, spoken_unit: null, buy_price_poisha: null, sell_price_poisha: null })).toMatchObject({
      kind: 'joma', customerName: 'রহিম', customerOk: true, amountPoisha: 50000, problems: [],
    });
    expect(entryFromStored({ table: 'purchases', id: 'p1', kind: null, customer: null, amount_poisha: 275000, item: null, person: null, note: null, product: CHAL, quantity: 50, spoken_unit: null, buy_price_poisha: 5500, sell_price_poisha: null })).toMatchObject({
      kind: 'purchase', amountPoisha: 275000, purchase: { productName: 'চাল', quantity: 50, unit: 'kg', buyPricePoisha: 5500, unitWarning: false },
    });
  });
});

describe('a new name typed or said on the confirm card (4b gap)', () => {
  const products = new Map([['চাল', CHAL]]);
  it('sale line: a new product keeps quantity and price', () => {
    const b = basketFromParse(parseCommand('চিনিগুড়া ২ কেজি ২০০ টাকা', { tab: 'sale', knownProducts: ['চাল'] }), products, []);
    const r = renameItem(b, b.items[0]!.key, '  চিনিগুঁড়া চাল ', null);
    expect(r.items[0]).toMatchObject({ productName: 'চিনিগুঁড়া চাল', product: null, quantity: 2, amountPoisha: 20000, alias: null, problems: [] });
    expect(renameItem(b, b.items[0]!.key, '  ', null)).toBe(b);
  });
  it('sale line: a known name is chosen (the heard one becomes an alias)', () => {
    const b = basketFromParse(parseCommand('চাউল ২ কেজি', { tab: 'sale' }), new Map(), []);
    const r = renameItem(b, b.items[0]!.key, 'চাল', CHAL);
    expect(r.items[0]).toMatchObject({ productName: 'চাল', product: CHAL, quantity: 2, amountPoisha: 12000, alias: 'চাউল' });
  });
  it('purchase: new or known product', () => {
    const d = entryFromParse(parseCommand('মিনিকেট ৫০ কেজি কিনলাম ৫৫ টাকা করে', { tab: 'purchase' }), { products: new Map(), knownCustomers: [] })!;
    expect(renamePurchaseProduct(d, 'মিনিকেট চাল', null).purchase).toMatchObject({ productName: 'মিনিকেট চাল', product: null, quantity: 50 });
    expect(renamePurchaseProduct(d, 'চাল', CHAL).purchase).toMatchObject({ productName: 'চাল', product: CHAL, alias: 'মিনিকেট' });
  });
  it('the খরচ voice fallback (nothing heard) is an empty expense card', () => {
    expect(entryFromParse(parseCommand('', { tab: 'expense' }), { products: new Map(), knownCustomers: [], tab: 'expense' })).toMatchObject({
      kind: 'expense', problems: ['no_amount', 'no_item'],
    });
  });
});
