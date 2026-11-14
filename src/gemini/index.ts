/**
 * Gemini audio understanding (experiment, branch exp/gemini-audio). Pure TS: the app
 * passes fetch and the clip bytes (src/lib/gemini.ts), tests pass a mock.
 */
import type { ParsedCommand } from '../parser/types';
import { DEFAULT_MODEL, generate, type ClientDeps, type Usage } from './client';
import { convertGemini, type ConvertContext } from './convert';
import type { InlineAudio } from './audio';
import type { Input, PromptContext } from './prompt';

export { DEFAULT_MODEL } from './client';
export type { Usage } from './client';

export interface GeminiResult {
  ok: boolean;
  model: string;
  /** Checked and converted; null when the call or the check failed. */
  parsed: ParsedCommand | null;
  /** Gemini's own Bangla transcript. */
  transcript: string | null;
  error: string | null;
  ms: number;
  usage: Usage | null;
}

/** One command → a validated ParsedCommand, or the reason it failed. Never throws. */
export async function geminiParse(
  deps: ClientDeps,
  input: Input,
  prompt: PromptContext,
  names: ConvertContext,
): Promise<GeminiResult> {
  const model = deps.model || DEFAULT_MODEL;
  const t0 = (deps.now ?? Date.now)();
  try {
    const call = await generate(deps, input, prompt);
    if (!call.ok) return { ok: false, model, parsed: null, transcript: null, error: `${call.kind}: ${call.error}`, ms: call.ms, usage: call.usage };
    try {
      const { parsed, transcript } = convertGemini(call.json, names);
      return { ok: true, model, parsed, transcript: transcript || null, error: null, ms: call.ms, usage: call.usage };
    } catch (e) {
      const transcript = (call.json as { transcript?: unknown } | null)?.transcript;
      return {
        ok: false,
        model,
        parsed: null,
        transcript: typeof transcript === 'string' ? transcript : null,
        error: `invalid: ${e instanceof Error ? e.message : String(e)}`,
        ms: call.ms,
        usage: call.usage,
      };
    }
  } catch (e) {
    return { ok: false, model, parsed: null, transcript: null, error: `error: ${e instanceof Error ? e.message : String(e)}`, ms: (deps.now ?? Date.now)() - t0, usage: null };
  }
}

export const audioInput = (a: InlineAudio): Input => ({ audio: { mimeType: a.mimeType, base64: a.base64 } });
