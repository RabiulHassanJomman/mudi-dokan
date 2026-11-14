import { openingAnchor } from '../cash';
import { duplicatePairs, mergeQuestion, pairKey, type MergeItem } from '../merge';

const item = (id: string, name: string, uses = 0, createdAt = 1, detail: string | null = null): MergeItem => ({ id, name, uses, createdAt, detail });

describe('duplicatePairs', () => {
  it('same sound = a candidate, Bangla and English alike', () => {
    const pairs = duplicatePairs('customer', [item('a', 'রহিম', 3), item('b', 'Rahim'), item('c', 'করিম')]);
    expect(pairs.map((p) => [p.keep.id, p.dup.id])).toEqual([['a', 'b']]);
  });

  it('keeps the busier one, then the older one', () => {
    expect(duplicatePairs('product', [item('new', 'চাল', 5, 9), item('old', 'চাল', 1, 1)])[0]).toMatchObject({ keep: { id: 'new' }, dup: { id: 'old' } });
    expect(duplicatePairs('product', [item('new', 'চাল', 0, 9), item('old', 'চাল', 0, 1)])[0]).toMatchObject({ keep: { id: 'old' }, dup: { id: 'new' } });
  });

  it('short names need nearly the same spelling (চিনি ≠ চানা)', () => {
    expect(duplicatePairs('product', [item('a', 'চিনি'), item('b', 'চানা')])).toEqual([]);
    expect(duplicatePairs('product', [item('a', 'চাল'), item('b', 'চাউল')])).toHaveLength(1);
  });

  it('customers with different phones are different people', () => {
    expect(duplicatePairs('customer', [item('a', 'রহিম', 0, 1, '01711000000'), item('b', 'রহিম', 0, 2, '01811000000')])).toEqual([]);
    expect(duplicatePairs('customer', [item('a', 'রহিম', 0, 1, '01711000000'), item('b', 'রহিম', 0, 2, null)])).toHaveLength(1);
  });

  it('three of the same: both extras against the one kept; dismissed pairs left out', () => {
    const items = [item('a', 'চাল', 3), item('b', 'চাল', 2), item('c', 'চাল', 1)];
    expect(duplicatePairs('product', items).map((p) => p.dup.id)).toEqual(['b', 'c']);
    expect(duplicatePairs('product', items, new Set([pairKey('product', 'b', 'a')])).map((p) => p.dup.id)).toEqual(['c']);
  });

  it('asks in Bangla', () => {
    const [p] = duplicatePairs('customer', [item('a', 'রহিম', 1), item('b', 'Rahim')]);
    expect(mergeQuestion(p!)).toBe('রহিম আর Rahim, এই দুইটা কি একই?');
  });
});

describe('openingAnchor with two phones', () => {
  it('two openings on the same day: the first listed (latest) stays', () => {
    const a = openingAnchor(
      [
        { date: '2026-11-12', kind: 'opening', amountPoisha: 600000 },
        { date: '2026-11-12', kind: 'opening', amountPoisha: 500000 },
      ],
      '2026-11-12',
    );
    expect(a?.amountPoisha).toBe(600000);
  });

  it('two closes of the same day: the first listed (latest) is the next opening', () => {
    const a = openingAnchor(
      [
        { date: '2026-11-12', kind: 'close', amountPoisha: 200000 },
        { date: '2026-11-12', kind: 'close', amountPoisha: 250000 },
      ],
      '2026-11-13',
    );
    expect(a).toEqual({ from: '2026-11-13', amountPoisha: 200000, source: 'close' });
  });
});
