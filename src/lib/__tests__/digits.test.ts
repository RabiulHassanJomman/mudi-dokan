import { splitNumbers } from '../digits';

describe('splitNumbers', () => {
  it('prices, quantities, ranges, text around them', () => {
    expect(splitNumbers('৳ ৮,২৩০')).toEqual([{ text: '৳', num: true }, { text: ' ', num: false }, { text: '৮,২৩০', num: true }]);
    expect(splitNumbers('২.৫ কেজি')).toEqual([{ text: '২.৫', num: true }, { text: ' কেজি', num: false }]);
    expect(splitNumbers('চাল ২ কেজি, ১২০ টাকা')).toEqual([
      { text: 'চাল ', num: false }, { text: '২', num: true }, { text: ' কেজি, ', num: false }, { text: '১২০', num: true }, { text: ' টাকা', num: false },
    ]);
  });
  it('a comma or point that is not between digits stays text', () => {
    expect(splitNumbers('৫, ডাল')).toEqual([{ text: '৫', num: true }, { text: ', ডাল', num: false }]);
    expect(splitNumbers('ঠিক আছে।')).toEqual([{ text: 'ঠিক আছে।', num: false }]);
    expect(splitNumbers('')).toEqual([]);
  });
  it('nothing is lost', () => {
    const s = '৳ ১,২৩,৪৫৬.৭৮ · ২½ কেজি — সুমি ০১৭১১';
    expect(splitNumbers(s).map((r) => r.text).join('')).toBe(s);
  });
});
