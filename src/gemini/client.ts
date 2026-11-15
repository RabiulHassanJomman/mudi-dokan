/**
 * Gemini REST generateContent. Pure TS: fetch, sleep and the clock are passed in, so
 * tests run with a mocked client and no network.
 *
 * Each attempt has its own timeout (8 s). 429 and 503 are retried like the eval: 429 waits
 * the error's retryDelay, 503 backs off 2 s, 5 s, 10 s, up to 3 retries. With a deadline
 * (the shopkeeper is waiting), a retry whose wait would pass it is not tried.
 */
import { buildRequest, type Input, type PromptContext } from './prompt';

/** Newest stable Flash-Lite (takes audio) per ai.google.dev/gemini-api/docs/models (Nov 2026). */
export const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
export const TIMEOUT_MS = 8000;
export const MAX_RETRIES = 3;
export const BACKOFF_503_MS = [2000, 5000, 10_000];

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export interface ClientDeps {
  apiKey: string;
  model?: string;
  fetch: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  timeoutMs?: number;
  maxRetries?: number;
  /** Give up retrying past this many ms from the start (undefined = no limit). */
  deadlineMs?: number;
  /** Called before each retry wait (the eval prints it). */
  onRetry?: (status: number, waitMs: number, attempt: number) => void;
}

export interface Usage {
  promptTokens: number;
  /** Part of promptTokens that was audio. */
  audioTokens: number;
  outputTokens: number;
  thoughtTokens: number;
  /** Prompt tokens reused from cache (at 25% cost). */
  cachedTokens: number;
}

export type CallResult =
  | { ok: true; json: unknown; text: string; ms: number; usage: Usage; attempts: number }
  /** api = HTTP/API error (quota, rate limit, network, timeout); bad_json = answered but not JSON. */
  | { ok: false; kind: 'api' | 'timeout' | 'bad_json'; error: string; ms: number; usage: Usage | null; attempts: number };

interface Body {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
    cachedContentTokenCount?: number;
    promptTokensDetails?: { modality?: string; tokenCount?: number }[];
  };
  error?: { message?: string; details?: { retryDelay?: string }[] };
}

/** "12s" / "1.5s" from google.rpc.RetryInfo; fallback 10 s. */
export function retryDelayMs(body: unknown): number {
  const details = (body as Body | null)?.error?.details ?? [];
  const d = details.find((x) => typeof x.retryDelay === 'string')?.retryDelay;
  const secs = d ? Number.parseFloat(d) : NaN;
  return Number.isFinite(secs) ? Math.ceil(secs * 1000) + 500 : 10_000;
}

export function usageOf(body: Body | null): Usage | null {
  const u = body?.usageMetadata;
  if (!u) return null;
  return {
    promptTokens: u.promptTokenCount ?? 0,
    audioTokens: u.promptTokensDetails?.find((d) => d.modality === 'AUDIO')?.tokenCount ?? 0,
    outputTokens: u.candidatesTokenCount ?? 0,
    thoughtTokens: u.thoughtsTokenCount ?? 0,
    cachedTokens: u.cachedContentTokenCount ?? 0,
  };
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** One voice command (audio or text) → the ParseResult JSON. */
export const generate = (deps: ClientDeps, input: Input, ctx: PromptContext): Promise<CallResult> =>
  generateBody(deps, (model) => buildRequest(model, input, ctx));

/** Any generateContent request (e.g. the customer-list tidy-up); same timeout and retries. */
export async function generateBody(deps: ClientDeps, request: (model: string) => object): Promise<CallResult> {
  const model = deps.model || DEFAULT_MODEL;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? realSleep;
  const timeoutMs = deps.timeoutMs ?? TIMEOUT_MS;
  const maxRetries = deps.maxRetries ?? MAX_RETRIES;
  const body = JSON.stringify(request(model));
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const t0 = now();

  for (let attempt = 0; ; attempt++) {
    const controller = typeof AbortController === 'undefined' ? null : new AbortController();
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => {
        timedOut = true;
        controller?.abort();
        resolve('timeout');
      }, timeoutMs);
    });
    let res: Awaited<ReturnType<FetchLike>> | 'timeout' | Error;
    try {
      res = await Promise.race([
        deps.fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': deps.apiKey },
          body,
          ...(controller ? { signal: controller.signal } : {}),
        }),
        timeout,
      ]);
    } catch (e) {
      res = timedOut ? 'timeout' : e instanceof Error ? e : new Error(String(e));
    } finally {
      clearTimeout(timer);
    }
    const attempts = attempt + 1;
    if (res === 'timeout') return { ok: false, kind: 'timeout', error: `no answer in ${timeoutMs} ms`, ms: now() - t0, usage: null, attempts };
    if (res instanceof Error) return { ok: false, kind: 'api', error: `network: ${res.message}`, ms: now() - t0, usage: null, attempts };

    const json = (await res.json().catch(() => null)) as Body | null;
    if ((res.status === 429 || res.status === 503) && attempt < maxRetries) {
      const wait = res.status === 429 ? retryDelayMs(json) : BACKOFF_503_MS[attempt] ?? 10_000;
      const fits = deps.deadlineMs === undefined || now() - t0 + wait + timeoutMs <= deps.deadlineMs;
      if (fits) {
        deps.onRetry?.(res.status, wait, attempt + 1);
        await sleep(wait);
        continue;
      }
    }
    const ms = now() - t0;
    const usage = usageOf(json);
    if (!res.ok) return { ok: false, kind: 'api', error: `HTTP ${res.status}: ${json?.error?.message ?? 'no body'}`, ms, usage, attempts };
    const text = json?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    try {
      return { ok: true, json: JSON.parse(text) as unknown, text, ms, usage: usage ?? { promptTokens: 0, audioTokens: 0, outputTokens: 0, thoughtTokens: 0, cachedTokens: 0 }, attempts };
    } catch {
      return { ok: false, kind: 'bad_json', error: `bad JSON: ${text.slice(0, 200)}`, ms, usage, attempts };
    }
  }
}
