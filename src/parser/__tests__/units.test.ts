import { normalizeText, tokenize } from '../normalize';
import { parseUnit } from '../units';

describe('units', () => {
  it.each([
    ['কেজি', 'kg', 1],
    ['কিলো', 'kg', 1],
    ['kg', 'kg', 1],
    ['পোয়া', 'kg', 0.25],
    ['গ্রাম', 'g', 1],
    ['লিটার', 'litre', 1],
    ['মিলি', 'ml', 1],
    ['পিস', 'piece', 1],
    ['টা', 'piece', 1],
    ['টি', 'piece', 1],
    ['প্যাকেট', 'packet', 1],
    ['ডজন', 'dozen', 1],
    ['হালি', 'hali', 1],
    ['বস্তা', 'bosta', 1],
  ])('%s → %s ×%d', (word, unit, factor) => {
    expect(parseUnit(word.normalize('NFC'))).toEqual({ unit, factor });
  });

  it.each(['চাল', 'টাকা', 'কেজির'])('%s is not a unit', (w) => {
    expect(parseUnit(w)).toBeNull();
  });
});

describe('normalize', () => {
  it('converts Bangla digits and strips punctuation', () => {
    expect(normalizeText('চাল ২ কেজি, ১২০ টাকা।')).toBe('চাল 2 কেজি 120 টাকা');
  });
  it('splits fused digit + word', () => {
    expect(tokenize('২কেজি')).toEqual(['2', 'কেজি']);
    expect(tokenize('৩টা ডিম')).toEqual(['3', 'টা', 'ডিম']);
  });
  it('keeps decimals and removes thousands commas', () => {
    expect(tokenize('২.৫ কেজি')).toEqual(['2.5', 'কেজি']);
    expect(tokenize('১,৫০০ টাকা')).toEqual(['1500', 'টাকা']);
  });
  it('maps ৳ to টাকা', () => {
    expect(tokenize('৳১০০')).toEqual(['টাকা', '100']);
  });
  it('removes zero-width characters and extra spaces', () => {
    expect(tokenize('  চাল‌   ২  ')).toEqual(['চাল', '2']);
  });
  it('maps spelling variants', () => {
    expect(tokenize('বাকী')).toEqual(['বাকি']);
  });
});
