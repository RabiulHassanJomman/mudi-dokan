/** Android mode: the heard customer name is matched to the shop's list. */
import { matchCustomer } from '../keyboard';

const list = ['সাজু', 'আব্দুল করিম', 'রহিম', 'সুমি', 'শফিক'];

it.each([
  ['সাজু', 'সাজু'], // exact
  ['সাজুর', 'সাজু'], // case ending
  ['সাজুকে', 'সাজু'],
  ['শাজু', 'সাজু'], // sounds the same
  ['রহীম', 'রহিম'],
  ['সফিক', 'শফিক'],
  ['আবদুল করিম', 'আব্দুল করিম'], // close spelling
  ['কোরিম', 'কোরিম'], // not close enough to any one name: kept, the card asks
  ['মোস্তফা', 'মোস্তফা'], // nobody like it: a new customer, the card asks
])('%s → %s', (heard, name) => {
  expect(matchCustomer(heard, list, {})).toBe(name);
});

it('a learned alias wins', () => {
  expect(matchCustomer('কোরিম', list, { কোরিম: 'আব্দুল করিম' })).toBe('আব্দুল করিম');
});

it('two names equally close: no guess', () => {
  expect(matchCustomer('রাজু', ['সাজু', 'কাজু'], {})).toBe('রাজু');
});

it('nothing heard, nothing matched', () => {
  expect(matchCustomer(undefined, list, {})).toBeUndefined();
  expect(matchCustomer('সাজু', [], {})).toBe('সাজু');
});

describe('in a sentence', () => {
  const { readKeyboardText } = jest.requireActual('../keyboard') as typeof import('../keyboard');
  it('the heard name becomes the listed customer', () => {
    expect(readKeyboardText('শাজু বাকি ১০০ টাকা', { knownCustomers: list }).customer).toBe('সাজু');
    expect(readKeyboardText('রহীমের ৫০ টাকা জমা', { knownCustomers: list }).customer).toBe('রহিম');
  });
  it('an alias spelling in the known list resolves to its customer', () => {
    const ctx = { knownCustomers: [...list, 'কোরিম'] };
    expect(readKeyboardText('কোরিম ৫০ টাকা জমা দিয়েছে', ctx, {}, { কোরিম: 'আব্দুল করিম' }).customer).toBe('আব্দুল করিম');
  });
});
