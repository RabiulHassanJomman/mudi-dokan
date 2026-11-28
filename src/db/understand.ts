/**
 * understand_queue (offline 🎤, v16): sentences recorded with no internet, waiting to be read
 * from their WAV by Google's recognizer, then confirmed from the home card. Local only.
 * See domain/offline.ts for the states.
 */
import type { QueueState, ReadOutcome } from '../domain/offline';
import { createVoiceLog, type Db, type Writer } from './repo';

export interface QueuedClip {
  voice_log_id: string;
  tab: string;
  state: QueueState;
  attempts: number;
  next_at: number;
  last_error: string | null;
  /** When it was said: the entry's time. */
  queued_at: number;
  customer: string | null;
  kind: string | null;
  audio_path: string | null;
  transcript: string;
}

const SELECT = `SELECT q.voice_log_id, q.tab, q.state, q.attempts, q.next_at, q.last_error, q.queued_at, q.customer, q.kind,
                       v.audio_path, v.transcript
                FROM understand_queue q JOIN voice_logs v ON v.id = q.voice_log_id`;

/** A sentence recorded offline: its voice log (no text yet) and its place in the queue. */
export async function queueClip(
  db: Db,
  w: Writer,
  /** at: when speaking started (the entry's time); default the log's own time. */
  c: { audioPath: string; tab: string; customer?: string | null; kind?: string | null; at?: number },
): Promise<string> {
  const id = await createVoiceLog(db, w, { transcript: '', source: 'voice', contextTab: c.tab, audioPath: c.audioPath });
  const at = c.at ?? (await db.getFirstAsync<{ created_at: number }>('SELECT created_at FROM voice_logs WHERE id = ?', id))!.created_at;
  await db.runAsync(
    'INSERT INTO understand_queue (voice_log_id, tab, state, attempts, next_at, queued_at, customer, kind) VALUES (?, ?, ?, 0, 0, ?, ?, ?)',
    id,
    c.tab,
    'waiting',
    at,
    c.customer ?? null,
    c.kind ?? null,
  );
  return id;
}

/** Every queued clip, oldest first. */
export const queuedClips = (db: Db) => db.getAllAsync<QueuedClip>(`${SELECT} ORDER BY q.queued_at, q.voice_log_id`);

export const queuedClip = (db: Db, id: string) => db.getFirstAsync<QueuedClip>(`${SELECT} WHERE q.voice_log_id = ?`, id);

/** The next clip to read now (internet is back): waiting, its wait over, oldest first. */
export const dueClip = (db: Db, now: number) =>
  db.getFirstAsync<QueuedClip>(`${SELECT} WHERE q.state = 'waiting' AND q.next_at <= ? ORDER BY q.queued_at LIMIT 1`, now);

export async function queueCounts(db: Db): Promise<{ ready: number; waiting: number }> {
  const r = await db.getFirstAsync<{ ready: number | null; waiting: number | null }>(
    "SELECT SUM(state != 'waiting') AS ready, SUM(state = 'waiting') AS waiting FROM understand_queue",
  );
  return { ready: r?.ready ?? 0, waiting: r?.waiting ?? 0 };
}

/** After one try at reading: the queue row, and the heard text on the log (synced like any log change). */
export async function setReadOutcome(db: Db, w: Writer, id: string, o: ReadOutcome): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      'UPDATE understand_queue SET state = ?, attempts = ?, next_at = ?, last_error = ? WHERE voice_log_id = ?',
      o.state,
      o.attempts,
      o.nextAt,
      o.lastError,
      id,
    );
    if (o.transcript) {
      await db.runAsync("UPDATE voice_logs SET transcript = ?, updated_at = ? WHERE id = ? AND outcome = 'pending'", o.transcript, w.now(), id);
    }
  });
}

/** Decided on the card (হ্যাঁ, না, or shown as not understood): out of the queue. */
export async function leaveQueue(db: Db, id: string): Promise<void> {
  await db.runAsync('DELETE FROM understand_queue WHERE voice_log_id = ?', id);
}
