import { parseCommand } from '../../parser';
import type { ParsedCommand } from '../../parser/types';
import { promptContext, topProducts } from '../context';
import { engineMatch, engineStats, type EngineRow } from '../stats';

const ctx = { knownProducts: ['চাল', 'তেল', 'ডিম'], knownCustomers: ['করিম'] };
const rule = (t: string) => parseCommand(t, { tab: 'sale', ...ctx });

const sale = (product: string, q: number, total?: number): ParsedCommand => ({
  intent: 'sale', confidence: 'high', missing: [], raw: '', normalized: '', product, quantity: { value: q, unit: 'kg' },
  ...(total !== undefined ? { amount: total } : {}),
  items: [{ product, quantity: { value: q, unit: 'kg' }, ...(total !== undefined ? { total, unitPrice: total / q, priceUnit: 'kg' as const, priceKind: 'total' as const } : {}) }],
});
const saved = (product: string, q: number, taka: number) =>
  JSON.stringify({ credit: false, customer: null, total_poisha: taka * 100, items: [{ product, quantity: q, unit: 'kg', price_poisha: (taka / q) * 100, amount_poisha: taka * 100, price_mode: 'total' }] });

function row(over: Partial<EngineRow>): EngineRow {
  return {
    transcript: 'চাল ২ কেজি ১২০ টাকা', context_tab: 'sale', parsed_json: null, outcome: 'pending', edits_json: null, final_json: null,
    via: null, engine: 'both', parsed_by: 'android', android_json: null, gemini_json: null, gemini_error: null, gemini_ms: null,
    gemini_prompt_tokens: null, gemini_audio_tokens: null, gemini_output_tokens: null, gemini_thought_tokens: null, ...over,
  };
}

describe('engineMatch: which engine matched the confirmed entry', () => {
  it('both right when both said what was saved unchanged', () => {
    const a = rule('চাল ২ কেজি ১২০ টাকা');
    const r = row({ parsed_json: JSON.stringify(a), android_json: JSON.stringify(a), gemini_json: JSON.stringify(sale('চাল', 2, 120)), outcome: 'saved', final_json: saved('চাল', 2, 120) });
    expect(engineMatch(r)).toEqual({ android: true, gemini: true });
  });

  it('Android heard ৩ kg, the shopkeeper fixed it to ২; Gemini had ২ kg', () => {
    const a = rule('চাল ৩ কেজি ১২০ টাকা');
    const r = row({
      parsed_json: JSON.stringify(a), android_json: JSON.stringify(a), gemini_json: JSON.stringify(sale('চাল', 2, 120)),
      outcome: 'saved_edited', edits_json: '["items[0].quantity"]', final_json: saved('চাল', 2, 120),
    });
    expect(engineMatch(r)).toEqual({ android: false, gemini: true });
  });

  it('gemini mode: the card showed Gemini’s result; Android’s rule parse is scored too', () => {
    const g = sale('চাল', 2, 120);
    const r = row({
      engine: 'gemini', parsed_by: 'gemini', parsed_json: JSON.stringify(g), gemini_json: JSON.stringify(g),
      android_json: JSON.stringify(rule('চা ২ কেজি')), outcome: 'saved', final_json: saved('চাল', 2, 120),
    });
    expect(engineMatch(r)).toEqual({ android: false, gemini: true });
  });

  it('nothing to score: cancelled, or no Gemini result yet', () => {
    const a = rule('চাল ২ কেজি ১২০ টাকা');
    expect(engineMatch(row({ parsed_json: JSON.stringify(a), outcome: 'cancelled' }))).toEqual({ android: null, gemini: null });
    expect(engineMatch(row({ parsed_json: JSON.stringify(a), outcome: 'saved', final_json: saved('চাল', 2, 120) }))).toEqual({ android: true, gemini: null });
  });
});

describe('engineStats', () => {
  it('agreement, ✅ % per engine, latency and tokens over Gemini’s answers', () => {
    const a = rule('চাল ২ কেজি ১২০ টাকা');
    const wrong = rule('চাল ৩ কেজি ১২০ টাকা');
    const rows = [
      row({ parsed_json: JSON.stringify(a), android_json: JSON.stringify(a), gemini_json: JSON.stringify(sale('চাল', 2, 120)), outcome: 'saved', final_json: saved('চাল', 2, 120), gemini_ms: 1000, gemini_prompt_tokens: 900, gemini_audio_tokens: 100, gemini_output_tokens: 50, gemini_thought_tokens: 10 }),
      row({ parsed_json: JSON.stringify(wrong), android_json: JSON.stringify(wrong), gemini_json: JSON.stringify(sale('চাল', 2, 120)), outcome: 'saved_edited', edits_json: '["items[0].quantity"]', final_json: saved('চাল', 2, 120), gemini_ms: 2000, gemini_prompt_tokens: 1100, gemini_audio_tokens: 140, gemini_output_tokens: 70, gemini_thought_tokens: 20 }),
      row({ parsed_json: JSON.stringify(a), android_json: JSON.stringify(a), gemini_error: 'timeout: no answer in 8000 ms', gemini_ms: 8000, outcome: 'saved', final_json: saved('চাল', 2, 120) }),
      row({ parsed_json: JSON.stringify(a), engine: 'android' }), // not asked
    ];
    expect(engineStats(rows)).toEqual({
      asked: 3, geminiOk: 2, geminiFailed: 1,
      compared: 2, agreed: 1,
      androidScored: 3, androidRight: 2,
      geminiScored: 2, geminiRight: 2,
      avgMs: 1500, avgPromptTokens: 1000, avgAudioTokens: 120, avgOutputTokens: 60, avgThoughtTokens: 15,
    });
  });

  it('empty day', () => {
    expect(engineStats([])).toMatchObject({ asked: 0, avgMs: null, compared: 0 });
  });
});

describe('prompt context', () => {
  const catalog = ['চাল', 'তেল', 'ডিম', 'সাবান', 'চিনি'].map((name) => ({ name, unit: 'kg' as const, aliases: name === 'চাল' ? ['চাউল'] : [] }));

  it('without a transcript: the given order (most sold first), at most 15', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ name: `মাল${i}`, unit: 'piece' as const, aliases: [] }));
    expect(topProducts(many, null).map((p) => p.name)).toEqual(many.slice(0, 15).map((p) => p.name));
  });

  it('with the Android transcript: closest names (or aliases) first', () => {
    expect(topProducts(catalog, 'চিনি এক কেজি', 2).map((p) => p.name)).toEqual(['চিনি', 'চাল']);
    expect(topProducts(catalog, 'চাউল দুই কেজি', 1).map((p) => p.name)).toEqual(['চাল']);
  });

  it('caps customers at 15 and keeps the device', () => {
    const c = promptContext({ tab: 'ledger', catalog, customers: Array.from({ length: 30 }, (_, i) => `ক${i}`), hint: null, device: { name: 'আব্বু', role: null } });
    expect(c.customers).toHaveLength(15);
    expect(c.device).toEqual({ name: 'আব্বু', role: null });
  });
});
