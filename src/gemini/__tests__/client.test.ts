import { BACKOFF_503_MS, DEFAULT_MODEL, generate, retryDelayMs } from '../client';
import { geminiParse } from '../index';
import type { PromptContext } from '../prompt';
import { USAGE, fakeTime, mockFetch } from './mock';

const ctx: PromptContext = {
  tab: 'sale',
  products: [{ name: 'চাল', unit: 'kg', aliases: ['চাউল'] }],
  customers: ['করিম'],
  device: { name: 'আব্বু', role: 'owner' },
};
const audio = { audio: { mimeType: 'audio/wav', base64: 'UklGRg==' } };
const names = { knownProducts: ['চাল'], productAliases: { চাউল: 'চাল' } };
const SALE = {
  transcript: 'চাউল দুই কেজি একশো বিশ টাকা',
  intent: 'sale', customer: null, credit: false, amount: 999, item: null, person: null, note: null,
  items: [{ product: 'চাউল', quantity: 2, unit: 'kg', unitPrice: null, total: 120 }],
};

describe('generate (REST generateContent)', () => {
  it('sends the clip inline, the key in a header, temperature 0, JSON schema, minimal thinking', async () => {
    const { fetch, calls } = mockFetch([{ answer: SALE }]);
    const r = await generate({ apiKey: 'k', fetch }, audio, ctx);
    expect(r.ok).toBe(true);
    const c = calls[0]!;
    expect(c.url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_MODEL}:generateContent`);
    expect(c.headers['x-goog-api-key']).toBe('k');
    expect(c.url).not.toContain('k=');
    const cfg = c.body.generationConfig as Record<string, unknown>;
    expect(cfg).toMatchObject({ temperature: 0, responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: 'minimal' } });
    expect((cfg.responseJsonSchema as { required: string[] }).required).toContain('transcript');
    const contents = c.body.contents as { role: string; parts: Record<string, unknown>[] }[];
    const last = contents.at(-1)!;
    expect(last.parts[0]).toEqual({ inlineData: { mimeType: 'audio/wav', data: 'UklGRg==' } });
    expect(last.parts[1]!.text).toContain('চাল (kg; also said চাউল)');
    expect(last.parts[1]!.text).toContain('this phone: আব্বু, role owner');
    // the system instruction carries the eval's rules plus the audio rules
    const sys = (c.body.systemInstruction as { parts: { text: string }[] }).parts[0]!.text;
    expect(sys).toContain('NEVER invent prices');
    expect(sys).toContain('transcript');
  });

  it('a 2.x model gets thinkingBudget 0; the model id is configurable', async () => {
    const { fetch, calls } = mockFetch([{ answer: SALE }]);
    await generate({ apiKey: 'k', fetch, model: 'gemini-2.5-flash-lite' }, audio, ctx);
    expect(calls[0]!.url).toContain('/models/gemini-2.5-flash-lite:generateContent');
    expect((calls[0]!.body.generationConfig as Record<string, unknown>).thinkingConfig).toEqual({ thinkingBudget: 0 });
  });

  it('reads prompt, audio, output and thinking tokens', async () => {
    const { fetch } = mockFetch([{ answer: SALE, usage: USAGE }]);
    const r = await generate({ apiKey: 'k', fetch }, audio, ctx);
    expect(r.ok && r.usage).toEqual({ promptTokens: 900, audioTokens: 120, outputTokens: 60, thoughtTokens: 12 });
  });

  it('retries 503 with 2 s, 5 s, 10 s back-off, then gives up', async () => {
    const t = fakeTime();
    const { fetch, calls } = mockFetch([{ status: 503 }]);
    const r = await generate({ apiKey: 'k', fetch, now: t.now, sleep: t.sleep }, audio, ctx);
    expect(calls).toHaveLength(4);
    expect(t.waits).toEqual(BACKOFF_503_MS);
    expect(r).toMatchObject({ ok: false, kind: 'api', attempts: 4 });
  });

  it('retries 429 after the error retryDelay, then succeeds', async () => {
    const t = fakeTime();
    const { fetch } = mockFetch([
      { status: 429, body: { error: { message: 'quota', details: [{ retryDelay: '3s' }] } } },
      { answer: SALE },
    ]);
    const r = await generate({ apiKey: 'k', fetch, now: t.now, sleep: t.sleep }, audio, ctx);
    expect(t.waits).toEqual([3500]);
    expect(r).toMatchObject({ ok: true, attempts: 2 });
  });

  it('with a deadline, skips a retry that would pass it', async () => {
    const t = fakeTime();
    const { fetch, calls } = mockFetch([{ status: 429, body: { error: { details: [{ retryDelay: '20s' }] } } }]);
    const r = await generate({ apiKey: 'k', fetch, now: t.now, sleep: t.sleep, deadlineMs: 12_000 }, audio, ctx);
    expect(calls).toHaveLength(1);
    expect(r).toMatchObject({ ok: false, kind: 'api' });
  });

  it('times out after 8 s by default', async () => {
    jest.useFakeTimers();
    try {
      const { fetch } = mockFetch([{ hang: true }]);
      const p = generate({ apiKey: 'k', fetch }, audio, ctx);
      await jest.advanceTimersByTimeAsync(8000);
      await expect(p).resolves.toMatchObject({ ok: false, kind: 'timeout' });
    } finally {
      jest.useRealTimers();
    }
  });

  it('network failure and non-JSON answers are failures, not throws', async () => {
    const down = mockFetch([{ throws: 'Network request failed' }]);
    await expect(generate({ apiKey: 'k', fetch: down.fetch }, audio, ctx)).resolves.toMatchObject({ ok: false, kind: 'api' });
    const prose = mockFetch([{ text: 'Sure! Here is the JSON' }]);
    await expect(generate({ apiKey: 'k', fetch: prose.fetch }, audio, ctx)).resolves.toMatchObject({ ok: false, kind: 'bad_json' });
  });

  it('retryDelayMs falls back to 10 s', () => {
    expect(retryDelayMs(null)).toBe(10_000);
    expect(retryDelayMs({ error: { details: [{ retryDelay: '1.5s' }] } })).toBe(2000);
  });
});

describe('geminiParse', () => {
  it('returns a checked ParsedCommand and Gemini’s transcript', async () => {
    const { fetch } = mockFetch([{ answer: SALE }]);
    const r = await geminiParse({ apiKey: 'k', fetch }, audio, ctx, names);
    expect(r.ok).toBe(true);
    expect(r.transcript).toBe('চাউল দুই কেজি একশো বিশ টাকা');
    expect(r.parsed).toMatchObject({ intent: 'sale', product: 'চাল', amount: 120, confidence: 'high' });
    expect(r.usage?.audioTokens).toBe(120);
  });

  it('an answer that breaks the schema is a failure (the app falls back to Android)', async () => {
    const { fetch } = mockFetch([{ answer: { ...SALE, intent: 'refund' } }]);
    const r = await geminiParse({ apiKey: 'k', fetch }, audio, ctx, names);
    expect(r).toMatchObject({ ok: false, parsed: null });
    expect(r.error).toMatch(/^invalid: intent/);
    expect(r.transcript).toBe(SALE.transcript);
  });

  it('an API error is a failure with the reason', async () => {
    const { fetch } = mockFetch([{ status: 400 }]);
    const r = await geminiParse({ apiKey: 'k', fetch }, audio, ctx, names);
    expect(r).toMatchObject({ ok: false, parsed: null, error: 'api: HTTP 400: status 400' });
  });
});

describe('owner names in the prompt', () => {
  it('owners = মালিক phones’ names; family words are not built in', async () => {
    const { buildRequest, contextText, SYSTEM, EXAMPLES } = await import('../prompt');
    expect(contextText({ ...ctx, owners: ['রফিক'] })).toContain('owners: রফিক');
    expect(contextText(ctx)).not.toContain('owners:');
    expect(SYSTEM).not.toMatch(/আব্বু|আম্মু|আব্বা|আম্মা/);
    expect(JSON.stringify(EXAMPLES)).not.toMatch(/আব্বু|আম্মু/);
    const req = buildRequest('gemini-3.5-flash-lite', audio, { ...ctx, owners: ['রফিক'] });
    expect(JSON.stringify(req.contents.at(-1))).toContain('owners: রফিক');
  });
});
