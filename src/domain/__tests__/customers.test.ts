import { customerStatus, initialOf, suggestCustomers } from '../customers';

const known = ['করিম', 'রহিম', 'করিমুল', 'সালমা', 'জামাল', 'কামাল', 'হাসান'];

describe('customer status', () => {
  it('known by exact name (spacing / Unicode form ignored)', () => {
    expect(customerStatus('করিম', known)).toBe('known');
    expect(customerStatus(' করিম ', known)).toBe('known');
  });
  it('unknown name, or missing', () => {
    expect(customerStatus('কোরিম', known)).toBe('unknown');
    expect(customerStatus('', known)).toBe('missing');
    expect(customerStatus(null, known)).toBe('missing');
  });
});

describe('closest matches for an unknown name', () => {
  it('STT spelling slips come first', () => {
    expect(suggestCustomers('কোরিম', known)[0]).toBe('করিম');
    expect(suggestCustomers('রহীম', known)[0]).toBe('রহিম');
    expect(suggestCustomers('জামাল', ['জামাল', 'কামাল'])).toEqual(['জামাল', 'কামাল']);
  });
  it('at most n, and only reasonably close ones', () => {
    expect(suggestCustomers('করিম', known, 2)).toHaveLength(2);
    expect(suggestCustomers('নুডলস', known)).toEqual([]);
  });
  it('an empty name suggests nothing (the screen lists everyone instead)', () => {
    expect(suggestCustomers('', known)).toEqual([]);
  });
});

describe('avatar initial', () => {
  it('first letter with its vowel sign / conjunct kept together', () => {
    expect(initialOf('করিম')).toBe('ক');
    expect(initialOf('শ্যামল')).toBe('শ্যা');
    expect(initialOf('কিরণ')).toBe('কি');
    expect(initialOf('  ')).toBe('?');
  });
});
