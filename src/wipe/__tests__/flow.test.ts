import { FALLBACK_WORD, HOLD_MS, START, chooseScope, finalWarning, holdProgress, nameMatches, step, typeName, wordToType, type WipeFlow } from '../flow';

const SHOP = 'রহিম স্টোর';
const done = (over: Partial<WipeFlow> = {}): WipeFlow => ({ scope: 'phone', backedUp: true, typed: SHOP, held: true, confirmed: true, ...over });

describe('wipe flow', () => {
  it('each step opens only after the ones before it', () => {
    expect(step(START, SHOP)).toBe('scope');
    expect(step({ ...START, scope: 'phone' }, SHOP)).toBe('backup');
    expect(step({ ...START, scope: 'phone', backedUp: true }, SHOP)).toBe('name');
    expect(step({ ...START, scope: 'phone', backedUp: true, typed: 'রহিম' }, SHOP)).toBe('name');
    expect(step(done({ held: false, confirmed: false }), SHOP)).toBe('hold');
    expect(step(done({ confirmed: false }), SHOP)).toBe('final');
    expect(step(done(), SHOP)).toBe('ready');
  });

  it('the shop name must be typed exactly (spaces at the ends and keyboard composition ignored, nothing else)', () => {
    expect(nameMatches('রহিম স্টোর', SHOP)).toBe(true);
    expect(nameMatches('  রহিম স্টোর ', SHOP)).toBe(true);
    expect(nameMatches('রহিম  স্টোর', SHOP)).toBe(true);
    expect(nameMatches('রহিম স্টোর'.normalize('NFD'), SHOP)).toBe(true);
    expect(nameMatches('রহিম', SHOP)).toBe(false);
    expect(nameMatches('রহিম স্টোরে', SHOP)).toBe(false);
    expect(nameMatches('', SHOP)).toBe(false);
    expect(nameMatches('Rahim Store', 'rahim store')).toBe(false); // case matters
  });

  it('a shop without a name: type মুছুন', () => {
    expect(wordToType(null)).toBe(FALLBACK_WORD);
    expect(wordToType('  ')).toBe(FALLBACK_WORD);
    expect(nameMatches('মুছুন', null)).toBe(true);
    expect(nameMatches('', null)).toBe(false);
  });

  it('the hold is 5 seconds; letting go early starts over', () => {
    expect(HOLD_MS).toBe(5000);
    expect(holdProgress(0)).toBe(0);
    expect(holdProgress(2500)).toBe(0.5);
    expect(holdProgress(9000)).toBe(1);
  });

  it('changing the scope or the name closes the later steps again', () => {
    const f = chooseScope(done(), 'everywhere');
    expect(f).toMatchObject({ scope: 'everywhere', backedUp: true, typed: '', held: false, confirmed: false });
    expect(step(f, SHOP)).toBe('name');
    const same = done();
    expect(chooseScope(same, 'phone')).toBe(same); // same scope: untouched
    const g = typeName(done(), 'রহিম স্টোরে');
    expect(g).toMatchObject({ held: false, confirmed: false });
    expect(step(g, SHOP)).toBe('name');
    expect(step(typeName(g, SHOP), SHOP)).toBe('hold');
  });

  it('the last warning says what goes where', () => {
    const c = { entries: 120, customers: 8, products: 30 };
    expect(finalWarning('everywhere', SHOP, c)).toMatch(/১২০|120টা হিসাব/);
    expect(finalWarning('everywhere', SHOP, c)).toMatch(/সব ফোন.*Drive/);
    expect(finalWarning('phone', null, c)).toMatch(/এই ফোন থেকে.*লগ আউট/);
    expect(finalWarning('phone', null, c)).not.toMatch(/Drive/);
  });
});
