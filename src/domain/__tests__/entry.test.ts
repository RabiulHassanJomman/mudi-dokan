import { parseCommand } from '../../parser';
import type { ParseContext } from '../../parser/types';
import type { ProductInfo } from '../basket';
import {
  canSaveEntry,
  diffEntries,
  entryFromParse,
  entryReadback,
  entrySummary,
  setBuyPrice,
  setEntryAmount,
  setEntryItem,
  setSellPrice,
  stepPurchase,
  withEntryCustomer,
  withKind,
  type EntryContext,
} from '../entry';

const chal: ProductInfo = { id: 'p1', name: 'চাল', unit: 'kg', sellPricePoisha: 6000, costPricePoisha: 5000 };
const tel: ProductInfo = { id: 'p2', name: 'তেল', unit: 'litre', sellPricePoisha: 17000, costPricePoisha: null };
const known = ['করিম', 'রহিম', 'সালমা'];
const ectx: EntryContext = { products: new Map([['চাল', chal], ['তেল', tel]]), knownCustomers: known };

const draft = (text: string, tab: ParseContext['tab'] = 'sale', extra: Partial<EntryContext> = {}) => {
  const p = parseCommand(text, { tab, knownCustomers: known, knownProducts: ['চাল', 'তেল'], deviceName: 'আব্বু' });
  return entryFromParse(p, { ...ectx, tab, ...extra });
};

describe('which commands become an entry', () => {
  it('sales and questions are not entries', () => {
    expect(draft('চাল ২ কেজি')).toBeNull();
    expect(draft('করিম চাল ২ কেজি বাকিতে নিল')).toBeNull();
    expect(draft('চাল কত আছে')).toBeNull();
    expect(draft('আজ লাভ কত')).toBeNull();
  });
  it('gibberish on the sale tab is not; on the বাকি tab it is a ledger entry to fill in', () => {
    expect(draft('হুম')).toBeNull();
    expect(draft('হুম', 'ledger')).toMatchObject({ kind: null, problems: expect.arrayContaining(['no_kind']) });
  });
});

describe('baki / joma', () => {
  it('known customer: ready to save', () => {
    const d = draft('করিম ২০০ টাকা বাকি')!;
    expect(d).toMatchObject({ kind: 'baki', customerName: 'করিম', customerOk: true, amountPoisha: 20000, problems: [] });
    expect(canSaveEntry(d)).toBe(true);
    expect(entryReadback(d)).toBe('করিম, ২০০ টাকা বাকি। ঠিক আছে?');
    expect(entryReadback(draft('রহিম ১০০ জমা')!)).toBe('রহিম, ১০০ টাকা জমা। ঠিক আছে?');
  });

  it('unknown customer: blocked until a match or "new" is chosen', () => {
    const d = draft('কোরিম ৫০০ টাকা বাকি')!;
    expect(d).toMatchObject({ customerName: 'কোরিম', customerOk: false, problems: ['customer_unknown'] });
    expect(entryReadback(d)).toBe('কোরিম, ৫০০ টাকা বাকি। কোরিম নামে কাউকে চিনি না। নিচে বেছে নিন।');
    expect(withEntryCustomer(d, 'করিম', true)).toMatchObject({ customerName: 'করিম', problems: [] });
    // "নতুন ক্রেতা"
    expect(withEntryCustomer(d, 'কোরিম', true).problems).toEqual([]);
  });

  it('no customer said ("৫০০ টাকা জমা"): ask whose', () => {
    const d = draft('৫০০ টাকা জমা')!;
    expect(d.problems).toEqual(['no_customer']);
    expect(entryReadback(d)).toBe('৫০০ টাকা জমা। কার জমা?');
  });

  it('intent unclear on the বাকি tab: choose বাকি or জমা', () => {
    const d = draft('করিমের নামে ৩০০', 'ledger')!;
    expect(d).toMatchObject({ kind: null, customerName: 'করিম', amountPoisha: 30000, problems: ['no_kind'] });
    expect(entryReadback(d)).toBe('করিম, ৩০০ টাকা। বাকি না জমা?');
    expect(withKind(d, 'joma')).toMatchObject({ kind: 'joma', problems: [] });
  });

  it('defaults from the customer screen (জমা নিন): customer + kind when not said', () => {
    const d = draft('পাঁচশো', 'ledger', { defaultCustomer: 'করিম', defaultKind: 'joma' })!;
    expect(d).toMatchObject({ kind: 'joma', customerName: 'করিম', customerOk: true, amountPoisha: 50000, problems: [] });
    // nothing heard (number pad fallback): amount still missing
    expect(draft('', 'ledger', { defaultCustomer: 'করিম', defaultKind: 'baki' })!.problems).toEqual(['no_amount']);
  });

  it('amount typed on the pad', () => {
    const d = setEntryAmount(draft('করিম বাকি', 'ledger', { defaultKind: 'baki' })!, 45000);
    expect(d).toMatchObject({ amountPoisha: 45000, problems: [] });
  });
});

describe('expense and owner withdrawal', () => {
  it('expense: what + how much', () => {
    const d = draft('বিদ্যুৎ বিল ৫০০ টাকা খরচ')!;
    expect(d).toMatchObject({ kind: 'expense', item: 'বিদ্যুৎ বিল', amountPoisha: 50000, problems: [] });
    expect(entryReadback(d)).toBe('খরচ: বিদ্যুৎ বিল, ৫০০ টাকা। ঠিক আছে?');
    expect(setEntryItem(d, '  ').problems).toEqual(['no_item']);
  });
  it('owner withdrawal: who + how much (not an expense)', () => {
    const d = draft('মালিক ৫০০ নিল')!;
    expect(d).toMatchObject({ kind: 'owner_withdrawal', person: 'মালিক', amountPoisha: 50000, problems: [] });
    expect(entryReadback(d)).toBe('মালিক নিল: মালিক, ৫০০ টাকা। ঠিক আছে?');
  });
  it('no amount → asks', () => {
    expect(draft('বিদ্যুৎ বিল খরচ')!.problems).toEqual(['no_amount']);
  });
});

describe('purchase', () => {
  it('"নতুন চাল ৫০ কেজি কেনা ৫৫ বেচা ৬০": per-unit buy price, total, new sell price', () => {
    const d = draft('নতুন চাল ৫০ কেজি কেনা ৫৫ বেচা ৬০')!;
    expect(d.kind).toBe('purchase');
    expect(d.purchase).toMatchObject({ productName: 'চাল', quantity: 50, unit: 'kg', buyPricePoisha: 5500, sellPricePoisha: 6000 });
    expect(d.amountPoisha).toBe(275000);
    expect(d.problems).toEqual([]);
    expect(entryReadback(d)).toBe('কেনা: চাল ৫০ কেজি, কেজি ৫৫ টাকা, মোট ২৭৫০ টাকা। বেচা কেজি ৬০। ঠিক আছে?');
  });

  it('a spoken total gives the per-unit price', () => {
    const d = draft('তেল ২০ লিটার কিনলাম ৩৪০০ টাকা')!;
    expect(d.purchase).toMatchObject({ product: tel, quantity: 20, unit: 'litre', buyPricePoisha: 17000, sellPricePoisha: null });
    expect(d.amountPoisha).toBe(340000);
  });

  it('no price: asks; typing the buy price fixes it', () => {
    const d = draft('২০ কেজি চাল কিনলাম')!;
    expect(d.problems).toEqual(['no_price']);
    expect(entryReadback(d)).toBe('কেনা: চাল ২০ কেজি। কেনা দাম কত?');
    const f = setBuyPrice(d, 5200);
    expect(f).toMatchObject({ amountPoisha: 104000, problems: [] });
  });

  it('± keeps the per-unit price; sell price is optional', () => {
    const d = stepPurchase(draft('চাল ১০ কেজি কিনলাম কেজি ৫০')!, 1);
    expect(d.purchase).toMatchObject({ quantity: 10.5, buyPricePoisha: 5000 });
    expect(d.amountPoisha).toBe(52500);
    expect(setSellPrice(d, 6500).purchase!.sellPricePoisha).toBe(6500);
    expect(setSellPrice(d, null).purchase!.sellPricePoisha).toBeNull();
  });

  it('grams of a kg product are converted; an unconvertible unit is kept and warned', () => {
    expect(draft('চাল ৫০০ গ্রাম কিনলাম ৩০ টাকা')!.purchase).toMatchObject({ quantity: 0.5, unit: 'kg', buyPricePoisha: 6000 });
    expect(draft('২ বস্তা চাল কিনলাম')!.purchase).toMatchObject({ quantity: 2, unit: 'bosta', unitWarning: true });
  });
});

describe('pilot log: what was saved and what was changed', () => {
  it('summary carries the final intent and fields', () => {
    const d = withEntryCustomer(draft('কোরিম ৫০০ টাকা বাকি')!, 'করিম', true);
    expect(entrySummary(d)).toEqual({ intent: 'baki', customer: 'করিম', amount: 500, item: null, person: null, note: null, purchase: null });
    expect(entrySummary(draft('নতুন চাল ৫০ কেজি কেনা ৫৫ বেচা ৬০')!).purchase).toEqual({
      product: 'চাল', new_product: false, quantity: 50, unit: 'kg', buy_price: 55, sell_price: 60, unit_warning: false,
    });
  });
  it('diff lists the edited fields', () => {
    const a = draft('কোরিম ৫০০ টাকা বাকি')!;
    const b = setEntryAmount(withEntryCustomer(a, 'করিম', true), 60000);
    expect(diffEntries(a, b)).toEqual(['customerName', 'amountPoisha']);
    expect(diffEntries(a, withEntryCustomer(a, 'কোরিম', true))).toEqual(['customerNew']);
    const p = draft('২০ কেজি চাল কিনলাম')!;
    expect(diffEntries(p, setBuyPrice(stepPurchase(p, 1), 5000))).toEqual(['purchase.quantity', 'purchase.buyPricePoisha', 'amountPoisha']);
    const u = draft('করিমের নামে ৩০০', 'ledger')!;
    expect(diffEntries(u, withKind(u, 'baki'))).toEqual(['kind']);
  });
});
