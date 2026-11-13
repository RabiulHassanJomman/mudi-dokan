import { formatNumber, formatTaka, parseTakaInput, toBnDigits } from '../bn';

describe('formatNumber', () => {
  it('Bangla digits, thousands comma, trailing zeros of the fraction dropped', () => {
    expect(formatNumber(8230)).toBe('৮,২৩০');
    expect(formatNumber(2.5)).toBe('২.৫');
    expect(formatNumber(2.5, 3)).toBe('২.৫');
    expect(formatNumber(66.666)).toBe('৬৬.৬৭');
    expect(formatNumber(-1500)).toBe('−১,৫০০');
  });
  it('with no decimals keeps the whole number (৫০০০ is not ৫)', () => {
    expect(formatNumber(5000, 0)).toBe('৫,০০০');
    expect(formatNumber(100, 0)).toBe('১০০');
    expect(formatNumber(0, 0)).toBe('০');
    expect(formatNumber(10)).toBe('১০');
  });
  it('taka and input', () => {
    expect(formatTaka(500000)).toBe('৳ ৫,০০০');
    expect(parseTakaInput('৫,০০০')).toBe(500000);
    expect(toBnDigits('2.5')).toBe('২.৫');
  });
});
