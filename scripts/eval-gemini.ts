/**
 * Offline eval: rule parser (src/parser) vs Gemini. Mac-only dev tool, never bundled.
 * Prompt, client, output check and scoring are the app's own (src/gemini, src/eval).
 *
 *   GEMINI_API_KEY=... npx tsx scripts/eval-gemini.ts [--model <id>] [--rule-only] [--limit N]
 *     text mode: eval/fixtures.jsonl transcripts → rule parser vs Gemini (text).
 *
 *   GEMINI_API_KEY=... npx tsx scripts/eval-gemini.ts --audio pilot.json [--clips eval/clips] [--model <id>] [--limit N]
 *     audio mode: confirmed commands of a pilot export, each with its recorded clip
 *     (log.audio_file in --clips; copy them off the phone with the pilot log's
 *     "অডিও ফোল্ডারে রাখুন", then adb pull). Scores Gemini-audio vs Android STT + rule
 *     parser against what the shopkeeper confirmed.
 *
 * Writes eval/results/<timestamp>.json (gitignored).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { confirmedExpected, diff, normParse, type Norm } from '../src/eval/compare';
import { readPilotLogs } from '../src/eval/pilot-fixtures';
import type { Expected, Fixture, Seed, Tab } from '../src/eval/types';
import { audioInput, geminiParse, type GeminiResult } from '../src/gemini';
import { audioMime, fitAudio } from '../src/gemini/audio';
import { DEFAULT_MODEL, type ClientDeps } from '../src/gemini/client';
import { promptContext } from '../src/gemini/context';
import { parseCommand, shouldEscalate } from '../src/parser';
import type { ParseContext } from '../src/parser/types';

// ── setup ──────────────────────────────────────────────────────

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/** Free tier is ~15 requests/min: keep ≥ 4.5 s between calls. */
const DELAY_MS = 4500;

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const model = flag('--model') ?? DEFAULT_MODEL;
const ruleOnly = args.includes('--rule-only');
const limit = flag('--limit') ? Number(flag('--limit')) : Infinity;
const audioFile = flag('--audio');
const clipsDir = resolve(flag('--clips') ?? join(ROOT, 'eval/clips'));

const apiKey = process.env.GEMINI_API_KEY;
if ((!ruleOnly || audioFile) && !apiKey) {
  console.error('GEMINI_API_KEY is not set.\n  export GEMINI_API_KEY=<key from aistudio.google.com>  (or run with --rule-only)');
  process.exit(1);
}

const seed = JSON.parse(readFileSync(join(ROOT, 'eval/seed.json'), 'utf8')) as Seed;
const catalog = seed.products.map((p) => ({
  name: p.name,
  unit: p.unit,
  aliases: Object.entries(seed.aliases).filter(([, v]) => v === p.name).map(([k]) => k),
}));
const names = { knownProducts: seed.products.map((p) => p.name), productAliases: seed.aliases };
const ruleCtx = (tab: Tab): ParseContext => ({
  tab,
  knownProducts: seed.products.map((p) => p.name),
  knownCustomers: seed.customers,
  productAliases: seed.aliases,
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const deps: ClientDeps = {
  apiKey: apiKey ?? '',
  model,
  fetch: fetch as unknown as ClientDeps['fetch'],
  onRetry: (status, wait, attempt) => process.stdout.write(`\n  ${status}, waiting ${(wait / 1000).toFixed(1)} s (retry ${attempt}/3)`),
};
const prompt = (tab: Tab, hint: string | null) => promptContext({ tab, catalog, customers: seed.customers, hint });

// ── scoring helpers ────────────────────────────────────────────

interface GeminiScore extends Omit<GeminiResult, 'parsed'> {
  out: Norm | null;
  /** null on an API error (excluded from pass %). */
  fails: string[] | null;
}

/** API/network errors are not parse failures; a bad or invalid answer is. */
const isApiError = (g: GeminiResult) => !g.ok && /^(api|timeout|error):/.test(g.error ?? '');

function scoreGemini(expected: Expected, g: GeminiResult): GeminiScore {
  const { parsed, ...rest } = g;
  const out = parsed ? normParse(parsed) : null;
  return { ...rest, out, fails: isApiError(g) ? null : out ? diff(expected, out) : [g.error?.split(':')[0] ?? 'bad_json'] };
}

type Scored = { fails: string[] | null | undefined };
const pct = <R>(xs: R[], pick: (r: R) => string[] | null | undefined) => {
  const scored = xs.filter((r) => pick(r) != null);
  if (!scored.length) return '—';
  const ok = scored.filter((r) => pick(r)!.length === 0).length;
  return `${Math.round((ok / scored.length) * 100)}% ${ok}/${scored.length}`;
};
const mark = (f?: string[] | null) => (f === undefined ? '' : f === null ? 'API error' : f.length ? `✗ ${f.join(', ')}` : '✓');

function printGeminiCost(calls: GeminiScore[]) {
  const ok = calls.filter((g) => g.fails !== null);
  if (!ok.length) return;
  const avg = (f: (g: GeminiScore) => number) => Math.round(ok.reduce((s, g) => s + f(g), 0) / ok.length);
  const sorted = ok.map((g) => g.ms).sort((a, b) => a - b);
  console.log(
    `\ngemini ${model}: ${ok.length} calls · avg tokens in ${avg((g) => g.usage?.promptTokens ?? 0)} (audio ${avg((g) => g.usage?.audioTokens ?? 0)})` +
      ` / out ${avg((g) => g.usage?.outputTokens ?? 0)} / thinking ${avg((g) => g.usage?.thoughtTokens ?? 0)}` +
      ` · latency avg ${avg((g) => g.ms)} ms, p50 ${sorted[Math.floor(sorted.length / 2)]} ms, max ${sorted.at(-1)} ms`,
  );
}

function writeResults(payload: object) {
  const dir = join(ROOT, 'eval/results');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, JSON.stringify({ model: ruleOnly && !audioFile ? null : model, at: new Date().toISOString(), ...payload }, null, 1));
  console.log(`\nwrote ${file.slice(ROOT.length + 1)}`);
}

// ── text mode ──────────────────────────────────────────────────

interface Row extends Fixture {
  rule: { out: Norm; fails: string[]; confidence: 'high' | 'low'; lowReasons?: string[] };
  gemini?: GeminiScore;
  /** Rule result when confident, else Gemini's. */
  hybrid?: { from: 'rule' | 'gemini'; fails: string[] | null };
}

async function textMode() {
  const allFixtures: Fixture[] = readFileSync(join(ROOT, 'eval/fixtures.jsonl'), 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Fixture);
  /** status "review" = expected is only a draft; not run or scored until labelled. */
  const unlabelled = allFixtures.filter((f) => f.status === 'review');
  const fixtures = allFixtures.filter((f) => f.status !== 'review').slice(0, limit);

  console.log(`${fixtures.length} cases · rule parser${ruleOnly ? '' : ` vs ${model}`}\n`);
  const rows: Row[] = [];
  for (const [k, f] of fixtures.entries()) {
    const parsed = parseCommand(f.text, ruleCtx(f.tab));
    const ruleOut = normParse(parsed);
    const row: Row = {
      ...f,
      rule: { out: ruleOut, fails: diff(f.expected, ruleOut), confidence: parsed.confidence, lowReasons: parsed.lowReasons },
    };
    if (!ruleOnly) {
      if (k > 0) await sleep(DELAY_MS);
      row.gemini = scoreGemini(f.expected, await geminiParse(deps, { text: f.text }, prompt(f.tab, f.text), names));
      row.hybrid = shouldEscalate(parsed) ? { from: 'gemini', fails: row.gemini.fails } : { from: 'rule', fails: row.rule.fails };
      process.stdout.write(`\r  ${k + 1}/${fixtures.length}`);
    }
    rows.push(row);
  }
  if (!ruleOnly) process.stdout.write('\n\n');

  const groups: [string, Row[]][] = [
    ['all', rows],
    ['new', rows.filter((r) => r.source === 'new')],
    ['tests', rows.filter((r) => r.source === 'tests')],
    // held out: real shop commands, never used to write parser rules
    ['pilot', rows.filter((r) => r.source === 'pilot')],
    ['  edited', rows.filter((r) => r.source === 'pilot' && r.edited)],
  ];
  console.log('pass %          rule           gemini         hybrid');
  for (const [name, xs] of groups) {
    if (name === '  edited' && !xs.length) continue;
    const cols = [pct(xs, (r) => r.rule.fails), ruleOnly ? '—' : pct(xs, (r) => r.gemini?.fails), ruleOnly ? '—' : pct(xs, (r) => r.hybrid?.fails)];
    console.log(`  ${`${name} (${xs.length})`.padEnd(14)}${cols.map((c) => c.padEnd(15)).join('')}`);
  }
  if (rows.some((r) => r.source === 'pilot'))
    console.log(
      `\npilot = held-out score. "edited" = the shopkeeper fixed the confirm card, i.e. the app's parser was wrong then;` +
        ` the other pilot cases were accepted as parsed, so they mostly catch regressions.`,
    );
  if (unlabelled.length) {
    const byIntent = new Map<string, number>();
    for (const f of unlabelled) byIntent.set(f.expected.intent, (byIntent.get(f.expected.intent) ?? 0) + 1);
    console.log(
      `\nnot scored: ${unlabelled.length} cases with status "review" (draft label: ${[...byIntent].map(([i, n]) => `${i} ${n}`).join(', ')}).` +
        ` Label them in eval/fixtures.jsonl and delete "status" to count them.`,
    );
  }
  const low = rows.filter((r) => r.rule.confidence === 'low');
  const lowWrong = low.filter((r) => r.rule.fails.length).length;
  const highWrong = rows.filter((r) => r.rule.confidence === 'high' && r.rule.fails.length).length;
  console.log(
    `\nrule confidence: ${low.length}/${rows.length} low → hybrid asks Gemini ${low.length}× ` +
      `(low & wrong ${lowWrong}, low & right ${low.length - lowWrong}; high & wrong ${highWrong})`,
  );

  const shown = rows.filter((r) => r.rule.fails.length || r.gemini?.fails?.length || r.hybrid?.fails?.length);
  if (shown.length) console.log(`\ncases with a failure (${shown.length}):`);
  for (const r of shown) {
    console.log(`\n  “${r.text}” [${r.source}, ${r.tab}]`);
    console.log(`    rule   ${mark(r.rule.fails)}  (${r.rule.confidence}${r.rule.lowReasons ? `: ${r.rule.lowReasons.join(', ')}` : ''})`);
    if (r.gemini) console.log(`    gemini ${mark(r.gemini.fails)}${r.gemini.error ? ` (${r.gemini.error})` : ''}`);
    if (r.hybrid) console.log(`    hybrid ${mark(r.hybrid.fails)} (from ${r.hybrid.from})`);
  }
  printGeminiCost(rows.map((r) => r.gemini).filter((g): g is GeminiScore => !!g));
  const apiErrors = rows.filter((r) => r.gemini && r.gemini.fails === null);
  if (apiErrors.length) {
    console.log(`\nAPI errors (not counted as failures): ${apiErrors.length}`);
    for (const r of apiErrors) console.log(`  “${r.text}”: ${r.gemini!.error}`);
  }
  writeResults({ mode: 'text', rows });
}

// ── audio mode ─────────────────────────────────────────────────

interface AudioRow {
  pilot_id?: string;
  tab: Tab;
  audio_file: string;
  /** Android STT transcript ('' = the recognizer heard nothing). */
  transcript: string;
  edited: boolean;
  expected: Expected;
  android: Scored & { out: Norm | null };
  gemini: GeminiScore;
}

async function audioMode(file: string) {
  const logs = readPilotLogs(readFileSync(file, 'utf8'));
  const TABS: Tab[] = ['sale', 'purchase', 'ledger', 'stock', 'expense'];
  const skipped = { not_confirmed: 0, no_clip: 0, clip_missing: 0, picked: 0 };
  const cases: { log: (typeof logs)[number]; expected: Expected; clip: string; tab: Tab }[] = [];
  for (const log of logs) {
    if (log.via === 'pick' || log.source === 'typed') {
      skipped.picked++;
      continue;
    }
    const expected = confirmedExpected(log);
    if (!expected) {
      skipped.not_confirmed++;
      continue;
    }
    if (!log.audio_file) {
      skipped.no_clip++;
      continue;
    }
    const clip = join(clipsDir, log.audio_file);
    if (!existsSync(clip)) {
      skipped.clip_missing++;
      continue;
    }
    cases.push({ log, expected, clip, tab: TABS.includes(log.tab as Tab) ? (log.tab as Tab) : 'sale' });
  }
  const run = cases.slice(0, limit);
  console.log(`${run.length} confirmed voice commands with a clip · Android STT + rule parser vs ${model} (audio)`);
  console.log(`skipped: ${Object.entries(skipped).map(([k, n]) => `${k} ${n}`).join(', ')}  (clips from ${clipsDir})\n`);

  const rows: AudioRow[] = [];
  for (const [k, c] of run.entries()) {
    const transcript = c.log.transcript?.trim() ?? '';
    const ruleOut = transcript ? normParse(parseCommand(transcript, ruleCtx(c.tab))) : null;
    if (k > 0) await sleep(DELAY_MS);
    const mime = audioMime(c.clip);
    let g: GeminiResult;
    if (!mime) g = { ok: false, model, parsed: null, transcript: null, error: `invalid: clip type ${c.clip}`, ms: 0, usage: null };
    else {
      const audio = fitAudio(new Uint8Array(readFileSync(c.clip)), mime);
      g = await geminiParse(deps, audioInput(audio), prompt(c.tab, transcript || null), names);
    }
    rows.push({
      pilot_id: c.log.id,
      tab: c.tab,
      audio_file: c.log.audio_file!,
      transcript,
      edited: c.log.outcome === 'saved_edited',
      expected: c.expected,
      android: { out: ruleOut, fails: ruleOut ? diff(c.expected, ruleOut) : ['no_transcript'] },
      gemini: scoreGemini(c.expected, g),
    });
    process.stdout.write(`\r  ${k + 1}/${run.length}`);
  }
  process.stdout.write('\n\n');

  const groups: [string, AudioRow[]][] = [
    ['all', rows],
    ['  edited', rows.filter((r) => r.edited)],
    ['  STT empty', rows.filter((r) => !r.transcript)],
  ];
  console.log('pass %          android+rule   gemini audio');
  for (const [name, xs] of groups) {
    if (name !== 'all' && !xs.length) continue;
    console.log(`  ${`${name} (${xs.length})`.padEnd(14)}${[pct(xs, (r) => r.android.fails), pct(xs, (r) => r.gemini.fails)].map((c) => c.padEnd(15)).join('')}`);
  }
  console.log(
    '\n"edited" = the shopkeeper fixed the card, so the shown engine was wrong there. Untouched cards count the shown' +
      ' engine right by construction (in "both" mode that is Android): compare engines on the edited rows too.',
  );
  const shown = rows.filter((r) => r.android.fails?.length || r.gemini.fails?.length);
  if (shown.length) console.log(`\ncases with a failure (${shown.length}):`);
  for (const r of shown) {
    console.log(`\n  ${r.audio_file} [${r.tab}${r.edited ? ', edited' : ''}]`);
    console.log(`    android “${r.transcript}” ${mark(r.android.fails)}`);
    console.log(`    gemini  “${r.gemini.transcript ?? ''}” ${mark(r.gemini.fails)}${r.gemini.error ? ` (${r.gemini.error})` : ''}`);
  }
  printGeminiCost(rows.map((r) => r.gemini));
  writeResults({ mode: 'audio', source: file, rows });
}

(audioFile ? audioMode(audioFile) : textMode()).catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
