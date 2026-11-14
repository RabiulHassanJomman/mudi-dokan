import {
  NOTES,
  addDays,
  businessDate,
  cashRows,
  cashWords,
  closeReadback,
  countedPoisha,
  dayStart,
  daySummaryWords,
  expectedCash,
  gapOf,
  openingAnchor,
  profitOf,
  profitWords,
  stepNote,
  type CashFlows,
} from '../cash';

const flows = (f: Partial<CashFlows> = {}): CashFlows => ({
  sales: 0,
  cashSales: 0,
  bakiGiven: 0,
  joma: 0,
  expenses: 0,
  cashPurchases: 0,
  withdrawals: 0,
  ...f,
});

describe('business days (shop-local calendar)', () => {
  it('date ↔ start of day', () => {
    const t = new Date(2026, 10, 14, 15, 30).getTime();
    expect(businessDate(t)).toBe('2026-11-14');
    expect(dayStart('2026-11-14')).toBe(new Date(2026, 10, 14).getTime());
    expect(businessDate(dayStart('2026-11-14'))).toBe('2026-11-14');
  });
  it('addDays crosses months and years', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('expected cash = opening + cash sales + joma − expenses − cash purchases − owner took', () => {
  it('Plan feature 9', () => {
    const f = flows({ sales: 600000, cashSales: 450000, bakiGiven: 150000, joma: 50000, expenses: 77000, cashPurchases: 120000, withdrawals: 20000 });
    expect(expectedCash(520000, f)).toBe(520000 + 450000 + 50000 - 77000 - 120000 - 20000);
  });
  it('credit sales and baki given do not change the cash', () => {
    expect(expectedCash(1000, flows({ sales: 9000, bakiGiven: 9000 }))).toBe(1000);
  });
});

describe('opening cash: the latest anchor', () => {
  it('nothing yet', () => {
    expect(openingAnchor([], '2026-11-14')).toBeNull();
  });
  it('setup opening on the same day', () => {
    expect(openingAnchor([{ date: '2026-11-14', kind: 'opening', amountPoisha: 500000 }], '2026-11-14')).toEqual({
      from: '2026-11-14', amountPoisha: 500000, source: 'setup',
    });
  });
  it("yesterday's counted cash is today's opening", () => {
    const a = [
      { date: '2026-11-13', kind: 'opening' as const, amountPoisha: 500000 },
      { date: '2026-11-13', kind: 'close' as const, amountPoisha: 812000 },
    ];
    expect(openingAnchor(a, '2026-11-14')).toEqual({ from: '2026-11-14', amountPoisha: 812000, source: 'close' });
    // the close does not count for its own day
    expect(openingAnchor(a, '2026-11-13')).toEqual({ from: '2026-11-13', amountPoisha: 500000, source: 'setup' });
  });
  it('a day not closed carries on (the repo adds the days in between)', () => {
    const a = [{ date: '2026-11-11', kind: 'close' as const, amountPoisha: 300000 }];
    expect(openingAnchor(a, '2026-11-14')).toEqual({ from: '2026-11-12', amountPoisha: 300000, source: 'carry' });
  });
  it('future anchors are ignored', () => {
    expect(openingAnchor([{ date: '2026-11-20', kind: 'opening', amountPoisha: 1 }], '2026-11-14')).toBeNull();
  });
});

describe('note counting', () => {
  it('৳1000 → ৳10, ± never below zero', () => {
    expect(NOTES).toEqual([1000, 500, 200, 100, 50, 20, 10]);
    let c = {};
    c = stepNote(c, 1000, 1);
    c = stepNote(c, 1000, 1);
    c = stepNote(c, 50, 1);
    c = stepNote(c, 20, -1);
    expect(c).toEqual({ 1000: 2, 50: 1 });
    expect(countedPoisha(c)).toBe(205000);
  });
  it('gap: short, over, equal', () => {
    expect(gapOf(818000, 823000)).toEqual({ kind: 'short', poisha: 5000, text: '৳ ৫০ কম আছে', words: '৫০ টাকা কম আছে।' });
    expect(gapOf(825000, 823000)).toEqual({ kind: 'over', poisha: 2000, text: '৳ ২০ বেশি আছে', words: '২০ টাকা বেশি আছে।' });
    expect(gapOf(823000, 823000)).toEqual({ kind: 'ok', poisha: 0, text: 'ঠিক মিলেছে', words: 'ঠিক মিলেছে।' });
  });
  it('close readback says counted, expected and the gap', () => {
    expect(closeReadback(818000, 823000)).toBe('গুনে পেলাম ৮১৮০ টাকা। থাকার কথা ৮২৩০ টাকা। ৫০ টাকা কম আছে। দিন শেষ করবো?');
  });
});

describe('cash screen rows and TTS', () => {
  const f = flows({ cashSales: 450000, joma: 50000, expenses: 57000, cashPurchases: 120000, withdrawals: 20000 });
  it('rows in order; zero minus rows hidden', () => {
    expect(cashRows(520000, 'close', f).map((r) => [r.label, r.sign, r.poisha])).toEqual([
      ['গতকালের ক্যাশ', 1, 520000],
      ['নগদ বিক্রি', 1, 450000],
      ['বাকি জমা পেলাম', 1, 50000],
      ['খরচ', -1, 57000],
      ['মাল কেনা (নগদ)', -1, 120000],
      ['মালিক নিল', -1, 20000],
    ]);
    expect(cashRows(500000, 'setup', flows()).map((r) => r.label)).toEqual(['শুরুর ক্যাশ', 'নগদ বিক্রি', 'বাকি জমা পেলাম', 'খরচ']);
  });
  it('words', () => {
    expect(cashWords(520000, 'close', f)).toBe(
      'গতকালের ক্যাশ ৫২০০ টাকা। নগদ বিক্রি ৪৫০০। বাকি জমা পেলাম ৫০০। খরচ ৫৭০। মাল কেনা ১২০০। মালিক নিল ২০০। হাতে থাকার কথা ৮২৩০ টাকা।',
    );
  });
});

describe('profit (Plan feature 5)', () => {
  it('বিক্রি, মোট লাভ, খরচ, আসল লাভ', () => {
    const p = profitOf({ salesPoisha: 485000, knownSalesPoisha: 485000, knownCostPoisha: 393000, unknownLines: 0, expensesPoisha: 57000 });
    expect(p).toEqual({ sales: 485000, gross: 92000, expenses: 57000, net: 35000, unknownLines: 0 });
    expect(profitWords(p)).toBe('আজ বিক্রি ৪৮৫০ টাকা। মোট লাভ ৯২০। খরচ ৫৭০। আসল লাভ ৩৫০ টাকা।');
  });
  it('sales with unknown buy price are left out of the profit and mentioned', () => {
    const p = profitOf({ salesPoisha: 500000, knownSalesPoisha: 485000, knownCostPoisha: 393000, unknownLines: 2, expensesPoisha: 0 });
    expect(p.gross).toBe(92000);
    expect(profitWords(p)).toBe('আজ বিক্রি ৫০০০ টাকা। মোট লাভ ৯২০। খরচ ০। আসল লাভ ৯২০ টাকা। ২টা বিক্রির কেনা দাম জানা নেই, লাভে ধরা হয়নি।');
  });
  it('a loss is said as a loss', () => {
    const p = profitOf({ salesPoisha: 10000, knownSalesPoisha: 10000, knownCostPoisha: 8000, unknownLines: 0, expensesPoisha: 5000 });
    expect(profitWords(p)).toBe('আজ বিক্রি ১০০ টাকা। মোট লাভ ২০। খরচ ৫০। আসল লাভ নেই, লোকসান ৩০ টাকা।');
  });
  it('nothing sold', () => {
    expect(profitWords(profitOf({ salesPoisha: 0, knownSalesPoisha: 0, knownCostPoisha: 0, unknownLines: 0, expensesPoisha: 0 }))).toBe(
      'আজ এখনো কোনো বিক্রি নেই। খরচ ০।',
    );
  });
});

describe('day summary ("আজকের হিসাব")', () => {
  it('sales, baki given, joma, expenses, expected cash', () => {
    const f = flows({ sales: 600000, cashSales: 450000, bakiGiven: 150000, joma: 50000, expenses: 57000 });
    expect(daySummaryWords(f, expectedCash(520000, f))).toBe(
      'আজ বিক্রি ৬০০০ টাকা। বাকি দিলাম ১৫০০। জমা পেলাম ৫০০। খরচ ৫৭০। হাতে থাকার কথা ৯৬৩০ টাকা।',
    );
  });
  it('purchases and owner cash-outs are said when there are any', () => {
    const f = flows({ cashPurchases: 120000, withdrawals: 20000 });
    expect(daySummaryWords(f, 100000)).toBe(
      'আজ বিক্রি ০ টাকা। বাকি দিলাম ০। জমা পেলাম ০। খরচ ০। মাল কেনা ১২০০। মালিক নিল ২০০। হাতে থাকার কথা ১০০০ টাকা।',
    );
  });
});
