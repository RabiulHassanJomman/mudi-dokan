import { parseCommand } from '../../parser';
import { fixtureKey, type Seed } from '../types';
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
    expect(f.status).toBeUndefined();
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

  it('a price nobody said but the user typed: left out, status review', () => {
    const f = fixture(
      log('চাল দুই কেজি', { credit: false, customer: null, total_poisha: 13000, items: [line('চাল', 2, 'kg', 6500)] }, { outcome: 'saved_edited', edits: ['items[0].pricePoisha'] }),
    );
    expect(f.expected.items).toEqual([{ product: 'চাল', quantity: { value: 2, unit: 'kg' } }]);
    expect(f.status).toBe('review');
    expect(f.review_notes).toEqual(['items[0].price']);
  });

  it('saved lines that do not line up with the parse: status review', () => {
    const f = fixture(
      log('চাল দুই কেজি', { credit: false, customer: null, total_poisha: 0, items: [line('চাল', 2, 'kg', 6000), line('ডাল', 1, 'kg', 11000)] }),
    );
    expect(f.status).toBe('review');
    expect(f.review_notes).toContain('item_count');
    expect(f.expected.items).toHaveLength(2);
  });

  it.each([
    ['cancelled', { outcome: 'cancelled' }, 'not_saved'],
    ['an unsupported sale (no such thing, but not labelled)', { outcome: 'unsupported' }, 'not_saved'],
    ['pending (left the confirm card)', { outcome: 'pending' }, 'not_saved'],
    ['empty transcript', { transcript: '  ' }, 'no_transcript'],
    ['STT marked wrong', { stt_ok: false }, 'stt_wrong'],
    ['picked on ছবি দেখে (nothing was parsed)', { via: 'pick' }, 'picked'],
    ['no saved result', { saved: undefined }, 'no_result'],
  ] as const)('skips %s', (_name, more, reason) => {
    const base = log('চাল দুই কেজি', { credit: false, customer: null, total_poisha: 12000, items: [line('চাল', 2, 'kg', 6000)] });
    expect(fixtureFromLog({ ...base, ...more })).toEqual({ skip: reason });
  });

  const entryLog = (text: string, saved: Record<string, unknown>, more: Partial<PilotLog> = {}): PilotLog => ({
    id: 'e1', source: 'voice', tab: 'sale', transcript: text, parsed: parseCommand(text, { tab: 'sale' }), outcome: 'saved',
    saved: { item: null, person: null, note: null, purchase: null, customer: null, ...saved } as never, ...more,
  });

  it('saved non-sale (step 4a): scored fixture, expected = the parse with the edits applied', () => {
    const f = fixture(entryLog('করিম ৫০০ টাকা বাকি', { intent: 'baki', customer: 'করিম', amount: 500 }));
    expect(f).toMatchObject({ source: 'pilot', edited: false, expected: { intent: 'baki', customer: 'করিম', amount: 500 } });
    expect(f.status).toBeUndefined();
  });

  it('saved non-sale, user corrected the name and the kind: those come from what was saved', () => {
    const f = fixture(
      entryLog('কোরিম ৫০০ টাকা বাকি', { intent: 'joma', customer: 'করিম', amount: 500 }, { outcome: 'saved_edited', edits: ['kind', 'customerName'] }),
    );
    expect(f).toMatchObject({ edited: true, expected: { intent: 'joma', customer: 'করিম', amount: 500 } });
    expect(f.status).toBeUndefined();
  });

  it('saved expense / withdrawal / purchase keep their own fields', () => {
    expect(fixture(entryLog('বিদ্যুৎ বিল ৫০০ টাকা খরচ', { intent: 'expense', item: 'বিদ্যুৎ বিল', amount: 500 })).expected).toEqual({
      intent: 'expense', item: 'বিদ্যুৎ বিল', amount: 500,
    });
    expect(fixture(entryLog('মালিক ৫০০ নিল', { intent: 'owner_withdrawal', person: 'মালিক', amount: 500 })).expected).toEqual({
      intent: 'owner_withdrawal', person: 'মালিক', amount: 500,
    });
    // purchase: only what was said (no total was said here)
    expect(fixture(entryLog('নতুন চাল ৫০ কেজি কেনা ৫৫ বেচা ৬০', { intent: 'purchase', amount: 2750 })).expected).toEqual({ intent: 'purchase' });
  });

  it('a field the user filled where nothing was parsed is ambiguous → review', () => {
    const noName = fixture(entryLog('৫০০ টাকা জমা', { intent: 'joma', customer: 'করিম', amount: 500 }, { outcome: 'saved_edited', edits: ['customerName'] }));
    expect(noName).toMatchObject({ status: 'review', review_notes: ['customer'], expected: { intent: 'joma', amount: 500, customer: 'করিম' } });
    const pad = fixture(
      entryLog('করিমের নামে', { intent: 'baki', customer: 'করিম', amount: 300 }, { tab: 'ledger', parsed: parseCommand('করিমের নামে', { tab: 'ledger' }), outcome: 'saved_edited', edits: ['kind', 'amountPoisha'] }),
    );
    expect(pad.status).toBe('review');
    expect(pad.review_notes).toEqual(['intent', 'amount']);
  });

  it.each([
    ['করিম ৫০০ টাকা বাকি', 'baki', { customer: 'করিম', amount: 500 }],
    ['রহিম ২০০ টাকা জমা দিল', 'joma', { customer: 'রহিম', amount: 200 }],
    ['বিদ্যুৎ বিল ৫০০ টাকা খরচ', 'expense', { amount: 500 }],
    ['মালিক ৫০০ নিল', 'owner_withdrawal', { amount: 500 }],
  ] as const)('non-sale "%s" (%s): status review, draft = the parse', (text, intent, fields) => {
    const l: PilotLog = { id: 'u1', source: 'voice', tab: 'sale', transcript: text, parsed: parseCommand(text, { tab: 'sale' }), outcome: 'unsupported' };
    const f = fixture(l);
    expect(f).toMatchObject({ text, source: 'pilot', pilot_id: 'u1', status: 'review', review_notes: [`unconfirmed: ${intent}`] });
    expect(f.expected).toMatchObject({ intent, ...fields });
    expect(f.edited).toBeUndefined();
  });

  it('non-sale with no parse at all: draft intent unknown', () => {
    const f = fixture({ id: 'u2', transcript: 'হুম', outcome: 'unsupported' });
    expect(f.expected).toEqual({ intent: 'unknown' });
    expect(f.status).toBe('review');
  });

  it('non-sale with STT marked wrong is still skipped', () => {
    expect(fixtureFromLog({ transcript: 'করিম ৫০০ বাকি', parsed: { intent: 'baki' }, outcome: 'unsupported', stt_ok: false })).toEqual({ skip: 'stt_wrong' });
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
