/**
 * End of speech from the recorder's level (dB), so "থামুন" isn't needed. Pure TS.
 * Stops after the voice was heard and then a stretch of quiet; never before anything was
 * heard (a slow starter keeps the mic), and always at MAX_MS. Without any level readings
 * (a phone that gives none) only MAX_MS and the button end it.
 */
export const SPEECH_DB = -38;
export const QUIET_DB = -46;
export const QUIET_MS = 1_600;
export const MAX_MS = 15_000;
/** Silence before anything was said: give up and say "কিছু শুনতে পাইনি". */
export const NO_SPEECH_MS = 8_000;

export interface EndpointState {
  heard: boolean;
  /** When the level last fell quiet (ms into the recording), or null while speech goes on. */
  quietSince: number | null;
}

export const START: EndpointState = { heard: false, quietSince: null };

export type Verdict = 'go' | 'stop' | 'nothing';

/** One level reading at `t` ms into the recording. */
export function feed(s: EndpointState, db: number | undefined, t: number): { state: EndpointState; verdict: Verdict } {
  if (t >= MAX_MS) return { state: s, verdict: s.heard ? 'stop' : 'nothing' };
  if (db === undefined || Number.isNaN(db)) return { state: s, verdict: 'go' };
  if (db > SPEECH_DB) return { state: { heard: true, quietSince: null }, verdict: 'go' };
  if (!s.heard) return { state: s, verdict: t >= NO_SPEECH_MS ? 'nothing' : 'go' };
  if (db < QUIET_DB) {
    const since = s.quietSince ?? t;
    return { state: { heard: true, quietSince: since }, verdict: t - since >= QUIET_MS ? 'stop' : 'go' };
  }
  return { state: s, verdict: 'go' };
}

/** Level (dB, about −60 … 0) → 0..1 for the sound bars. */
export const barLevel = (db: number | undefined): number => (db === undefined || Number.isNaN(db) ? 0.35 : Math.max(0, Math.min(1, (db + 60) / 50)));
