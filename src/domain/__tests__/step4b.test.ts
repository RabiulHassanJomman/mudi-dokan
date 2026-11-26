/**
 * Build step 4b (pure TS): one quantity format (½), stock words and low-stock,
 * closest products (fuzzy + aliases), the home list for every entry type,
 * a customer on a cash sale, choosing a product adds the spoken name as an alias,
 * and what the confirm card says it got (শুনেছি / লিখেছি / বেছে নিয়েছি).
 */
import { formatQty, spokenQty } from '../../lib/bn';
import { parseCommand } from '../../parser';
import {
  basketFromParse,
  basketSummary,
  canSave,
  chooseProduct,
  readback,
  withCustomer,
  type ProductInfo,
} from '../basket';
import { heardPrefix } from '../confirmWords';
import { balanceWords, genitive, historyWords, owedList, totalBakiWords } from '../customers';
import { choosePurchaseProduct, entryFromParse, entryReadback } from '../entry';
import { padDisplay } from '../numpad';
import { pickText, pickWords } from '../pick';
import { suggestProducts } from '../products';
import { recentLine, type RecentEntry } from '../recent';
import { allStockList, allStockWords, LOW_STOCK, stockScreenWords, stockView, stockWords, type StockRow, type StockView } from '../stock';

const P = (name: string, unit: ProductInfo['unit'], sell: number | null, id = `id-${name}`): ProductInfo => ({
  id,
  name,
  unit,
  sellPricePoisha: sell,
  costPricePoisha: null,
});

describe('one quantity format: ½ on screen, words in speech', () => {
  it('screen: halves as ½, like the number pad', () => {
    expect(formatQty(2.5, 'kg')).toBe('২½ কেজি');
    expect(formatQty(0.5, 'kg')).toBe('½ কেজি');
    expect(formatQty(12.5, 'litre')).toBe('১২½ লিটার');
    expect(formatQty(2, 'kg')).toBe('২ কেজি');
    expect(formatQty(0.25, 'kg')).toBe('০.২৫ কেজি');
    expect(formatQty(1500, 'g')).toBe('১,৫০০ গ্রাম');
    // the pad and the quantity agree
    expect(padDisplay('2.5')).toBe('২½');
  });
  it('Pick: the button and the log text use the same format', () => {
    expect(pickText({ product: 'চাল', value: 2.5, mode: 'kg' })).toBe('চাল ২½ কেজি');
    expect(pickText({ product: 'চাল', value: 0.5, mode: 'kg' })).toBe('চাল ½ কেজি');
    expect(pickText({ product: 'চিনি', value: 100, mode: 'taka' })).toBe('১০০ টাকার চিনি');
  });
  it('speech: আধা / দেড় / আড়াই / সাড়ে', () => {
    expect(spokenQty(0.5, 'kg')).toBe('আধা কেজি');
    expect(spokenQty(1.5, 'kg')).toBe('দেড় কেজি');
    expect(spokenQty(2.5, 'kg')).toBe('আড়াই কেজি');
    expect(spokenQty(3.5, 'litre')).toBe('সাড়ে ৩ লিটার');
    expect(spokenQty(2, 'piece')).toBe('২ পিস');
    expect(spokenQty(0.25, 'kg')).toBe('০.২৫ কেজি');
    expect(pickWords({ product: 'চাল', value: 2.5, mode: 'kg' })).toBe('চাল আড়াই কেজি');
  });
  it('the confirm readback speaks the words', () => {
    const b = basketFromParse(parseCommand('চাল আড়াই কেজি', { tab: 'sale' }), new Map([['চাল', P('চাল', 'kg', 6000)]]));
    expect(readback(b)).toBe('চাল আড়াই কেজি, ১৫০ টাকা। ঠিক আছে?');
  });
});

describe('stock (মাল)', () => {
  const row = (over: Partial<StockRow>): StockRow => ({
    id: 'p1',
    spentPoisha: 0,
    name: 'চাল',
    unit: 'kg',
    sellPricePoisha: 6000,
    costPricePoisha: 5500,
    bought: 50,
    sold: 8,
    purchases: 1,
    ...over,
  });

  it('stock = bought − sold', () => {
    expect(stockView(row({}))).toMatchObject({ stock: 42, low: false, known: true });
  });
  it('low at or under the unit threshold, and when nothing is left', () => {
    expect(stockView(row({ bought: 50, sold: 50 - LOW_STOCK.kg })).low).toBe(true);
    expect(stockView(row({ bought: 50, sold: 49 - LOW_STOCK.kg })).low).toBe(false);
    expect(stockView(row({ bought: 10, sold: 12 }))).toMatchObject({ stock: -2, low: true });
    expect(stockView(row({ unit: 'piece', bought: 24, sold: 20 })).low).toBe(true);
  });
  it('never bought (only sold so far): stock is unknown, not low', () => {
    expect(stockView(row({ bought: 0, sold: 5, purchases: 0 }))).toMatchObject({ stock: null, known: false, low: false });
  });

  it('words: stock and selling price', () => {
    expect(stockWords(stockView(row({})))).toBe('চাল ৪২ কেজি আছে। বেচা দাম কেজি ৬০ টাকা।');
    expect(stockWords(stockView(row({ bought: 4.5, sold: 0 })))).toBe('চাল আছে মাত্র সাড়ে ৪ কেজি, কম। বেচা দাম কেজি ৬০ টাকা।');
    expect(stockWords(stockView(row({ bought: 5, sold: 5 })))).toBe('চাল শেষ, আর নেই। বেচা দাম কেজি ৬০ টাকা।');
    expect(stockWords(stockView(row({ bought: 0, sold: 3, purchases: 0, sellPricePoisha: null })))).toBe(
      'চাল কেনার হিসাব নেই। নতুন মাল বলে কেনা লিখুন।',
    );
  });
  it('screen words: count, low ones by name', () => {
    const list = [
      stockView(row({})),
      stockView(row({ id: 'p2', name: 'তেল', unit: 'litre', bought: 5, sold: 3 })),
    ];
    expect(stockScreenWords(list)).toBe('মাল পাতা। ২টি মাল। কম আছে: তেল। কোনো মালে চাপলে শুনবেন। নতুন মাল বলতে নিচের বোতাম চাপুন।');
    expect(stockScreenWords([])).toBe('মাল পাতা। এখনো কোনো মাল নেই। নতুন মাল বলতে নিচের বোতাম চাপুন।');
  });
});

describe('closest products (fuzzy + aliases)', () => {
  const list = [
    { name: 'চাল', aliases: [] },
    { name: 'পেঁয়াজ', aliases: ['পিয়াজ'] },
    { name: 'তেল', aliases: ['সয়াবিন'] },
    { name: 'চিনি', aliases: [] },
    { name: 'ডাল', aliases: [] },
  ];
  it.each([
    ['চাউল', ['চাল']],
    ['পিঁয়াজ', ['পেঁয়াজ']], // close to the alias পিয়াজ and the name
    ['সয়াবিন তেল', ['তেল']], // a known word inside
    ['চিনী', ['চিনি']],
  ])('%s → %j', (spoken, want) => expect(suggestProducts(spoken, list).map((p) => p.name)).toEqual(want));

  it('nothing close: nothing offered', () => {
    expect(suggestProducts('ম্যাচ', list)).toEqual([]);
    expect(suggestProducts('', list)).toEqual([]);
  });
  it('at most n, best first', () => {
    const many = [{ name: 'ডাল', aliases: [] }, { name: 'চাল', aliases: [] }, { name: 'চালা', aliases: [] }];
    expect(suggestProducts('চাল্', many, 2).map((p) => p.name)).toEqual(['চাল', 'চালা']);
  });
});

describe('basket: a customer on a cash sale', () => {
  const catalog = new Map([['চাল', P('চাল', 'kg', 6000)]]);
  const ctx = { tab: 'sale' as const, knownProducts: ['চাল'], knownCustomers: ['করিম'] };

  it('a known name is kept on a cash sale and read back', () => {
    const b = basketFromParse(parseCommand('করিম চাল ২ কেজি', ctx), catalog, ['করিম']);
    expect(b).toMatchObject({ credit: false, customerName: 'করিম', customerOk: true, problems: [] });
    expect(readback(b)).toBe('করিম, নগদ। চাল ২ কেজি, ১২০ টাকা। ঠিক আছে?');
    expect(basketSummary(b).customer).toBe('করিম');
  });
  it('an unknown name must be chosen (or cleared) before saving', () => {
    const b = basketFromParse(parseCommand('রহিম চাল ২ কেজি নিল', ctx), catalog, ['করিম']);
    expect(b.customerName).toBe('রহিম');
    expect(b.problems).toEqual(['customer_unknown']);
    expect(canSave(withCustomer(b, 'রহিম', true))).toBe(true);
    // cleared: a cash sale needs no customer
    expect(withCustomer(b, '', false)).toMatchObject({ customerName: null, problems: [] });
  });
});

describe('choosing a suggested product adds the spoken name as an alias', () => {
  const chal = P('চাল', 'kg', 6000);

  it('sale line: product set, price from the DB, alias = what was heard', () => {
    const b = basketFromParse(parseCommand('চাউল ২ কেজি', { tab: 'sale' }), new Map());
    expect(b.items[0]).toMatchObject({ productName: 'চাউল', product: null });
    const c = chooseProduct(b, b.items[0]!.key, chal);
    expect(c.items[0]).toMatchObject({ productName: 'চাল', product: chal, quantity: 2, pricePoisha: 6000, amountPoisha: 12000, alias: 'চাউল' });
    expect(basketSummary(c).items[0]).toMatchObject({ product: 'চাল', alias: 'চাউল' });
    expect(canSave(c)).toBe(true);
  });
  it('a spoken quantity in another unit is converted like any line', () => {
    const b = basketFromParse(parseCommand('চাউল ৫০০ গ্রাম', { tab: 'sale' }), new Map());
    expect(chooseProduct(b, b.items[0]!.key, chal).items[0]).toMatchObject({ quantity: 0.5, unit: 'kg', amountPoisha: 3000 });
  });
  it('purchase: same, the quantity stays', () => {
    const e = entryFromParse(parseCommand('চাউল ১০ কেজি কিনলাম ৫০০ টাকা'), { products: new Map(), knownCustomers: [] })!;
    const c = choosePurchaseProduct(e, chal);
    expect(c.purchase).toMatchObject({ productName: 'চাল', product: chal, quantity: 10, buyPricePoisha: 5000, alias: 'চাউল', unitWarning: false });
    expect(entryReadback(c)).toBe('কেনা: চাল ১০ কেজি, কেজি ৫০ টাকা, মোট ৫০০ টাকা। ঠিক আছে?');
  });
});

describe('home: recent entries of every type', () => {
  const base: RecentEntry = {
    kind: 'sale', id: 'x', title: 'চাল', lines: 1, quantity: 2, unit: 'kg', amount_poisha: 12000,
    credit: 0, customer: null, audio_path: null, created_at: 1,
  };
  it.each([
    [{}, { title: 'চাল', detail: '২ কেজি', badge: null, words: 'বিক্রি: চাল ২ কেজি, ১২০ টাকা।' }],
    [{ customer: 'করিম', credit: 1 }, { title: 'চাল · করিম', badge: 'বাকি', words: 'বিক্রি: চাল ২ কেজি, করিম, বাকিতে, ১২০ টাকা।' }],
    [{ title: 'চাল, ডাল', lines: 2 }, { detail: '২টি জিনিস', words: 'বিক্রি: চাল, ডাল, ১২০ টাকা।' }],
    [{ kind: 'baki', title: 'করিম', lines: 0 }, { title: 'করিম', detail: 'বাকি', badge: 'বাকি', words: 'করিম বাকি ১২০ টাকা।' }],
    [{ kind: 'joma', title: 'করিম', lines: 0 }, { detail: 'জমা দিল', badge: 'জমা', words: 'করিম জমা দিল ১২০ টাকা।' }],
    [{ kind: 'expense', title: 'বিদ্যুৎ বিল', lines: 0 }, { detail: 'খরচ', badge: 'খরচ', words: 'খরচ: বিদ্যুৎ বিল, ১২০ টাকা।' }],
    [{ kind: 'owner_withdrawal', title: 'আব্বু', lines: 0 }, { detail: 'মালিক নিল', words: 'আব্বু নিল ১২০ টাকা।' }],
    [{ kind: 'purchase', quantity: 50 }, { title: 'চাল', detail: 'কেনা · ৫০ কেজি', badge: 'কেনা', words: 'কেনা: চাল ৫০ কেজি, ১২০ টাকা।' }],
  ] as const)('%j', (over, want) => expect(recentLine({ ...base, ...over } as RecentEntry)).toMatchObject(want));
});

describe('balance words (বাকি খাতা, "করিমের বাকি কত?")', () => {
  it.each([
    [230000, 'করিম, পাবো ২,৩০০ টাকা।'],
    [-5000, 'করিম, অগ্রিম দিয়েছে ৫০ টাকা।'],
    [0, 'করিম, কোনো বাকি নেই।'],
  ])('%d', (p, s) => expect(balanceWords('করিম', p)).toBe(s));
});

describe('মোট বাকি: list + total, no names read aloud', () => {
  const r = (id: string, taka: number) => ({ id, name: id, balance_poisha: taka * 100 });
  const rows = [r('সুমি', 500), r('করিম', 2300), r('হাসান', -50), r('রহিম', 1200), r('জামাল', 0), r('মিনা', 150)];

  it('lists only who owes, largest first', () => {
    expect(owedList(rows).map((c) => c.name)).toEqual(['করিম', 'রহিম', 'সুমি', 'মিনা']);
  });
  it('says total and how many', () => {
    expect(totalBakiWords(rows)).toBe('মোট বাকি ৪,১৫০ টাকা, ৪ জনের কাছে।');
    expect(totalBakiWords([r('করিম', 250.5)])).toBe('মোট বাকি ২৫০.৫ টাকা, ১ জনের কাছে।');
  });
  it('nobody owes', () => {
    expect(owedList([r('করিম', 0), r('রহিম', -100)])).toEqual([]);
    expect(totalBakiWords([])).toBe('কারো কাছে কোনো বাকি নেই।');
    expect(totalBakiWords([r('করিম', 0), r('রহিম', -100)])).toBe('কারো কাছে কোনো বাকি নেই।');
  });
});

describe('সব মাল: low first, short TTS', () => {
  const v = (name: string, stock: number | null, low = false): StockView => ({
    id: name, name, unit: 'kg', sellPricePoisha: 6000, costPricePoisha: 5500, stock, known: stock !== null, low, spentPoisha: 0,
  });

  it('low-stock first, otherwise order kept', () => {
    const list = [v('আটা', 20), v('চাল', 2, true), v('ডিম', null), v('ডাল', 0, true), v('তেল', 30)];
    expect(allStockList(list).map((x) => x.name)).toEqual(['চাল', 'ডাল', 'আটা', 'ডিম', 'তেল']);
  });
  it('count + low names, at most 5', () => {
    const list = ['ক', 'খ', 'গ', 'ঘ', 'ঙ', 'চ'].map((n) => v(n, 1, true)).concat([v('আটা', 20)]);
    expect(allStockWords(list)).toBe('মোট ৭ রকম মাল। কম আছে: ক, খ, গ, ঘ, ঙ।');
    expect(allStockWords([v('আটা', 20), v('চাল', 2, true)])).toBe('মোট ২ রকম মাল। কম আছে: চাল।');
  });
  it('nothing low / nothing at all', () => {
    expect(allStockWords([v('আটা', 20)])).toBe('মোট ১ রকম মাল।');
    expect(allStockWords([])).toBe('এখনো কোনো মাল নেই।');
  });
});

describe('ক্রেতার হিসাব by voice: balance + last 3', () => {
  const now = new Date(2026, 10, 14, 18).getTime();
  const day = (d: number) => new Date(2026, 10, d, 10).getTime();
  const L = (kind: 'baki' | 'joma', taka: number, d: number, products: string | null = null) => ({
    kind, amount_poisha: taka * 100, created_at: day(d), products,
  });

  it('genitive', () => {
    expect(genitive('করিম')).toBe('করিমের');
    expect(genitive('সুমি')).toBe('সুমির');
    expect(genitive('রাজা')).toBe('রাজার');
    expect(genitive('Rahim')).toBe('Rahim এর');
  });
  it('owes, newest 3 of more', () => {
    const rows = [L('baki', 500, 14, 'চাল, ডাল'), L('joma', 300, 13), L('baki', 200, 11), L('baki', 900, 2)];
    expect(historyWords('করিম', 230000, rows, now)).toBe(
      'করিমের মোট বাকি ২,৩০০ টাকা। শেষ তিনটা: আজ চাল, ডাল বাকি ৫০০ টাকা; গতকাল জমা ৩০০ টাকা; ১১ নভে বাকি ২০০ টাকা।',
    );
  });
  it('fewer entries, advance, nothing', () => {
    expect(historyWords('সুমি', -5000, [L('joma', 50, 14)], now)).toBe('সুমি অগ্রিম দিয়েছে ৫০ টাকা। শেষটা: আজ জমা ৫০ টাকা।');
    expect(historyWords('সুমি', 0, [L('baki', 50, 14), L('joma', 50, 14)], now)).toBe(
      'সুমির কোনো বাকি নেই। শেষ দুইটা: আজ বাকি ৫০ টাকা; আজ জমা ৫০ টাকা।',
    );
    expect(historyWords('করিম', 0, [], now)).toBe('করিমের কোনো বাকি নেই। এখনো কোনো হিসাব নেই।');
  });
});

describe('what the confirm card says it got', () => {
  it.each([
    ['voice', 'শুনেছি'],
    ['typed', 'লিখেছি'],
    ['pick', 'বেছে নিয়েছি'],
  ] as const)('%s → %s', (how, s) => expect(heardPrefix(how)).toBe(s));
});
