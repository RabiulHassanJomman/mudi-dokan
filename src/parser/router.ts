/**
 * Rule parser first; a low-confidence result goes to an LLM. Pure TS: the LLM call
 * is passed in, so the parser stays offline-testable (the eval injects Gemini).
 */
import { parseCommand } from './parse';
import type { ParseContext, ParsedCommand } from './types';

export type LlmParse = (text: string, ctx: ParseContext) => Promise<ParsedCommand | null>;

export interface HybridResult {
  result: ParsedCommand;
  /** Who produced `result`. "rule" also when the LLM was asked but failed. */
  source: 'rule' | 'llm';
  rule: ParsedCommand;
  llmError?: string;
}

export const shouldEscalate = (p: ParsedCommand): boolean => p.confidence === 'low';

export async function hybridParse(text: string, ctx: ParseContext, llm: LlmParse): Promise<HybridResult> {
  const rule = parseCommand(text, ctx);
  if (!shouldEscalate(rule)) return { result: rule, source: 'rule', rule };
  try {
    const out = await llm(text, ctx);
    return out ? { result: out, source: 'llm', rule } : { result: rule, source: 'rule', rule, llmError: 'empty answer' };
  } catch (e) {
    return { result: rule, source: 'rule', rule, llmError: e instanceof Error ? e.message : String(e) };
  }
}
