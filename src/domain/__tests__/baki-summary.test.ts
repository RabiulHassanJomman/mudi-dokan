import { bakiSummary, bakiSummaryWords, type SummaryLine } from '../customers';

const DAY = 86_400_000;
// local noon, so day counting never sits on a midnight
const NOW = new Date(2026, 10, 27, 12).getTime();
const ago = (days: number) => NOW - days * DAY;
const baki = (taka: number, days: number): SummaryLine => ({ kind: 'baki', amount_poisha: taka * 100, created_at: ago(days) });
const joma = (taka: number, days: number): SummaryLine => ({ kind: 'joma', amount_poisha: taka * 100, created_at: ago(days) });

describe('a customer’s baki summary', () => {
  it('totals, counts and balance (rows newest first, as customerHistory gives them)', () => {
    const s = bakiSummary([joma(300, 2), baki(200, 5), baki(500, 10)], NOW);
    expect(s).toMatchObject({ bakiPoisha: 70000, bakiCount: 2, jomaPoisha: 30000, jomaCount: 1, balancePoisha: 40000 });
    expect(s.lastJoma).toEqual({ at: ago(2), poisha: 30000 });
  });

  it('owed since the oldest baki not yet paid off (জমা pays the oldest first)', () => {
    // 500 (10 days ago) is paid off by the 300 + 200 জমা; the 200 from 5 days ago is still owed
    const s = bakiSummary([joma(200, 1), joma(300, 3), baki(200, 5), baki(500, 10)], NOW);
    expect(s.balancePoisha).toBe(20000);
    expect(s.owedSince).toBe(ago(5));
    expect(s.owedDays).toBe(5);
  });

  it('a part-paid baki still counts from its own day', () => {
    const s = bakiSummary([joma(100, 2), baki(500, 10)], NOW);
    expect(s.owedSince).toBe(ago(10));
    expect(s.owedDays).toBe(10);
  });

  it('nothing owed (paid up or paid ahead): no owed-since', () => {
    expect(bakiSummary([joma(500, 1), baki(500, 4)], NOW).owedSince).toBeNull();
    const ahead = bakiSummary([joma(800, 1), baki(500, 4)], NOW);
    expect(ahead.balancePoisha).toBe(-30000);
    expect(ahead.owedSince).toBeNull();
    expect(ahead.owedDays).toBeNull();
  });

  it('owed today counts as 0 days; no rows at all', () => {
    expect(bakiSummary([baki(50, 0)], NOW).owedDays).toBe(0);
    expect(bakiSummary([], NOW)).toMatchObject({ bakiPoisha: 0, jomaPoisha: 0, balancePoisha: 0, owedSince: null, lastJoma: null });
  });
});

describe('the summary read aloud', () => {
  it('owing, with a last জমা', () => {
    const s = bakiSummary([joma(300, 2), baki(200, 5), baki(500, 10)], NOW);
    expect(bakiSummaryWords('করিম', s, NOW)).toBe(
      'করিমের হিসাব। মোট বাকি নিয়েছে ৭০০ টাকা, ২ বার। জমা দিয়েছে ৩০০ টাকা, ১ বার। এখন পাবো ৪০০ টাকা, ১০ দিন ধরে। শেষ জমা ২৫ নভে, ৩০০ টাকা।',
    );
  });

  it('never paid, owed since today', () => {
    const s = bakiSummary([baki(150, 0)], NOW);
    expect(bakiSummaryWords('সুমি', s, NOW)).toBe('সুমির হিসাব। মোট বাকি নিয়েছে ১৫০ টাকা, ১ বার। এখনো কোনো জমা দেয়নি। এখন পাবো ১৫০ টাকা, আজ থেকে।');
  });

  it('paid up, and paid ahead', () => {
    expect(bakiSummaryWords('করিম', bakiSummary([joma(500, 1), baki(500, 4)], NOW), NOW)).toBe(
      'করিমের হিসাব। মোট বাকি নিয়েছে ৫০০ টাকা, ১ বার। জমা দিয়েছে ৫০০ টাকা, ১ বার। কোনো বাকি নেই। শেষ জমা গতকাল, ৫০০ টাকা।',
    );
    expect(bakiSummaryWords('করিম', bakiSummary([joma(800, 1), baki(500, 4)], NOW), NOW)).toContain('অগ্রিম দিয়েছে ৩০০ টাকা।');
  });

  it('no rows yet', () => {
    expect(bakiSummaryWords('করিম', bakiSummary([], NOW), NOW)).toBe('করিমের হিসাব। এখনো কোনো বাকি বা জমা নেই।');
  });
});
