import { parseCommand } from '../../src/parser';
import { fixtureKey, type Seed } from '../eval-types';
import { fixtureFromLog, readPilotLogs, seedAdditions, type PilotLog, type SavedItem } from '../pilot-fixtures';

const line = (product: string, quantity: number, unit: SavedItem['unit'], pricePoisha: number, extra: Partial<SavedItem> = {}): SavedItem => ({
  product,
  quantity,
  unit,
  price_poisha: pricePoisha,
  amount_poisha: Math.round(quantity * pricePoisha),
  price_mode: 'total',
  ...extra,
});

/** A log as the app writes it: the real parse of the transcript plus what was saved. */
const log = (transcript: string, saved: PilotLog['saved'], more: Partial<PilotLog> = {}): PilotLog => ({
  id: 'log-1',
  source: 'voice',
  tab: 'sale',
  transcript,
  parsed: parseCommand(transcript, { tab: 'sale' }),
  outcome: 'saved',
  saved,
  ...more,
});

const fixture = (l: PilotLog) => {
  const r = fixtureFromLog(l);
  if (!('fixture' in r)) throw new Error(`skipped: ${r.skip}`);
  return r.fixture;
};

describe('pilot log → fixture', () => {
  it('accepted as parsed: expected = the parse (spoken units kept, not the saved kg)', () => {
    const f = fixture(
      log('৫০০ গ্রাম ডাল আর চাল দুই কেজি ২০০ টাকা', {
        credit: false,
        customer: null,
        total_poisha: 25500,
        items: [line('ডাল', 0.5, 'kg', 11000), line('চাল', 2, 'kg', 10000)],
      }),
    );
    expect(f).toEqual({
      text: '৫০০ গ্রাম ডাল আর চাল দুই কেজি ২০০ টাকা',
      tab: 'sale',
      source: 'pilot',
      pilot_id: 'log-1',
      edited: false,
      expected: {
        intent: 'sale',
        // ডাল's price came from the DB, not the speaker: no total, so no basket amount
        items: [
          { product: 'ডাল', quantity: { value: 500, unit: 'g' } },
          { product: 'চাল', quantity: { value: 2, unit: 'kg' }, total: 200 },
        ],
      },
    });
  });

  it('per-unit price keeps unitPrice; a spoken total does not get one', () => {
    const f = fixture(
      log('তেল ২ লিটার ১৭০ টাকা করে', { credit: false, customer: null, total_poisha: 34000, items: [line('তেল', 2, 'litre', 17000, { price_mode: 'unit' })] }),
    );
    expect(f.expected).toEqual({
      intent: 'sale',
      items: [{ product: 'তেল', quantity: { value: 2, unit: 'litre' }, unitPrice: 170, total: 340 }],
      amount: 340,
    });
  });

  it('price-only line ("১০০ টাকার চিনি"): no quantity even though the app worked one out', () => {
    const f = fixture(log('১০০ টাকার চিনি', { credit: false, customer: null, total_poisha: 10000, items: [line('চিনি', 0.77, 'kg', 13000, { amount_poisha: 10000 })] }));
    expect(f.expected.items).toEqual([{ product: 'চিনি', total: 100 }]);
    expect(f.expected.amount).toBe(100);
  });

  it('edited: the edited fields take the saved values, removed lines are dropped', () => {
    const f = fixture(
      log(
        'চাল দুই কেজি ডাল এক কেজি',
        { credit: true, customer: 'করিম', total_poisha: 18000, items: [line('চাল', 3, 'kg', 6000)] },
        { outcome: 'saved_edited', edits: ['items[0].quantity', 'items[1].removed', 'credit', 'customerName'] },
      ),
    );
    expect(f.edited).toBe(true);
    expect(f.review).toBeUndefined();
    expect(f.expected).toEqual({ intent: 'sale', customer: 'করিম', credit: true, items: [{ product: 'চাল', quantity: { value: 3, unit: 'kg' } }] });
  });

  it('a corrected product name is taken from what was saved', () => {
    const f = fixture(
      log('পিয়াজ এক কেজি', { credit: false, customer: null, total_poisha: 8000, items: [line('পেঁয়াজ', 1, 'kg', 8000)] }, { outcome: 'saved_edited', edits: ['items[0].productName'] }),
    );
    expect(f.expected.items).toEqual([{ product: 'পেঁয়াজ', quantity: { value: 1, unit: 'kg' } }]);
  });

  it('edited quantity with a spoken total: total from the saved line', () => {
    const f = fixture(
      log('চাল দুই কেজি ২০০ টাকা', { credit: false, customer: null, total_poisha: 30000, items: [line('চাল', 3, 'kg', 10000)] }, { outcome: 'saved_edited', edits: ['items[0].quantity'] }),
    );
    expect(f.expected).toEqual({ intent: 'sale', items: [{ product: 'চাল', quantity: { value: 3, unit: 'kg' }, total: 300 }], amount: 300 });
  });

  it('a price nobody said but the user typed: left out and marked for review', () => {
    const f = fixture(
      log('চাল দুই কেজি', { credit: false, customer: null, total_poisha: 13000, items: [line('চাল', 2, 'kg', 6500)] }, { outcome: 'saved_edited', edits: ['items[0].pricePoisha'] }),
    );
    expect(f.expected.items).toEqual([{ product: 'চাল', quantity: { value: 2, unit: 'kg' } }]);
    expect(f.review).toEqual(['items[0].price']);
  });

  it('saved lines that do not line up with the parse are marked for review', () => {
    const f = fixture(
      log('চাল দুই কেজি', { credit: false, customer: null, total_poisha: 0, items: [line('চাল', 2, 'kg', 6000), line('ডাল', 1, 'kg', 11000)] }),
    );
    expect(f.review).toContain('item_count');
    expect(f.expected.items).toHaveLength(2);
  });

  it.each([
    ['cancelled', { outcome: 'cancelled' }, 'not_saved'],
    ['unsupported', { outcome: 'unsupported' }, 'not_saved'],
    ['empty transcript', { transcript: '  ' }, 'no_transcript'],
    ['STT marked wrong', { stt_ok: false }, 'stt_wrong'],
    ['no saved result', { saved: undefined }, 'no_result'],
  ] as const)('skips %s', (_name, more, reason) => {
    const base = log('চাল দুই কেজি', { credit: false, customer: null, total_poisha: 12000, items: [line('চাল', 2, 'kg', 6000)] });
    expect(fixtureFromLog({ ...base, ...more })).toEqual({ skip: reason });
  });

  it('keeps the tab; an unknown tab falls back to sale', () => {
    const saved = { credit: false, customer: null, total_poisha: 12000, items: [line('চাল', 2, 'kg', 6000)] };
    expect(fixture(log('চাল দুই কেজি', saved, { tab: 'stock' })).tab).toBe('stock');
    expect(fixture(log('চাল দুই কেজি', saved, { tab: null })).tab).toBe('sale');
  });
});

describe('reading the export', () => {
  const a = { id: 'a', transcript: 'চাল' };
  const b = { id: 'b', transcript: 'ডাল' };
  it('the app export (one JSON object with logs)', () => {
    expect(readPilotLogs(JSON.stringify({ app: 'mudi-dokan', logs: [a, b] }, null, 1))).toEqual([a, b]);
  });
  it('JSONL of logs or of exports', () => {
    expect(readPilotLogs(`${JSON.stringify(a)}\n\n${JSON.stringify({ logs: [b] })}\n`)).toEqual([a, b]);
  });
  it('a bad line says which', () => {
    expect(() => readPilotLogs(`${JSON.stringify(a)}\n{oops`)).toThrow('line 2');
  });
});

describe('dedupe key and seed additions', () => {
  it('same text + tab regardless of spacing', () => {
    expect(fixtureKey(' চাল  দুই কেজি ', 'sale')).toBe(fixtureKey('চাল দুই কেজি', 'sale'));
    expect(fixtureKey('চাল দুই কেজি', 'sale')).not.toBe(fixtureKey('চাল দুই কেজি', 'purchase'));
  });

  it('adds confirmed products and customers the seed lacks', () => {
    const seed: Seed = { products: [{ name: 'চাল', unit: 'kg', price: 60 }], customers: ['করিম'], aliases: {} };
    const l = log('মিনু দুই প্যাকেট নুডলস বাকিতে নিল চাল এক কেজি', {
      credit: true,
      customer: 'মিনু',
      total_poisha: 0,
      items: [line('নুডলস', 2, 'packet', 2500, { new_product: true }), line('চাল', 1, 'kg', 6000)],
    });
    const f = fixture(l);
    expect(seedAdditions(seed, [f], [l])).toEqual({ products: [{ name: 'নুডলস', unit: 'packet', price: 25 }], customers: ['মিনু'] });
    // a log that was not imported (duplicate) adds nothing
    expect(seedAdditions(seed, [], [l])).toEqual({ products: [], customers: [] });
  });
});
