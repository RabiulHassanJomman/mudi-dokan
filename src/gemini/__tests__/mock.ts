/** A scripted fetch for Gemini tests: no network. */
export interface MockReply {
  status?: number;
  /** The model's JSON answer (put in candidates[0].content.parts[0].text). */
  answer?: unknown;
  /** Raw text instead of JSON.stringify(answer). */
  text?: string;
  /** Raw response body (errors). */
  body?: unknown;
  usage?: Record<string, unknown>;
  /** Never resolves (for the timeout). */
  hang?: boolean;
  /** fetch rejects (network down). */
  throws?: string;
}

export const USAGE = {
  promptTokenCount: 900,
  candidatesTokenCount: 60,
  thoughtsTokenCount: 12,
  promptTokensDetails: [
    { modality: 'TEXT', tokenCount: 780 },
    { modality: 'AUDIO', tokenCount: 120 },
  ],
};

export function mockFetch(replies: MockReply[]) {
  const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  let n = 0;
  const fetch = async (url: string, init: { headers: Record<string, string>; body: string; signal?: AbortSignal }) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) as Record<string, unknown> });
    const r = replies[Math.min(n++, replies.length - 1)]!;
    if (r.throws) throw new Error(r.throws);
    if (r.hang) {
      return new Promise<never>((_, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
    }
    const status = r.status ?? 200;
    const body =
      r.body ??
      (status === 200
        ? { candidates: [{ content: { parts: [{ text: r.text ?? JSON.stringify(r.answer) }] } }], usageMetadata: r.usage ?? USAGE }
        : { error: { message: `status ${status}` } });
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  return { fetch, calls };
}

/** A clock and sleep that move instantly, recording the waits. */
export function fakeTime() {
  let t = 0;
  const waits: number[] = [];
  return {
    now: () => t,
    sleep: async (ms: number) => {
      waits.push(ms);
      t += ms;
    },
    advance: (ms: number) => (t += ms),
    waits,
  };
}
