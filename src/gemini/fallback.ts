/** Gemini mode: whose result the confirm card shows. Pure TS. */
import type { Intent } from '../parser/types';

/**
 * Gemini's checked result when it understood the command; otherwise (no internet, timeout,
 * API or schema error, or "unknown") the Android transcript's rule parse, without a word
 * to the user; with neither, 'none' → "আবার বলুন".
 */
export function shownEngine(gemini: { intent: Intent } | null, androidTranscript: string): 'gemini' | 'android' | 'none' {
  if (gemini && gemini.intent !== 'unknown') return 'gemini';
  if (androidTranscript.trim()) return 'android';
  return 'none';
}
