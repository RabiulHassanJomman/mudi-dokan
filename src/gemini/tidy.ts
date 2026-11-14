/**
 * "Gemini দিয়ে গুছিয়ে নিন" (exp/gemini-audio only): the raw lines of a customer list →
 * Gemini → [{name_bn, phone, note, maybe_same_as}], with English names in Bangla
 * spelling (Rahim → রহিম), obvious typos fixed, phones split out. Pure TS (fetch injected).
 *
 * The answer is checked like a parsed line (phone through parseBdPhone, empty name =
 * no_name), then the normal duplicate check runs; nothing is saved without হ্যাঁ.
 */
import { parseBdPhone, type CustomerLine } from '../domain/customerImport';
import type { Candidate, ImportRow, Problem } from '../domain/importer';
import { nameKey } from '../domain/names';
import { generateBody, type ClientDeps, type Usage } from './client';

/** Lines per call: the answer is ~30 tokens a line, so a batch stays well inside the timeout. */
export const TIDY_BATCH = 40;
/** A batch answer may take a while to write (output tokens, not audio). */
export const TIDY_TIMEOUT_MS = 30_000;

const SYSTEM = `You tidy up a customer list from a small grocery shop in Bangladesh. Each input line is meant to be one customer: a name, maybe a phone number, maybe other words.
Return a JSON array with one object per customer, in input order:
- name_bn: the person's name in Bangla script. Transliterate English/Latin names (Rahim → রহিম, Karim → করিম, Md./Mohammad → মোহাম্মদ, Akter → আক্তার). Fix obvious spelling mistakes. Remove honorifics and relations (ভাই, আপা, চাচা, bhai, apa, sir, mr …) from the name and put them in note.
- phone: the Bangladeshi mobile number from that line as 11 digits 01XXXXXXXXX (drop +88, spaces, dashes), or null. NEVER invent or complete a number; if the digits are incomplete, put them in note and phone null.
- note: honorifics, address or other words from the line, or null.
- maybe_same_as: if this is probably the same person as a name in "existing customers" (same person spelled differently, English vs Bangla), that existing name exactly as given; else null.
Skip blank or meaningless lines. Do not add people who are not in the input. Do not merge different lines into one person.`;

const nullable = { type: ['string', 'null'] };
const SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: { name_bn: { type: 'string' }, phone: nullable, note: nullable, maybe_same_as: nullable },
    required: ['name_bn', 'phone', 'note', 'maybe_same_as'],
  },
};

export function buildTidyRequest(model: string, lines: readonly string[], existingNames: readonly string[]) {
  const thinkingConfig = /^gemini-2/.test(model) ? { thinkingBudget: 0 } : { thinkingLevel: 'minimal' };
  const text = `lines:\n${lines.map((l, i) => `${i + 1}: ${l}`).join('\n')}\n\nexisting customers: ${existingNames.join(', ') || '(none)'}`;
  return {
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [{ role: 'user', parts: [{ text }] }],
    generationConfig: { temperature: 0, responseMimeType: 'application/json', responseJsonSchema: SCHEMA, thinkingConfig },
  };
}

export interface TidyLine {
  value: CustomerLine;
  problems: Problem[];
  /** Gemini's maybe_same_as (an existing customer's name), unchecked. */
  hint: string | null;
}

const text = (v: unknown, field: string): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') throw new Error(`${field}: not text`);
  return v.normalize('NFC').replace(/\s+/g, ' ').trim() || null;
};

/** Gemini's array → lines, checked like the file parser's output. Throws on a wrong shape. */
export function convertTidy(json: unknown): TidyLine[] {
  if (!Array.isArray(json)) throw new Error('not a list');
  return json.map((o: unknown, i) => {
    if (typeof o !== 'object' || o === null || Array.isArray(o)) throw new Error(`[${i}]: not an object`);
    const r = o as Record<string, unknown>;
    const name = text(r.name_bn, `[${i}].name_bn`) ?? '';
    const rawPhone = text(r.phone, `[${i}].phone`);
    let note = text(r.note, `[${i}].note`);
    const problems: Problem[] = name ? [] : ['no_name'];
    let phone: string | null = null;
    if (rawPhone) {
      phone = parseBdPhone(rawPhone);
      if (!phone) {
        problems.push('bad_phone');
        note = [note, rawPhone].filter(Boolean).join(' · ');
      }
    }
    return { value: { name, phone, note }, problems, hint: text(r.maybe_same_as, `[${i}].maybe_same_as`) };
  });
}

/** Tidy lines → preview rows (line = position in Gemini's answer). */
export const tidyRows = (lines: readonly TidyLine[]): ImportRow<CustomerLine>[] =>
  lines.map((t, i) => ({
    line: i + 1,
    raw: [t.value.name, t.value.phone].filter(Boolean).join(' '),
    value: t.value,
    problems: t.problems,
    status: 'new',
    match: null,
    include: false,
    chosen: false,
  }));

/**
 * After the normal check: a row still "নতুন" that Gemini thinks is an existing customer
 * becomes "সম্ভবত একই" (how 'ai'), not added unless the user ticks it. Hints that name
 * nobody in the shop are ignored.
 */
export function applyTidyHints(
  rows: readonly ImportRow<CustomerLine>[],
  tidy: readonly TidyLine[],
  existing: readonly Candidate[],
): ImportRow<CustomerLine>[] {
  return rows.map((r) => {
    const hint = tidy[r.line - 1]?.hint;
    if (r.status !== 'new' || !hint) return r;
    const c = existing.find((x) => nameKey(x.name) === nameKey(hint));
    if (!c) return r;
    return { ...r, status: 'maybe', match: { how: 'ai', candidate: c }, include: r.chosen ? r.include : false };
  });
}

export type TidyResult =
  | { ok: true; rows: TidyLine[]; ms: number; usage: Usage }
  | { ok: false; rows: []; error: string; ms: number; usage: Usage };

const addUsage = (a: Usage, b: Usage | null): Usage =>
  b
    ? { promptTokens: a.promptTokens + b.promptTokens, audioTokens: a.audioTokens + b.audioTokens, outputTokens: a.outputTokens + b.outputTokens, thoughtTokens: a.thoughtTokens + b.thoughtTokens }
    : a;

/** All lines, in batches. Any failed batch fails the whole tidy-up (the preview keeps its rows). */
export async function tidyCustomers(deps: ClientDeps, lines: readonly string[], existingNames: readonly string[]): Promise<TidyResult> {
  let usage: Usage = { promptTokens: 0, audioTokens: 0, outputTokens: 0, thoughtTokens: 0 };
  let ms = 0;
  const out: TidyLine[] = [];
  for (let at = 0; at < lines.length; at += TIDY_BATCH) {
    const batch = lines.slice(at, at + TIDY_BATCH);
    const call = await generateBody({ timeoutMs: TIDY_TIMEOUT_MS, ...deps }, (model) => buildTidyRequest(model, batch, existingNames));
    usage = addUsage(usage, call.usage);
    ms += call.ms;
    if (!call.ok) return { ok: false, rows: [], error: `${call.kind}: ${call.error}`, ms, usage };
    try {
      const got = convertTidy(call.json);
      // one person per line at most (a line may be skipped); a longer answer made people up
      if (got.length > batch.length + 1) throw new Error(`too many rows (${got.length} for ${batch.length} lines)`);
      out.push(...got);
    } catch (e) {
      return { ok: false, rows: [], error: `invalid: ${e instanceof Error ? e.message : String(e)}`, ms, usage };
    }
  }
  return { ok: true, rows: out, ms, usage };
}
