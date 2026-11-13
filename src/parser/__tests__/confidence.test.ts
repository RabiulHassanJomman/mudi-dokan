/**
 * Rule-parser confidence: "low" sends the command to the LLM (router). Low when a
 * word or number was not used by any rule, a product isn't known, or the item
 * count is uncertain.
 */
import { hybridParse, shouldEscalate } from '../router';
import { parseCommand } from '../parse';
import type { ParseContext, ParsedCommand } from '../types';

const ctx: ParseContext = {
  tab: 'sale',
  knownProducts: ['চাল', 'ডাল', 'তেল', 'সাবান', 'ডিম'],
  knownCustomers: ['করিম'],
};
const c = (t: string, x: ParseContext = ctx) => parseCommand(t, x);

describe('high confidence', () => {
  it.each([
    'চাল ২ কেজি ১২০ টাকা',
    'করিম বাকিতে নিয়েছে দুই কেজি চাল ২০০ টাকা ৩ কেজি চাল ৪০০ টাকা ৫ কেজি তেল ৬০০ টাকা',
    'চাল ২ কেজি ডাল ১ কেজি',
    '২০০ টাকা করে ৩ কেজি চাল',
    'করিম ২০০ টাকা বাকি',
    'রহিম ৫০০ টাকা জমা দিল', // a new customer is fine
    'বিদ্যুৎ বিল ৫০০ টাকা খরচ',
    'মালিক ৫০০ নিল',
    'আজ লাভ কত',
    'চাল ২ কেজি', // no known lists → nothing to check names against
  ])('%s', (t) => {
    const r = c(t);
    expect({ t, confidence: r.confidence, reasons: r.lowReasons }).toEqual({ t, confidence: 'high', reasons: undefined });
  });
  it('a verb ending (করলেন) after a known customer is not an unused word', () => {
    const r = c('কামাল সাহেব এক হাজার পাঁচশো টাকা শোধ করলেন', { ...ctx, knownCustomers: ['কামাল'] });
    expect(r).toMatchObject({ intent: 'joma', customer: 'কামাল', amount: 1500, confidence: 'high' });
  });
  it('without known products, unknown names are not held against it', () => {
    expect(c('চিংড়ি ২ কেজি', { tab: 'sale' }).confidence).toBe('high');
  });
});

describe('low confidence', () => {
  it('unmatched product', () => {
    expect(c('চিংড়ি ২ কেজি ৫০০ টাকা')).toMatchObject({ confidence: 'low', lowReasons: ['unmatched_product'] });
  });
  it('unconsumed word next to a known product (brand, no alias)', () => {
    expect(c('লাক্স সাবান দুইটা')).toMatchObject({
      confidence: 'low',
      lowReasons: ['unconsumed_word'],
      unconsumed: ['লাক্স'],
    });
  });
  it('a known name left over in a ledger entry', () => {
    expect(c('করিম চাল ২০০ টাকা বাকি')).toMatchObject({ confidence: 'low', unconsumed: ['চাল'] });
  });
  it('a second number a ledger entry did not use', () => {
    expect(c('করিম ২০০ টাকা ৩০০ টাকা বাকি')).toMatchObject({ confidence: 'low', lowReasons: ['unused_number'] });
  });
  it('a quantity dropped by an expense', () => {
    expect(c('নাস্তা ২ কেজি ১০০ টাকা খরচ')).toMatchObject({ confidence: 'low', lowReasons: ['unused_number'] });
  });
  it('item count uncertain: a line with neither quantity nor price in a basket', () => {
    expect(c('চাল ২ কেজি আর ডাল')).toMatchObject({ confidence: 'low', lowReasons: ['item_count'] });
  });
  it('item count uncertain: a stray price dropped', () => {
    expect(c('চাল ২ কেজি ১২০ টাকা ডাল ১ কেজি ১১০ টাকা ৫০ টাকা').lowReasons).toContain('item_count');
  });
  it('unknown intent', () => {
    expect(c('হ্যালো', { tab: 'ledger' })).toMatchObject({ confidence: 'low', lowReasons: ['unknown_intent'] });
  });
});

describe('router', () => {
  const fake = (out: Partial<ParsedCommand>) => jest.fn(async () => ({ ...c('x'), ...out }) as ParsedCommand);

  it('shouldEscalate = low confidence', () => {
    expect(shouldEscalate(c('চাল ২ কেজি'))).toBe(false);
    expect(shouldEscalate(c('চিংড়ি ২ কেজি'))).toBe(true);
  });

  it('high: the LLM is not called', async () => {
    const llm = fake({ intent: 'joma' });
    const r = await hybridParse('চাল ২ কেজি ১২০ টাকা', ctx, llm);
    expect(r.source).toBe('rule');
    expect(r.result.intent).toBe('sale');
    expect(llm).not.toHaveBeenCalled();
  });

  it('low: the LLM answer is used', async () => {
    const llm = fake({ intent: 'sale', items: [{ product: 'সাবান', quantity: { value: 2, unit: 'piece' } }] });
    const r = await hybridParse('লাক্স সাবান দুইটা', ctx, llm);
    expect(r.source).toBe('llm');
    expect(r.result.items).toEqual([{ product: 'সাবান', quantity: { value: 2, unit: 'piece' } }]);
    expect(llm).toHaveBeenCalledWith('লাক্স সাবান দুইটা', ctx);
  });

  it('low, but the LLM fails: falls back to the rule result', async () => {
    const r = await hybridParse('লাক্স সাবান দুইটা', ctx, async () => {
      throw new Error('offline');
    });
    expect(r).toMatchObject({ source: 'rule', llmError: 'offline' });
    expect(r.result.items?.[0]?.product).toBe('লাক্স সাবান');
  });
});
