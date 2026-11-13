import { parseSpokenAmount } from '../amount';

describe('parseSpokenAmount (Setup: "এখন ক্যাশে কত টাকা?")', () => {
  it.each([
    ['পাঁচ হাজার', 5000],
    ['পাঁচ হাজার টাকা', 5000],
    ['৫০০০', 5000],
    ['5000 টাকা', 5000],
    ['৳ ৫,০০০', 5000],
    ['এক হাজার পাঁচশ', 1500],
    ['দেড় হাজার টাকা', 1500],
    ['সাড়ে তিন হাজার', 3500],
    ['দশ হাজার টাকা আছে', 10000],
    ['ক্যাশে এখন বারো হাজার তিনশো পঞ্চাশ টাকা', 12350],
    ['হাজার টাকা', 1000],
    ['এক লাখ', 100000],
    ['শূন্য', 0],
    ['কিছু নেই', 0],
    ['ক্যাশে কিছুই নাই', 0],
    ['৫০০.৫০', 500.5],
  ])('"%s" → %d', (text, want) => {
    expect(parseSpokenAmount(text)).toBe(want);
  });

  it.each([[''], ['   '], ['জানি না'], ['চাল']])('"%s" → null (ask again / number pad)', (text) => {
    expect(parseSpokenAmount(text)).toBeNull();
  });

  it('two separate numbers are ambiguous → null', () => {
    expect(parseSpokenAmount('পাঁচশ না ছয়শ')).toBeNull();
    expect(parseSpokenAmount('৫০০ ৬০০')).toBeNull();
  });
});
