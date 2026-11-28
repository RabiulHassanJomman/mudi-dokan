/**
 * Offline 🎤: record now, read later (docs/PLAN.md › Offline 🎤). With no internet the বলুন screen
 * records the sentence (16 kHz WAV) and it waits in understand_queue; when the internet is back
 * the clip goes to the same Google recognizer as a file, and its text is read by the fixed
 * formats. The shopkeeper confirms each one from the home card, saved with the time it was said.
 * Pure TS.
 */
import { dayLabel, toBnDigits } from '../lib/bn';

export type QueueState = 'waiting' | 'ready' | 'unclear';

/** Errors that mean "no internet / Google not reachable": try the clip again later. */
const NETWORK_ERRORS = new Set(['network', 'server', 'server-disconnected', 'busy']);
export const isNetworkError = (code: string | null | undefined) => !!code && NETWORK_ERRORS.has(code);

/** Wait before reading a clip again after a network failure: 1 min, 5 min, 15 min, 1 h, then every 3 h. */
export const READ_BACKOFF_MS = [60_000, 300_000, 900_000, 3_600_000, 10_800_000] as const;
export const readBackoffMs = (attempts: number) =>
  READ_BACKOFF_MS[Math.min(Math.max(attempts, 1), READ_BACKOFF_MS.length) - 1]!;
/** After this many failed reads a clip is shown as unclear (it can still be played and typed). */
export const READ_MAX_ATTEMPTS = 8;

export interface ReadOutcome {
  state: QueueState;
  /** What Google heard ('' when nothing). */
  transcript: string;
  attempts: number;
  nextAt: number;
  lastError: string | null;
}

/**
 * One try at reading a waiting clip → its next queue state.
 * text: what the recognizer gave (null = nothing); error: its error code, if any;
 * complete: does the text make a whole command (the card can open without asking)?
 */
export function afterRead(
  r: { text: string | null; error?: string | null },
  attempts: number,
  now: number,
  complete: (text: string) => boolean,
): ReadOutcome {
  const tries = attempts + 1;
  const text = (r.text ?? '').trim();
  if (text) return { state: complete(text) ? 'ready' : 'unclear', transcript: text, attempts: tries, nextAt: 0, lastError: null };
  const error = r.error ?? 'no-speech';
  // cut short (the shopkeeper opened বলুন, which needs the recognizer): not a try, read it again soon
  if (error === 'aborted') return { state: 'waiting', transcript: '', attempts, nextAt: now, lastError: error };
  if (isNetworkError(error) && tries < READ_MAX_ATTEMPTS) {
    return { state: 'waiting', transcript: '', attempts: tries, nextAt: now + readBackoffMs(tries), lastError: error };
  }
  // nothing was heard in the clip, the phone can't read files, or it kept failing
  return { state: 'unclear', transcript: '', attempts: tries, nextAt: 0, lastError: error };
}

/** The home card: "অপেক্ষার হিসাব (৩টি)". */
export const waitingTitle = (n: number) => `অপেক্ষার হিসাব (${toBnDigits(n)}টি)`;

/** Under the title: how many are still waiting for the internet. */
export function waitingNote(c: { ready: number; waiting: number }): string {
  if (c.waiting && !c.ready) return 'ইন্টারনেট এলে বুঝে নেব';
  if (c.waiting) return `${toBnDigits(c.ready)}টি দেখুন, ${toBnDigits(c.waiting)}টি ইন্টারনেটের অপেক্ষায়`;
  return 'চেপে দেখে হ্যাঁ চাপুন';
}

/** 🔊 on the home card. */
export function waitingSpeech(c: { ready: number; waiting: number }): string {
  const n = c.ready + c.waiting;
  const head = `ইন্টারনেট ছিল না, ${toBnDigits(n)}টি কথা রাখা আছে।`;
  if (!c.ready) return `${head} ইন্টারনেট এলে বুঝে নেব।`;
  return `${head} ${c.waiting ? `${toBnDigits(c.ready)}টি দেখা যাবে। ` : ''}চেপে দেখে হ্যাঁ চাপুন।`;
}

/** "আজ ১০:০৫" / "গতকাল ১৮:৩০" / "১১ নভে ০৯:১৫": when it was said. */
export function saidAtWords(ms: number, now = Date.now()): string {
  const d = new Date(ms);
  const two = (n: number) => toBnDigits(String(n).padStart(2, '0'));
  return `${dayLabel(ms, now)} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

/** Said before recording starts (no internet): then the chime, then speak. */
export const OFFLINE_START_WORDS = 'ইন্টারনেট নেই। টুং শব্দের পর বলুন, রেখে দেব, পরে বুঝে নেব।';
/** Recorded and queued. */
export const OFFLINE_SAVED_WORDS = 'রেখে দিলাম। ইন্টারনেট এলে বুঝে নেব। পরে বিক্রি পাতায় অপেক্ষার হিসাব চেপে হ্যাঁ দিন।';
/** Recording ended with no speech. */
export const OFFLINE_NOTHING_WORDS = 'কিছু শুনিনি। আবার বলুন চাপুন।';
/** Android 12 and older can't read a clip later: nothing to do offline. */
export const OFFLINE_UNSUPPORTED_WORDS = 'ইন্টারনেট নেই। এই ফোনে পরে বোঝা যায় না। লিখুন বা ছবি দেখে দিন।';

/** Recorder limits (native WavRecorder). */
export const RECORD_LIMITS = {
  /** Stop after this much quiet once speech was heard. */
  silenceMs: 2000,
  /** Give up when nothing is said this long. */
  startTimeoutMs: 7000,
  /** One sentence at most. */
  maxMs: 60_000,
} as const;

/** The card after this one: the next ready clip, oldest first (null = back home). */
export function nextReady<T extends { state: QueueState; queued_at: number; voice_log_id: string }>(
  rows: readonly T[],
  after: string | null = null,
): T | null {
  const ready = rows.filter((r) => r.state !== 'waiting' && r.voice_log_id !== after);
  return [...ready].sort((a, b) => a.queued_at - b.queued_at)[0] ?? null;
}
