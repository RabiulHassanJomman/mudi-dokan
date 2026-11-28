/** Android mode: said with the Ridmik keyboard's voice typing, read by the fixed formats. */
import { EXAMPLE_BN, clipUri, examplesSpeech, readSaid, sayExamples, fixedProblemWords, joinPieces, heardErrorWords, readKeyboardText, voiceRoute } from '../keyboard';
import { parseFixed } from '../../parser/fixed';

describe('which screen the 🎤 opens', () => {
  it('the keyboard screen, carrying the customer', () => {
    expect(voiceRoute('sale')).toEqual({ pathname: '/say', params: { tab: 'sale' } });
    expect(voiceRoute('ledger', { customer: 'সাজু', kind: 'joma' })).toEqual({
      pathname: '/say', params: { tab: 'ledger', customer: 'সাজু', kind: 'joma' },
    });
  });

  it('no খরচ sentence: the number pad', () => {
    expect(voiceRoute('expense')).toEqual({ pathname: '/confirm', params: { text: '', tab: 'expense' } });
  });
});

describe('reading the typed text', () => {
  it('a full sentence as it is', () => {
    expect(readKeyboardText('সাজু ৫০ টাকা জমা দিয়েছে', {})).toMatchObject({ kind: 'joma', customer: 'সাজু', amount: 50, problems: [] });
  });

  it('from a customer screen the name need not be said', () => {
    expect(readKeyboardText('৫০ টাকা জমা দিয়েছে', {}, { customer: 'সাজু' })).toMatchObject({ kind: 'joma', customer: 'সাজু', problems: [] });
    expect(readKeyboardText('বাকি নিয়েছে চাল ১০০ টাকা', {}, { customer: 'সাজু' })).toMatchObject({ kind: 'baki', customer: 'সাজু', problems: [] });
  });

  it('...but not for a নগদ sale or কেনা, and a said name wins', () => {
    expect(readKeyboardText('নগদ বিক্রি চাল ১০০ টাকা', {}, { customer: 'সাজু' }).customer).toBeUndefined();
    expect(readKeyboardText('রহিম ৫০ টাকা জমা দিয়েছে', {}, { customer: 'সাজু' }).customer).toBe('রহিম');
  });
});

describe('what to say when it is not clear', () => {
  const words = (t: string) => fixedProblemWords(parseFixed(t));
  it.each([
    ['', 'বুঝিনি। বাকি, নগদ, কেনা বা জমা — কোনটা? নমুনার মতো বলুন।'],
    ['সাজু নগদ বাকি চাল ১০০ টাকা', 'একসাথে দুই রকম বলেছেন। বাকি, নগদ, কেনা বা জমা — একটা বলুন।'],
    ['বাকি নিয়েছে চাল ১০০ টাকা', 'কার নাম বলুন।'],
    ['১০০০ টাকার কেনা হয়েছে', 'কী কী মাল, বলুন।'],
    ['১০০০ টাকার আলু আর চাল কেনা', 'একবারে একটা মাল কেনা বলুন।'],
    ['নগদ বিক্রি চাল', 'কত টাকা বলুন। যেমন: ১০০ টাকা।'],
    ['নগদ বিক্রি চাল ১০০ টাকা ডাল ৫০ টাকা', 'টাকা একবার বলুন: সব মিলিয়ে মোট কত।'],
  ])('"%s"', (text, said) => {
    expect(words(text)).toBe(said);
  });
  it('several problems: all of them', () => {
    expect(words('কেনা হয়েছে')).toBe('কী কী মাল, বলুন। কত টাকা বলুন। যেমন: ১০০ টাকা।');
    expect(words('নগদ বিক্রি')).toBe('কত টাকা বলুন। যেমন: ১০০ টাকা।');
    expect(words('বাকি নিয়েছে')).toBe('কার নাম বলুন। কত টাকা বলুন। যেমন: ১০০ টাকা।');
  });
  it('a complete sentence: nothing', () => {
    expect(words('নগদ বিক্রি চাল ১০০ টাকা')).toBe('');
  });
});

it('every tab has an example that parses', () => {
  for (const tab of ['sale', 'purchase', 'ledger'] as const) {
    for (const ex of EXAMPLE_BN[tab]) expect({ ex, problems: parseFixed(ex).problems }).toEqual({ ex, problems: [] });
  }
});

describe('listening in the app (the big 🎤, bn-BD)', () => {
  it('nothing heard: say so, and how to try again', () => {
    expect(heardErrorWords('no-speech')).toBe('কিছু শুনিনি। মাইক চেপে আবার বলুন।');
    expect(heardErrorWords('speech-timeout')).toBe('কিছু শুনিনি। মাইক চেপে আবার বলুন।');
  });

  it('no permission or no recognizer: use the keyboard', () => {
    expect(heardErrorWords('not-allowed')).toMatch(/অনুমতি/);
    expect(heardErrorWords('service-not-allowed')).toMatch(/কিবোর্ড/);
    expect(heardErrorWords('language-not-supported')).toMatch(/কিবোর্ড/);
  });

  it('no internet and other failures', () => {
    expect(heardErrorWords('network')).toMatch(/ইন্টারনেট/);
    expect(heardErrorWords('busy')).toBe('শোনা গেল না। মাইক চেপে আবার বলুন।');
  });

  it('stopped by the user: nothing to say', () => {
    expect(heardErrorWords('aborted')).toBe('');
  });
});

describe('the clip file of a listen', () => {
  it('is known before the recorder closes it (same path the library writes)', () => {
    expect(clipUri('file:///data/user/0/com.mudidokan.app/files/', 'voice_1.wav')).toBe('file:///data/user/0/com.mudidokan.app/files/voice_1.wav');
    expect(clipUri('/data/user/0/com.mudidokan.app/files', 'voice_1.wav')).toBe('file:///data/user/0/com.mudidokan.app/files/voice_1.wav');
  });
});

describe('a sentence heard in pieces (recording mode sends each pause as its own final piece)', () => {
  it('pieces join in order, with the piece still being heard last', () => {
    expect(joinPieces(['শোয়েব ভাই বাকি নিল'], 'দেড় হাজার টাকা')).toBe('শোয়েব ভাই বাকি নিল দেড় হাজার টাকা');
    expect(joinPieces(['শোয়েব ভাই বাকি নিল', 'দেড় হাজার টাকা'])).toBe('শোয়েব ভাই বাকি নিল দেড় হাজার টাকা');
    expect(joinPieces([], ' সাজু ')).toBe('সাজু');
    expect(joinPieces(['', ' '], '')).toBe('');
  });
});

describe('বলুন examples, labelled by type', () => {
  it('বিক্রি: নগদ বিক্রি, then বাকি', () => {
    expect(sayExamples('sale')).toEqual([
      { label: 'নগদ বিক্রি', text: 'নগদ বিক্রি আদা, চাল ১০০ টাকা' },
      { label: 'বাকি', text: 'সাজু বাকি নিয়েছে আদা, চাল, আটা ১০০ টাকা' },
    ]);
  });

  it('মাল: মাল কেনা', () => {
    expect(sayExamples('purchase')).toEqual([{ label: 'মাল কেনা', text: '১০০০ টাকার আলু কেনা হয়েছে' }]);
  });

  it('every tab offers হিসাব দেখা when no customer is chosen', () => {
    expect(sayExamples('sale', { lookup: true }).map((e) => e.label)).toEqual(['নগদ বিক্রি', 'বাকি', 'হিসাব দেখা']);
    expect(sayExamples('purchase', { lookup: true }).map((e) => e.label)).toEqual(['মাল কেনা', 'হিসাব দেখা']);
  });

  it('বাকি tab: বাকি, জমা, and হিসাব দেখা when no customer is chosen', () => {
    expect(sayExamples('ledger', { lookup: true }).map((e) => e.label)).toEqual(['বাকি', 'জমা', 'হিসাব দেখা']);
    expect(sayExamples('ledger', { lookup: true }).at(-1)!.text).toBe('সাজুর হিসাব');
    expect(sayExamples('ledger').map((e) => e.label)).toEqual(['বাকি', 'জমা']);
  });

  it('every label matches what the parser reads the sentence as', () => {
    const byKind = { cash_sale: 'নগদ বিক্রি', baki: 'বাকি', joma: 'জমা', purchase: 'মাল কেনা' } as const;
    for (const tab of ['sale', 'purchase', 'ledger'] as const)
      for (const ex of sayExamples(tab)) expect(ex.label).toBe(byKind[parseFixed(ex.text).kind!]);
  });

  it('read aloud: type, then the sentence', () => {
    expect(examplesSpeech(sayExamples('ledger', { lookup: true }))).toBe(
      'যেমন, বাকি: সাজু বাকি নিয়েছে আদা, চাল, আটা ১০০ টাকা। জমা: সাজু ৫০ টাকা জমা দিয়েছে। হিসাব দেখা: সাজুর হিসাব।',
    );
  });
});

describe('entry or a customer\'s হিসাব (any tab, live or read later)', () => {
  const ctx = { knownCustomers: ['সাজু', 'করিম', 'শাজু ভাই'], knownProducts: ['চাল'] };
  const aliases = { 'শাজু ভাই': 'সাজু' };

  it('a complete entry is an entry', () => {
    expect(readSaid('সাজু ৫০ টাকা জমা দিয়েছে', ctx, {}, aliases)).toMatchObject({ kind: 'entry', cmd: { kind: 'joma', customer: 'সাজু' } });
    expect(readSaid('নগদ বিক্রি ১০০ টাকা', ctx, {}, aliases).kind).toBe('entry');
  });

  it('a name alone or with হিসাব opens that customer', () => {
    expect(readSaid('সাজুর হিসাব', ctx, {}, aliases)).toMatchObject({ kind: 'lookup', customer: 'সাজু' });
    expect(readSaid('করিম', ctx, {}, aliases)).toMatchObject({ kind: 'lookup', customer: 'করিম' });
    expect(readSaid('শাজু ভাই এর বাকি কত', ctx, {}, aliases)).toMatchObject({ kind: 'lookup', customer: 'সাজু' });
  });

  it('a half entry stays a problem (what is missing is said), not a lookup', () => {
    const r = readSaid('সাজু বাকি নিয়েছে', ctx, {}, aliases);
    expect(r.kind).toBe('problem');
    expect(r.kind === 'problem' && r.words).toBeTruthy();
    expect(readSaid('রহিমের হিসাব', ctx, {}, aliases).kind).toBe('problem'); // not a customer
  });

  it('from a customer\'s screen (customer chosen) there is no lookup', () => {
    expect(readSaid('সাজুর হিসাব', ctx, { customer: 'করিম' }, aliases).kind).toBe('problem');
  });
});
