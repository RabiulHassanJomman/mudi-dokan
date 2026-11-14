import { customerSpec } from '../../domain/customerImport';
import { classifyRows, editRow, type Candidate } from '../../domain/importer';
import { applyTidyHints, buildTidyRequest, convertTidy, tidyCustomers, tidyRows, TIDY_BATCH } from '../tidy';
import { fakeTime, mockFetch } from './mock';

const existing: Candidate[] = [
  { name: 'করিম', aliases: [], phone: '01711123456', label: 'আগে থেকে' },
  { name: 'মিনা আক্তার', aliases: [], phone: null, label: 'আগে থেকে' },
];

describe('tidy request', () => {
  it('sends the raw lines numbered and the shop’s customer names, asks for JSON with the tidy schema', () => {
    const req = buildTidyRequest('gemini-3.5-flash-lite', ['Rahim bhai 01811-222333', 'korim'], [
      { name: 'করিম', aliases: ['কোরিম'] },
      { name: 'মিনা আক্তার', aliases: [] },
    ]) as {
      systemInstruction: { parts: { text: string }[] };
      contents: { parts: { text: string }[] }[];
      generationConfig: { temperature: number; responseMimeType: string; responseJsonSchema: { type: string; items: { required: string[] } } };
    };
    const text = req.contents.at(-1)!.parts[0]!.text;
    expect(text).toContain('1: Rahim bhai 01811-222333\n2: korim');
    expect(text).toContain('existing customers: করিম (also: কোরিম), মিনা আক্তার');
    expect(req.generationConfig).toMatchObject({ temperature: 0, responseMimeType: 'application/json' });
    expect(req.generationConfig.responseJsonSchema.type).toBe('array');
    expect(req.generationConfig.responseJsonSchema.items.required).toEqual(['name_bn', 'phone', 'note', 'maybe_same_as']);
    expect(req.systemInstruction.parts[0]!.text).toMatch(/never invent/i);
  });
});

describe('convertTidy: checked like a parsed line', () => {
  it('keeps Gemini’s Bangla name; the phone must pass the BD check', () => {
    const out = convertTidy([
      { name_bn: 'রহিম', phone: '01811-222333', note: 'ভাই', maybe_same_as: null },
      { name_bn: 'করিম', phone: null, note: null, maybe_same_as: 'করিম' },
      { name_bn: 'সেলিম', phone: '12345', note: null, maybe_same_as: null },
      { name_bn: '  ', phone: null, note: null, maybe_same_as: null },
    ]);
    expect(out.map((o) => o.value)).toEqual([
      { name: 'রহিম', phone: '01811222333', note: 'ভাই' },
      { name: 'করিম', phone: null, note: null },
      { name: 'সেলিম', phone: null, note: '12345' },
      { name: '', phone: null, note: null },
    ]);
    expect(out.map((o) => o.problems)).toEqual([[], [], ['bad_phone'], ['no_name']]);
    expect(out[1]!.hint).toBe('করিম');
  });

  it.each([['not a list', { name_bn: 'রহিম' }], ['item not an object', ['রহিম']], ['name not text', [{ name_bn: 5, phone: null, note: null, maybe_same_as: null }]]])(
    'rejects %s',
    (_, json) => {
      expect(() => convertTidy(json)).toThrow();
    },
  );
});

describe('hints', () => {
  it('a "new" row Gemini thinks is an existing customer becomes "সম্ভবত একই" (not added by default)', () => {
    const tidy = convertTidy([
      { name_bn: 'মিনা', phone: null, note: null, maybe_same_as: 'মিনা আক্তার' },
      { name_bn: 'জামাল', phone: null, note: null, maybe_same_as: 'কেউ না' },
    ]);
    const rows = applyTidyHints(classifyRows(tidy.map((t, i) => ({ line: i + 1, raw: t.value.name, value: t.value, problems: t.problems, status: 'new', match: null, include: false, chosen: false })), existing, customerSpec), tidy, existing);
    expect(rows.map((r) => [r.value.name, r.status, r.match?.how ?? null, r.match?.candidate.name ?? null, r.include])).toEqual([
      ['মিনা', 'maybe', 'ai', 'মিনা আক্তার', false],
      ['জামাল', 'new', null, null, true],
    ]);
    // the user fixes the name: the normal check runs again, hints too
    const edited = applyTidyHints(editRow(rows, 2, { name: 'করিম', phone: null, note: null }, existing, customerSpec), tidy, existing);
    expect(edited[1]).toMatchObject({ status: 'exists', match: { how: 'exact' } });
  });
});

describe('tidyCustomers', () => {
  it('sends lines in batches and joins the answers in order', async () => {
    const lines = Array.from({ length: TIDY_BATCH + 3 }, (_, i) => `name${i}`);
    const answer = (n: number, from: number) =>
      Array.from({ length: n }, (_, i) => ({ name_bn: `নাম${from + i}`, phone: null, note: null, maybe_same_as: null }));
    const { fetch, calls } = mockFetch([{ answer: answer(TIDY_BATCH, 0) }, { answer: answer(3, TIDY_BATCH) }]);
    const t = fakeTime();
    const r = await tidyCustomers({ apiKey: 'k', fetch, now: t.now, sleep: t.sleep }, lines, [{ name: 'করিম', aliases: [] }]);
    expect(calls).toHaveLength(2);
    expect(r.ok).toBe(true);
    expect(r.rows.map((x) => x.value.name)).toEqual([...answer(TIDY_BATCH, 0), ...answer(3, TIDY_BATCH)].map((a) => a.name_bn));
    expect(r.usage.outputTokens).toBe(120);
  });

  it('any failed batch = failure; the preview keeps the parsed rows', async () => {
    const { fetch } = mockFetch([{ status: 400 }]);
    const r = await tidyCustomers({ apiKey: 'k', fetch }, ['Rahim'], []);
    expect(r).toMatchObject({ ok: false, rows: [] });
    expect(!r.ok && r.error).toMatch(/HTTP 400/);
  });

  it('an answer much longer than the input is refused (made-up rows)', async () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ name_bn: `নাম${i}`, phone: null, note: null, maybe_same_as: null }));
    const { fetch } = mockFetch([{ answer: many }]);
    const r = await tidyCustomers({ apiKey: 'k', fetch }, ['Rahim', 'Karim'], []);
    expect(r).toMatchObject({ ok: false });
    expect(!r.ok && r.error).toMatch(/too many/);
  });
});

describe('hints through aliases', () => {
  it('maybe_same_as naming an alias points at its customer', () => {
    const shop: Candidate[] = [{ name: 'করিম', aliases: ['কোরিম'], phone: null, label: 'আগে থেকে' }];
    // a nickname our own check can't link; Gemini names the alias
    const tidy = convertTidy([{ name_bn: 'বাবলু', phone: null, note: null, maybe_same_as: 'কোরিম' }]);
    const rows = applyTidyHints(classifyRows(tidyRows(tidy), shop, customerSpec), tidy, shop);
    expect(rows[0]).toMatchObject({ status: 'maybe', match: { how: 'ai', candidate: { name: 'করিম' } }, include: false });
  });
});
