/**
 * Android vs Gemini on the pilot log: which engine matched what the shopkeeper confirmed,
 * how often they agree, Gemini latency and tokens. Pure TS over voice_logs rows.
 */
import { agree, confirmedExpected, matchesConfirmed } from '../eval/compare';
import type { PilotLog } from '../eval/pilot-fixtures';
import type { ParsedCommand } from '../parser/types';

/** The voice_logs columns this needs (VoiceLogRow has them all). */
export interface EngineRow {
  transcript: string;
  context_tab: string | null;
  parsed_json: string | null;
  outcome: string;
  edits_json: string | null;
  final_json: string | null;
  via: 'pick' | null;
  engine: 'android' | 'gemini' | 'both' | null;
  parsed_by: 'android' | 'gemini' | null;
  android_json: string | null;
  gemini_json: string | null;
  gemini_error: string | null;
  gemini_ms: number | null;
  gemini_prompt_tokens: number | null;
  gemini_audio_tokens: number | null;
  gemini_output_tokens: number | null;
  gemini_thought_tokens: number | null;
}

const json = <T>(s: string | null): T | null => {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
};

/** The rule parse of the Android transcript. Before v7 (engine null) that is parsed_json. */
export const androidParse = (r: EngineRow): ParsedCommand | null =>
  json<ParsedCommand>(r.android_json) ?? (r.parsed_by === 'gemini' ? null : json<ParsedCommand>(r.parsed_json));
export const geminiParsed = (r: EngineRow): ParsedCommand | null => json<ParsedCommand>(r.gemini_json);

export function asPilotLog(r: EngineRow): PilotLog {
  return {
    transcript: r.transcript,
    tab: r.context_tab,
    parsed: json<ParsedCommand>(r.parsed_json) ?? undefined,
    outcome: r.outcome,
    edits: json<string[]>(r.edits_json) ?? undefined,
    saved: json<PilotLog['saved']>(r.final_json) ?? undefined,
    ...(r.via ? { via: r.via } : {}),
  };
}

export interface EngineMatch {
  /** null = nothing confirmed to compare with, or that engine has no result. */
  android: boolean | null;
  gemini: boolean | null;
}

export function engineMatch(r: EngineRow): EngineMatch {
  const expected = r.via === 'pick' ? null : confirmedExpected(asPilotLog(r));
  return { android: matchesConfirmed(expected, androidParse(r)), gemini: matchesConfirmed(expected, geminiParsed(r)) };
}

export interface EngineStats {
  /** Logs Gemini was asked about (voice, engine gemini/both). */
  asked: number;
  geminiOk: number;
  geminiFailed: number;
  /** Both engines gave a result; how many said the same thing. */
  compared: number;
  agreed: number;
  /** Confirmed results each engine is scored on, and how many it matched. */
  androidScored: number;
  androidRight: number;
  geminiScored: number;
  geminiRight: number;
  /** Successful Gemini calls only. */
  avgMs: number | null;
  avgPromptTokens: number | null;
  avgAudioTokens: number | null;
  avgOutputTokens: number | null;
  avgThoughtTokens: number | null;
}

export const pct = (n: number, of: number): number | null => (of ? Math.round((n / of) * 100) : null);

export function engineStats(rows: readonly EngineRow[]): EngineStats {
  const asked = rows.filter((r) => r.gemini_json !== null || r.gemini_error !== null);
  const ok = asked.filter((r) => r.gemini_json !== null);
  let compared = 0;
  let agreed = 0;
  let androidScored = 0;
  let androidRight = 0;
  let geminiScored = 0;
  let geminiRight = 0;
  for (const r of asked) {
    const a = androidParse(r);
    const g = geminiParsed(r);
    if (a && g) {
      compared++;
      if (agree(a, g)) agreed++;
    }
    const m = engineMatch(r);
    if (m.android !== null) {
      androidScored++;
      if (m.android) androidRight++;
    }
    if (m.gemini !== null) {
      geminiScored++;
      if (m.gemini) geminiRight++;
    }
  }
  const avg = (f: (r: EngineRow) => number | null) => {
    const xs = ok.map(f).filter((x): x is number => x !== null);
    return xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : null;
  };
  return {
    asked: asked.length,
    geminiOk: ok.length,
    geminiFailed: asked.length - ok.length,
    compared,
    agreed,
    androidScored,
    androidRight,
    geminiScored,
    geminiRight,
    avgMs: avg((r) => r.gemini_ms),
    avgPromptTokens: avg((r) => r.gemini_prompt_tokens),
    avgAudioTokens: avg((r) => r.gemini_audio_tokens),
    avgOutputTokens: avg((r) => r.gemini_output_tokens),
    avgThoughtTokens: avg((r) => r.gemini_thought_tokens),
  };
}
