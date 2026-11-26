/** Android mode: said with the Ridmik keyboard's voice typing, read by the fixed formats. */
import { EXAMPLE_BN, effectiveMode, fixedProblemWords, readKeyboardText, voiceRoute } from '../keyboard';
import { parseFixed } from '../../parser/fixed';

describe('which screen the 🎤 opens', () => {
  it('Android is the default; Gemini only with a key', () => {
    expect(effectiveMode(null, true)).toBe('android');
    expect(effectiveMode('gemini', true)).toBe('gemini');
    expect(effectiveMode('gemini', false)).toBe('android');
    expect(effectiveMode('android', true)).toBe('android');
  });

  it('Android mode: the keyboard screen, carrying the customer', () => {
    expect(voiceRoute('android', 'sale')).toEqual({ pathname: '/say', params: { tab: 'sale' } });
    expect(voiceRoute('android', 'ledger', { customer: 'সাজু', kind: 'joma' })).toEqual({
      pathname: '/say', params: { tab: 'ledger', customer: 'সাজু', kind: 'joma' },
    });
  });

  it('Android mode has no খরচ sentence: the number pad', () => {
    expect(voiceRoute('android', 'expense')).toEqual({ pathname: '/confirm', params: { text: '', tab: 'expense' } });
  });

  it('Gemini mode: Listening as before', () => {
    expect(voiceRoute('gemini', 'purchase')).toEqual({ pathname: '/listening', params: { tab: 'purchase' } });
    expect(voiceRoute('gemini', 'expense')).toEqual({ pathname: '/listening', params: { tab: 'expense' } });
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
    ['নগদ বিক্রি ১০০ টাকা', 'কী কী মাল, বলুন।'],
    ['১০০০ টাকার আলু আর চাল কেনা', 'একবারে একটা মাল কেনা বলুন।'],
    ['নগদ বিক্রি চাল', 'কত টাকা বলুন। যেমন: ১০০ টাকা।'],
    ['নগদ বিক্রি চাল ১০০ টাকা ডাল ৫০ টাকা', 'টাকা একবার বলুন: সব মিলিয়ে মোট কত।'],
  ])('"%s"', (text, said) => {
    expect(words(text)).toBe(said);
  });
  it('several problems: all of them', () => {
    expect(words('নগদ বিক্রি')).toBe('কী কী মাল, বলুন। কত টাকা বলুন। যেমন: ১০০ টাকা।');
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
