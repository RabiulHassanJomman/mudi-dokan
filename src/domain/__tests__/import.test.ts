import { customerSpec, parseBdPhone, parseCustomerLine } from '../customerImport';
import { classifyRows, editRow, includedRows, parseImportText, toggleRow, type Candidate, type ImportSpec } from '../importer';
import { matchName, nameKey, phoneticKey } from '../names';

describe('parseBdPhone', () => {
  it.each([
    ['01711123456', '01711123456'],
    ['01711-123456', '01711123456'],
    ['017 1112 3456', '01711123456'],
    ['+8801711123456', '01711123456'],
    ['+880 1711-123456', '01711123456'],
    ['8801711123456', '01711123456'],
    ['008801711123456', '01711123456'],
    ['০১৭১১১২৩৪৫৬', '01711123456'],
    ['1711123456', '01711123456'],
  ])('%s → %s', (raw, phone) => {
    expect(parseBdPhone(raw)).toBe(phone);
  });

  it.each(['0171112345', '02123456789', '01211123456', '123'])('rejects %s', (raw) => {
    expect(parseBdPhone(raw)).toBeNull();
  });
});

describe('parseCustomerLine', () => {
  it('name only', () => {
    expect(parseCustomerLine('করিম')).toEqual({ value: { name: 'করিম', phone: null, note: null }, problems: [] });
  });

  it.each([
    ['করিম 01711123456'],
    ['করিম,01711123456'],
    ['করিম, 01711-123456'],
    ['করিম\t+8801711123456'],
    ['করিম - 017 1112 3456'],
  ])('splits name and phone: %s', (line) => {
    expect(parseCustomerLine(line).value).toEqual({ name: 'করিম', phone: '01711123456', note: null });
  });

  it('a two-word name stays whole', () => {
    expect(parseCustomerLine('আব্দুল করিম 01711123456').value.name).toBe('আব্দুল করিম');
  });

  it('honorifics go to the note, the name stays clean', () => {
    expect(parseCustomerLine('করিম ভাই 01711123456').value).toEqual({ name: 'করিম', phone: '01711123456', note: 'ভাই' });
    expect(parseCustomerLine('মিনা আপা').value).toEqual({ name: 'মিনা', phone: null, note: 'আপা' });
    expect(parseCustomerLine('Rahim bhai, 01811-222333').value).toEqual({ name: 'Rahim', phone: '01811222333', note: 'bhai' });
    expect(parseCustomerLine('চাচা রফিক').value).toEqual({ name: 'রফিক', phone: null, note: 'চাচা' });
  });

  it('text after the phone, in brackets, or after a comma is a note', () => {
    expect(parseCustomerLine('করিম 01711123456 মসজিদের পাশে').value).toEqual({ name: 'করিম', phone: '01711123456', note: 'মসজিদের পাশে' });
    expect(parseCustomerLine('করিম (বাজার রোড)').value).toEqual({ name: 'করিম', phone: null, note: 'বাজার রোড' });
    expect(parseCustomerLine('করিম ভাই, বাজার রোড').value).toEqual({ name: 'করিম', phone: null, note: 'ভাই · বাজার রোড' });
  });

  it('a bad number is a problem; the row keeps its name', () => {
    expect(parseCustomerLine('করিম 0171112345')).toEqual({
      value: { name: 'করিম', phone: null, note: '0171112345' },
      problems: ['bad_phone'],
    });
  });

  it('no name is a problem', () => {
    expect(parseCustomerLine('01711123456').problems).toEqual(['no_name']);
    expect(parseCustomerLine('ভাই').problems).toEqual(['no_name']);
  });
});

describe('names', () => {
  it('nameKey ignores case, spaces and Unicode form', () => {
    expect(nameKey('  Abdul   KARIM ')).toBe('abdul karim');
    expect(nameKey('করিম')).toBe(nameKey('করিম'));
  });

  it('phoneticKey: Bangla and English spellings of a name meet', () => {
    expect(phoneticKey('রহিম')).toBe(phoneticKey('Rahim'));
    expect(phoneticKey('করিম')).toBe(phoneticKey('Karim'));
    expect(phoneticKey('সোহেল')).toBe(phoneticKey('Shohel'));
    expect(phoneticKey('মোহাম্মদ')).toBe(phoneticKey('Muhammad'));
    expect(phoneticKey('শফিক')).toBe(phoneticKey('সফিক'));
    expect(phoneticKey('জসিম')).toBe(phoneticKey('Josim'));
    expect(phoneticKey('করিম')).not.toBe(phoneticKey('রহিম'));
  });

  const known: Candidate[] = [
    { name: 'করিম', aliases: [], phone: '01711123456', label: 'আছে' },
    { name: 'চাল', aliases: ['চাউল'], phone: null, label: 'আছে' },
    { name: 'আব্দুর রহমান', aliases: [], phone: null, label: 'আছে' },
  ];

  it('exact → alias → phone → phonetic → fuzzy, in that order', () => {
    expect(matchName('করিম', null, known)).toMatchObject({ how: 'exact', candidate: { name: 'করিম' } });
    expect(matchName('চাউল', null, known)).toMatchObject({ how: 'alias', candidate: { name: 'চাল' } });
    expect(matchName('কালাম', '01711123456', known)).toMatchObject({ how: 'phone', candidate: { name: 'করিম' } });
    expect(matchName('Karim', null, known)).toMatchObject({ how: 'phonetic', candidate: { name: 'করিম' } });
    expect(matchName('আব্দুল রহমান', null, known)).toMatchObject({ how: 'fuzzy', candidate: { name: 'আব্দুর রহমান' } });
    expect(matchName('জামাল', null, known)).toBeNull();
  });
});

describe('import preview (generic)', () => {
  const existing: Candidate[] = [
    { name: 'করিম', aliases: [], phone: '01711123456', label: 'আগে থেকে' },
    { name: 'মিনা', aliases: [], phone: null, label: 'আগে থেকে' },
  ];
  const text = '﻿রহিম 01811222333\n\nকরিম\nKarim bhai\nরহিম\n  \nজামাল 0171\nসেলিম\n01999888777\n';

  it('parses lines (BOM, blanks skipped), marks each against the shop and earlier lines', () => {
    const rows = classifyRows(parseImportText(text, customerSpec), existing, customerSpec);
    expect(rows.map((r) => [r.line, r.value.name, r.status, r.match?.candidate.label ?? null, r.include])).toEqual([
      [1, 'রহিম', 'new', null, true],
      [3, 'করিম', 'exists', 'আগে থেকে', false],
      [4, 'Karim', 'maybe', 'আগে থেকে', false],
      [5, 'রহিম', 'exists', 'লাইন ১', false],
      [7, 'জামাল', 'new', null, true],
      [8, 'সেলিম', 'new', null, true],
      [9, '', 'invalid', null, false],
    ]);
    expect(rows.find((r) => r.line === 7)!.problems).toEqual(['bad_phone']);
    expect(includedRows(rows).map((r) => r.value.name)).toEqual(['রহিম', 'জামাল', 'সেলিম']);
  });

  it('toggle includes a maybe row; an invalid row can’t be included', () => {
    let rows = classifyRows(parseImportText(text, customerSpec), existing, customerSpec);
    rows = toggleRow(rows, 4, customerSpec);
    expect(rows.find((r) => r.line === 4)!.include).toBe(true);
    rows = toggleRow(rows, 9, customerSpec);
    expect(rows.find((r) => r.line === 9)!.include).toBe(false);
  });

  it('editing a name re-checks it; a choice the user made is kept', () => {
    let rows = classifyRows(parseImportText(text, customerSpec), existing, customerSpec);
    rows = toggleRow(rows, 8, customerSpec); // user skips সেলিম
    rows = editRow(rows, 4, { name: 'কালু', phone: null, note: 'bhai' }, existing, customerSpec);
    expect(rows.find((r) => r.line === 4)).toMatchObject({ status: 'new', include: true, value: { name: 'কালু' } });
    expect(rows.find((r) => r.line === 8)!.include).toBe(false);
    rows = editRow(rows, 9, { name: 'নতুন নাম', phone: '01999888777', note: null }, existing, customerSpec);
    expect(rows.find((r) => r.line === 9)).toMatchObject({ status: 'new', include: true, problems: [] });
  });

  it('works for another kind (products later): any spec with a name', () => {
    const spec: ImportSpec<{ name: string; price: number | null }> = {
      parseLine: (raw) => {
        const [name = '', price] = raw.split(',').map((s) => s.trim());
        return { value: { name, price: price ? Number(price) : null }, problems: name ? [] : ['no_name'] };
      },
      nameOf: (v) => v.name,
    };
    const rows = classifyRows(parseImportText('চাউল, 60\nডাল, 120', spec), [{ name: 'চাল', aliases: ['চাউল'], phone: null, label: 'আছে' }], spec);
    expect(rows.map((r) => [r.value.name, r.status, r.match?.how ?? null])).toEqual([
      ['চাউল', 'exists', 'alias'],
      ['ডাল', 'new', null],
    ]);
  });
});

describe('customer aliases (pure)', () => {
  const { customerAliasToLearn, resolveCustomerAlias } = jest.requireActual('../customers') as typeof import('../customers');
  const known = ['করিম', 'মিনা'];

  it('resolve: a known alias → the customer', () => {
    expect(resolveCustomerAlias('কোরিম', { কোরিম: 'করিম' })).toBe('করিম');
    expect(resolveCustomerAlias('রহিম', { কোরিম: 'করিম' })).toBe('রহিম');
    expect(resolveCustomerAlias(undefined, {})).toBeUndefined();
  });

  it('learn: heard name corrected to / picked as an existing customer', () => {
    expect(customerAliasToLearn('কোরিম', 'করিম', known, {})).toBe('কোরিম');
    expect(customerAliasToLearn('করিম', 'করিম', known, {})).toBeNull(); // nothing corrected
    expect(customerAliasToLearn('কোরিম', 'জামাল', known, {})).toBeNull(); // new customer
    expect(customerAliasToLearn('মিনা', 'করিম', known, {})).toBeNull(); // another person
    expect(customerAliasToLearn('কোরিম', 'করিম', known, { কোরিম: 'করিম' })).toBeNull(); // already learned
    expect(customerAliasToLearn(null, 'করিম', known, {})).toBeNull(); // nothing heard (number pad)
  });
});
