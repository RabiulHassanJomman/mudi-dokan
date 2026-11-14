/**
 * What was said while Gemini couldn't answer (no internet, 429, error) waits here, then is
 * understood in order when it can, and goes to "অপেক্ষার হিসাব মিলিয়ে নিন" for হ্যাঁ/না.
 * Pure TS against the Db interface; Gemini itself is passed in (src/lib/understand.ts on
 * the phone, a fake in tests). Nothing here saves an entry: only the user's হ্যাঁ does.
 *
 * waiting → ready (Gemini's answer is in voice_logs.gemini_json) | unclear (it answered but
 * understood nothing). The row leaves the queue when the log's outcome is decided (setOutcome).
 */
import type { Db, Writer } from '../db/repo';
import { setOutcome } from '../db/repo';

/** Gemini free tier: 15 requests a minute → one call per 4 s, a hair more to be safe. */
export const MIN_GAP_MS = 4_200;
/** After a rate limit or overload nothing is tried for this long. */
export const RATE_WAIT_MS = 60_000;
/** Retry waits for other failures: 30 s, 2 min, 10 min, 30 min, 2 h, then every 6 h. */
export const BACKOFF_MS = [30_000, 120_000, 600_000, 1_800_000, 7_200_000, 21_600_000] as const;
export const backoffMs = (attempts: number) => BACKOFF_MS[Math.min(Math.max(attempts, 1), BACKOFF_MS.length) - 1]!;
/** An answer Gemini keeps getting wrong in form (bad JSON / failed check) is "unclear" after this many tries. */
export const MAX_FORM_ATTEMPTS = 3;
/** One call may take this long in the background (the shopkeeper isn't waiting). */
export const BACKGROUND_DEADLINE_MS = 40_000;

export type QueueState = 'waiting' | 'ready' | 'unclear';

/** What a Gemini call came to. Same shape as GeminiResult (src/gemini/index.ts), the part used here. */
export interface UnderstandResult {
  ok: boolean;
  parsed: { intent: string } | null;
  error: string | null;
}

export type Verdict =
  | { kind: 'ready' }
  | { kind: 'unclear' }
  | { kind: 'nokey' }
  | {
      kind: 'retry';
      /** Stop this run: the next clips would fail the same way. */
      stop: 'offline' | 'rate' | 'error' | null;
      /** Earliest next try (ms from now); null = the usual backoff. */
      waitMs: number | null;
      /** A failure of form (bad JSON): counts toward "unclear". */
      form: boolean;
    };

export function classify(r: UnderstandResult): Verdict {
  if (r.ok && r.parsed) return r.parsed.intent === 'unknown' ? { kind: 'unclear' } : { kind: 'ready' };
  const e = r.error ?? '';
  if (/no EXPO_PUBLIC_GEMINI_KEY/.test(e)) return { kind: 'nokey' };
  if (/HTTP 429/.test(e) || /HTTP 5\d\d/.test(e)) return { kind: 'retry', stop: 'rate', waitMs: RATE_WAIT_MS, form: false };
  if (/HTTP (400|401|403)/.test(e)) return { kind: 'retry', stop: 'error', waitMs: BACKOFF_MS[3], form: false };
  if (/network:|timeout/.test(e)) return { kind: 'retry', stop: 'offline', waitMs: null, form: false };
  if (/invalid:|bad JSON/.test(e)) return { kind: 'retry', stop: null, waitMs: null, form: true };
  return { kind: 'retry', stop: null, waitMs: null, form: false };
}

/** Spaces calls MIN_GAP_MS apart, live ones (the shopkeeper waiting) included. */
export class RateGate {
  private last = -Infinity;
  constructor(private readonly gap = MIN_GAP_MS) {}
  /** A call was just made. */
  mark(now: number): void {
    this.last = now;
  }
  /** How long until the next call is allowed. */
  waitMs(now: number): number {
    return Math.max(0, this.last + this.gap - now);
  }
}

export interface PendingItem {
  id: string;
  tab: string;
  state: QueueState;
  /** When it was said. */
  queuedAt: number;
  clip: string | null;
  /** Gemini's own words, once it answered. */
  transcript: string | null;
  intent: string | null;
  attempts: number;
  nextAt: number;
  error: string | null;
}

export async function enqueueUnderstanding(
  db: Db,
  logId: string,
  tab: string,
  queuedAt: number,
  error: string | null = null,
  /** Not before this (ms): a 429 waits a minute, offline retries as soon as the network is back. */
  nextAt = 0,
): Promise<void> {
  await db.runAsync(
    `INSERT INTO understand_queue (voice_log_id, tab, queued_at, last_error, next_at, attempts) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(voice_log_id) DO NOTHING`,
    logId,
    tab,
    queuedAt,
    error,
    nextAt,
    error ? 1 : 0,
  );
}

/** When it was said, for a log waiting in the queue (the entry's time once confirmed); null if it isn't queued. */
export async function queuedAtOf(db: Db, logId: string): Promise<number | null> {
  return (await db.getFirstAsync<{ q: number }>('SELECT queued_at AS q FROM understand_queue WHERE voice_log_id = ?', logId))?.q ?? null;
}

const ITEM_SQL = `
  SELECT q.voice_log_id AS id, q.tab, q.state, q.queued_at AS queuedAt, v.audio_path AS clip,
         v.gemini_transcript AS transcript, v.intent, q.attempts, q.next_at AS nextAt, q.last_error AS error
  FROM understand_queue q JOIN voice_logs v ON v.id = q.voice_log_id`;

/** Every waiting / ready / unclear item, in the order it was said. */
export const pendingItems = (db: Db) => db.getAllAsync<PendingItem>(`${ITEM_SQL} ORDER BY q.queued_at, q.voice_log_id`);

export const pendingCounts = async (db: Db): Promise<{ waiting: number; ready: number; unclear: number }> => {
  const rows = await db.getAllAsync<{ state: QueueState; n: number }>('SELECT state, COUNT(*) AS n FROM understand_queue GROUP BY state');
  const n = (s: QueueState) => rows.find((r) => r.state === s)?.n ?? 0;
  return { waiting: n('waiting'), ready: n('ready'), unclear: n('unclear') };
};

/** The oldest item with an answer to confirm (after `afterId` it was said later, if given). */
export const nextReady = (db: Db) => db.getFirstAsync<PendingItem>(`${ITEM_SQL} WHERE q.state = 'ready' ORDER BY q.queued_at, q.voice_log_id LIMIT 1`);

/** ✕: the clip is thrown away. Returns the file to delete from the phone. */
export async function discardPending(db: Db, w: Writer, id: string): Promise<string | null> {
  const v = await db.getFirstAsync<{ audio_path: string | null; drive_file_id: string | null }>('SELECT audio_path, drive_file_id FROM voice_logs WHERE id = ?', id);
  await db.withTransactionAsync(async () => {
    await setOutcome(db, w, id, 'cancelled');
    await db.runAsync('DELETE FROM understand_queue WHERE voice_log_id = ?', id);
    await db.runAsync('DELETE FROM audio_queue WHERE voice_log_id = ?', id);
    await db.runAsync('UPDATE voice_logs SET audio_path = NULL WHERE id = ?', id); // local column: no bump
    // never on Drive: nothing of it is left anywhere
    if (!v?.drive_file_id) await db.runAsync("UPDATE voice_logs SET audio_status = 'expired', updated_at = ? WHERE id = ?", w.now(), id);
  });
  return v?.audio_path ?? null;
}

export interface RunDeps {
  db: Db;
  /** Sends one clip to Gemini and stores the answer on the voice log (never throws). */
  understand(logId: string, clipUri: string, tab: string): Promise<UnderstandResult>;
  gate: RateGate;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Stop between items when this turns false (network lost, app closing). */
  keepGoing?: () => boolean;
  /** Does the clip still exist on the phone? */
  clipExists?: (uri: string) => Promise<boolean>;
}

export interface RunResult {
  ready: number;
  unclear: number;
  failed: number;
  /** Why the run ended before the end of the queue. */
  stopped: 'offline' | 'rate' | 'error' | 'nokey' | 'cancelled' | null;
}

/**
 * One pass over the waiting items that are due, oldest first, one call per MIN_GAP_MS.
 * A 429 / overload / lost network ends the pass (the rest would fail too) and sets
 * the wait; other failures back off per item and the pass goes on.
 */
export async function runUnderstandQueue(deps: RunDeps): Promise<RunResult> {
  const { db, gate } = deps;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const res: RunResult = { ready: 0, unclear: 0, failed: 0, stopped: null };
  const done = new Set<string>();

  for (;;) {
    if (deps.keepGoing && !deps.keepGoing()) {
      res.stopped = 'cancelled';
      break;
    }
    const item = (
      await db.getAllAsync<PendingItem>(`${ITEM_SQL} WHERE q.state = 'waiting' AND q.next_at <= ? ORDER BY q.queued_at, q.voice_log_id`, now())
    ).find((i) => !done.has(i.id));
    if (!item) break;
    done.add(item.id);

    if (!item.clip || !(await (deps.clipExists ?? (async () => true))(item.clip))) {
      // the recording is gone: nothing to understand
      await db.runAsync("UPDATE understand_queue SET state = 'unclear', last_error = 'no clip' WHERE voice_log_id = ?", item.id);
      res.unclear++;
      continue;
    }
    const wait = gate.waitMs(now());
    if (wait > 0) await sleep(wait);
    gate.mark(now());
    const r = await deps.understand(item.id, item.clip, item.tab);
    const v = classify(r);

    if (v.kind === 'ready' || v.kind === 'unclear') {
      await db.runAsync('UPDATE understand_queue SET state = ?, last_error = NULL WHERE voice_log_id = ?', v.kind, item.id);
      if (v.kind === 'ready') res.ready++;
      else res.unclear++;
      continue;
    }
    if (v.kind === 'nokey') {
      res.stopped = 'nokey';
      break;
    }
    const attempts = item.attempts + 1;
    if (v.form && attempts >= MAX_FORM_ATTEMPTS) {
      await db.runAsync("UPDATE understand_queue SET state = 'unclear', attempts = ?, last_error = ? WHERE voice_log_id = ?", attempts, (r.error ?? '').slice(0, 300), item.id);
      res.unclear++;
      continue;
    }
    // offline: try again the moment the network is back (that is what starts a run);
    // 429 / overload: a minute; anything else: the usual backoff
    const nextAt = v.stop === 'offline' ? now() : now() + (v.waitMs ?? backoffMs(attempts));
    await db.runAsync(
      'UPDATE understand_queue SET attempts = ?, next_at = ?, last_error = ? WHERE voice_log_id = ?',
      attempts,
      nextAt,
      (r.error ?? '').slice(0, 300),
      item.id,
    );
    res.failed++;
    if (v.stop === 'rate' || v.stop === 'error') {
      // the limit is the whole key's, and order matters: everything waits
      await db.runAsync("UPDATE understand_queue SET next_at = MAX(next_at, ?) WHERE state = 'waiting'", nextAt);
    }
    if (v.stop) {
      res.stopped = v.stop;
      break;
    }
  }
  return res;
}
