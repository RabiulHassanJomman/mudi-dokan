import { padDisplay, padPress, padValue, type PadKey } from '../numpad';

const press = (keys: PadKey[], opts?: Parameters<typeof padPress>[2]) => keys.reduce((s, k) => padPress(s, k, opts), '');

describe('number pad', () => {
  it('digits append; leading zero is replaced', () => {
    expect(press(['2'])).toBe('2');
    expect(press(['1', '2', '0'])).toBe('120');
    expect(press(['0', '0', '5'])).toBe('5');
  });

  it('½ adds a half: "২½" = 2.5, alone = 0.5', () => {
    expect(press(['2', 'half'])).toBe('2.5');
    expect(press(['half'])).toBe('0.5');
    expect(padValue('2.5')).toBe(2.5);
  });

  it('only one ½, and no digits after it', () => {
    expect(press(['2', 'half', 'half'])).toBe('2.5');
    expect(press(['2', 'half', '3'])).toBe('2.5');
  });

  it('½ is off where it makes no sense (গ্রাম, টাকার, cash)', () => {
    expect(press(['5', 'half'], { allowHalf: false })).toBe('5');
  });

  it('⌫ removes the ½ first, then digits', () => {
    expect(padPress('2.5', 'back')).toBe('2');
    expect(padPress('0.5', 'back')).toBe('');
    expect(padPress('120', 'back')).toBe('12');
    expect(padPress('', 'back')).toBe('');
  });

  it('caps the length', () => {
    expect(press(['9', '9', '9', '9', '9', '9', '9'])).toBe('999999');
    expect(press(['1', '0', '0', '0', '0', '0', '0', '0'], { maxDigits: 7 })).toBe('1000000');
  });

  it('value: empty = null', () => {
    expect(padValue('')).toBeNull();
    expect(padValue('0')).toBe(0);
    expect(padValue('1500')).toBe(1500);
  });

  it('display: Bangla digits, thousands comma, ½ glyph', () => {
    expect(padDisplay('')).toBe('');
    expect(padDisplay('2')).toBe('২');
    expect(padDisplay('2.5')).toBe('২½');
    expect(padDisplay('0.5')).toBe('½');
    expect(padDisplay('5000')).toBe('৫,০০০');
  });

  it('from a number back to pad text (editing an existing value)', () => {
    expect(padPress(String(2.5), 'back')).toBe('2');
  });
});
