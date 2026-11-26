import { parseFixed, type FixedCommand, type FixedContext } from '../fixed';

const nfc = <T>(v: T): T => JSON.parse(JSON.stringify(v).normalize('NFC')) as T;

type Expected = Partial<Pick<FixedCommand, 'kind' | 'customer' | 'goods' | 'amount' | 'problems'>>;

/** A complete command: no problems, and no customer / amount beyond what is expected. */
function ok(text: string, expected: Expected, ctx?: FixedContext): void {
  const r = parseFixed(text, ctx);
  expect({ kind: r.kind, customer: r.customer, goods: r.goods, amount: r.amount, problems: r.problems }).toEqual(
    nfc({ goods: [], problems: [], ...expected }),
  );
}

const bad = (text: string, expected: Expected, ctx?: FixedContext) => expect(parseFixed(text, ctx)).toMatchObject(nfc(expected));

const shop: FixedContext = {
  knownProducts: ['আদা', 'চাল', 'আটা', 'আলু', 'লাক্স সাবান', 'সয়াবিন তেল'],
  productAliases: { চাউল: 'চাল', 'তীর তেল': 'সয়াবিন তেল' },
  knownCustomers: ['সাজু', 'আব্দুল করিম', 'সাগর'],
};

describe('the four formats', () => {
  it('বাকি sale', () => {
    ok('সাজু বাকি নিয়েছে আদা, চাল, আটা ১০০ টাকা', { kind: 'baki', customer: 'সাজু', goods: ['আদা', 'চাল', 'আটা'], amount: 100 });
  });
  it('নগদ sale', () => {
    ok('নগদ বিক্রি আদা, চাল ১০০ টাকা', { kind: 'cash_sale', goods: ['আদা', 'চাল'], amount: 100 });
  });
  it('stock bought', () => {
    ok('১০০০ টাকার আলু কেনা হয়েছে', { kind: 'purchase', goods: ['আলু'], amount: 1000 });
  });
  it('জমা', () => {
    ok('সাজু ৫০ টাকা জমা দিয়েছে', { kind: 'joma', customer: 'সাজু', amount: 50 });
  });
  it('নগদ with only the amount', () => {
    ok('নগদ বিক্রি ১০০ টাকা', { kind: 'cash_sale', amount: 100 });
    ok('নগদ ১০০ টাকা', { kind: 'cash_sale', amount: 100 });
    ok('১০০ টাকা নগদ বিক্রি হলো', { kind: 'cash_sale', amount: 100 });
  });
  it('বাকি with only the name and the amount', () => {
    ok('সাজু বাকি ১০০ টাকা', { kind: 'baki', customer: 'সাজু', amount: 100 });
    ok('সাজু ১০০ টাকা বাকি নিয়েছে', { kind: 'baki', customer: 'সাজু', amount: 100 });
    ok('সাজু বাকি নিয়েছে ১০০ টাকা', { kind: 'baki', customer: 'সাজু', amount: 100 });
    ok('আব্দুল করিম ভাই বাকি নিলো পাঁচশ টাকা', { kind: 'baki', customer: 'আব্দুল করিম', amount: 500 }, shop);
  });
});

describe('how speech-to-text writes it', () => {
  it('no commas: goods are split by known product names', () => {
    ok('সাজু বাকি নিয়েছে আদা চাল আটা ১০০ টাকা', { kind: 'baki', customer: 'সাজু', goods: ['আদা', 'চাল', 'আটা'], amount: 100 }, shop);
  });
  it('no commas and unknown goods: kept as spoken', () => {
    ok('সাজু বাকি নিয়েছে আদা চাল আটা ১০০ টাকা', { kind: 'baki', customer: 'সাজু', goods: ['আদা চাল আটা'], amount: 100 });
    ok('নগদ বিক্রি মসুর ডাল চাল ১০০ টাকা', { kind: 'cash_sale', goods: ['মসুর ডাল', 'চাল'], amount: 100 }, shop);
  });
  it('multi-word product names and aliases', () => {
    ok('নগদ বিক্রি লাক্স সাবান চাউল তীর তেল ৩০০ টাকা', { kind: 'cash_sale', goods: ['লাক্স সাবান', 'চাল', 'সয়াবিন তেল'], amount: 300 }, shop);
  });
  it('আর / এবং separate goods', () => {
    ok('নগদ বিক্রি পেঁয়াজ আর রসুন এবং মরিচ ৮০ টাকা', { kind: 'cash_sale', goods: ['পেঁয়াজ', 'রসুন', 'মরিচ'], amount: 80 });
  });
  it('বাকী, বাকিতে, নগদে', () => {
    ok('সাজু বাকী নিছে চাল ১০০ টাকা', { kind: 'baki', customer: 'সাজু', goods: ['চাল'], amount: 100 });
    ok('সাজু বাকিতে চাল নিল ১০০ টাকা', { kind: 'baki', customer: 'সাজু', goods: ['চাল'], amount: 100 });
    ok('নগদে চাল বিক্রি ১০০ টাকা', { kind: 'cash_sale', goods: ['চাল'], amount: 100 });
  });
  it.each([
    ['100 টাকা', 100],
    ['১,৫০০ টাকা', 1500],
    ['একশ টাকা', 100],
    ['একশো টাকা', 100],
    ['এক হাজার পাঁচশ টাকা', 1500],
    ['দেড় হাজার টাকা', 1500],
    ['সাড়ে তিনশ টাকা', 350],
    ['১০০ টাকার', 100],
    ['১০০ টাকা।', 100],
    ['৳১০০', 100],
    ['১০০৳', 100],
    ['১২.৫০ টাকা', 12.5],
  ])('amount "%s"', (said, amount) => {
    ok(`নগদ বিক্রি চাল ${said}`, { kind: 'cash_sale', goods: ['চাল'], amount });
  });
  it('মোট before the amount is not a goods name', () => {
    ok('সাজু বাকি নিয়েছে চাল ডাল মোট ৫০০ টাকা', { kind: 'baki', customer: 'সাজু', goods: ['চাল ডাল'], amount: 500 });
  });
  it('a quantity stays with the goods, only the number before টাকা is money', () => {
    ok('নগদ বিক্রি চাল ২ কেজি, ডাল ১২০ টাকা', { kind: 'cash_sale', goods: ['চাল 2 কেজি', 'ডাল'], amount: 120 });
  });
});

describe('customer names', () => {
  it('honorifics are dropped', () => {
    ok('সাজু ভাই বাকি নিয়েছে চাল ১০০ টাকা', { kind: 'baki', customer: 'সাজু', goods: ['চাল'], amount: 100 });
    ok('সুমি আপা ৫০ টাকা জমা দিয়েছে', { kind: 'joma', customer: 'সুমি', amount: 50 });
  });
  it('several words', () => {
    ok('আব্দুল করিম বাকি নিয়েছে চাল ১০০ টাকা', { kind: 'baki', customer: 'আব্দুল করিম', goods: ['চাল'], amount: 100 }, shop);
  });
  it('কে / র / ের endings', () => {
    ok('সাজুকে বাকি চাল ১০০ টাকা', { kind: 'baki', customer: 'সাজু', goods: ['চাল'], amount: 100 });
    ok('সাজুর বাকি চাল ১০০ টাকা', { kind: 'baki', customer: 'সাজু', goods: ['চাল'], amount: 100 }, shop);
    ok('করিমের ৫০ টাকা জমা', { kind: 'joma', customer: 'করিম', amount: 50 });
  });
  it('a known name ending in র is not cut', () => {
    ok('সাগর ৫০ টাকা জমা দিয়েছে', { kind: 'joma', customer: 'সাগর', amount: 50 }, shop);
    ok('সাগর ৫০ টাকা জমা দিয়েছে', { kind: 'joma', customer: 'সাগর', amount: 50 });
  });
  it('নগদ with a buyer', () => {
    ok('সাজু নগদ নিয়েছে চাল ১০০ টাকা', { kind: 'cash_sale', customer: 'সাজু', goods: ['চাল'], amount: 100 });
  });
  it('known goods said before নগদ are goods, not a buyer', () => {
    ok('চাল ডাল নগদ বিক্রি ১০০ টাকা', { kind: 'cash_sale', goods: ['চাল', 'ডাল'], amount: 100 }, { knownProducts: ['চাল', 'ডাল'] });
  });
  it('আজ is not part of a name or the goods', () => {
    ok('আজ সাজু ৫০ টাকা জমা দিয়েছে', { kind: 'joma', customer: 'সাজু', amount: 50 });
    ok('আজকে ১০০০ টাকার আলু কিনলাম', { kind: 'purchase', goods: ['আলু'], amount: 1000 });
  });
});

describe('ask again', () => {
  it('missing customer', () => {
    bad('বাকি নিয়েছে চাল ১০০ টাকা', { kind: 'baki', problems: ['no_customer'] });
    bad('৫০ টাকা জমা দিয়েছে', { kind: 'joma', problems: ['no_customer'] });
  });
  it('missing goods', () => {
    bad('১০০০ টাকার কেনা হয়েছে', { kind: 'purchase', problems: ['no_goods'] });
  });
  it('missing amount: a number without টাকা is not money', () => {
    bad('সাজু বাকি নিয়েছে চাল', { kind: 'baki', customer: 'সাজু', goods: ['চাল'], problems: ['no_amount'] });
    bad('নগদ বিক্রি চাল ১০০', { kind: 'cash_sale', problems: ['no_amount'] });
    bad('সাজু ০ টাকা জমা দিয়েছে', { kind: 'joma', problems: ['no_amount'] });
  });
  it('two amounts', () => {
    const r = parseFixed('নগদ বিক্রি চাল ১০০ টাকা ডাল ৫০ টাকা');
    expect(r.problems).toEqual(['two_amounts']);
    expect(r.amount).toBeUndefined();
  });
  it('one product per stock purchase', () => {
    bad('১০০০ টাকার আলু আর চাল কেনা হয়েছে', { kind: 'purchase', problems: ['many_goods'] });
  });
  it.each(['সাজু বাকি ৫০ টাকা জমা দিয়েছে', 'নগদ ১০০০ টাকার আলু কেনা', 'সাজু নগদ বাকি চাল ১০০ টাকা'])('two types: %s', (text) => {
    bad(text, { kind: null, problems: ['two_types'] });
  });
  it.each(['', 'সাজুর কত', 'চাল ১০০ টাকা', 'আজকের হিসাব'])('no format: "%s"', (text) => {
    bad(text, { kind: null, goods: [], problems: ['no_match'] });
  });
  it('questions are not entries', () => {
    bad('সাজুর বাকি কত', { kind: null, problems: ['no_match'] });
    bad('মোট কত বাকি', { kind: null, problems: ['no_match'] });
  });
});

it('keeps what was said', () => {
  expect(parseFixed('নগদ বিক্রি চাল ১০০ টাকা।')).toMatchObject({ raw: 'নগদ বিক্রি চাল ১০০ টাকা।', normalized: 'নগদ বিক্রি চাল 100 টাকা'.normalize('NFC') });
});
