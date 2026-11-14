import { MAX_MS, NO_SPEECH_MS, QUIET_MS, START, barLevel, feed, type EndpointState } from '../endpoint';

/** Runs readings (dB every 100 ms) until a stop, returns when. */
function run(levels: (number | undefined)[]): { at: number | null; verdict: string } {
  let s: EndpointState = START;
  for (const [i, db] of levels.entries()) {
    const r = feed(s, db, i * 100);
    s = r.state;
    if (r.verdict !== 'go') return { at: i * 100, verdict: r.verdict };
  }
  return { at: null, verdict: 'go' };
}
const times = (n: number, db: number | undefined) => Array<number | undefined>(n).fill(db);

describe('end of speech', () => {
  it('stops QUIET_MS after the voice goes quiet', () => {
    const r = run([...times(10, -60), ...times(20, -20), ...times(40, -60)]);
    expect(r.verdict).toBe('stop');
    expect(r.at).toBe(30 * 100 + QUIET_MS); // quiet from 3.0 s, stop 1.6 s later
  });
  it('a pause shorter than that between words does not stop it', () => {
    const r = run([...times(20, -20), ...times(8, -60), ...times(20, -20), ...times(25, -60)]);
    expect(r.verdict).toBe('stop');
    expect(r.at).toBeGreaterThan(48 * 100);
  });
  it('never stops before anything was heard; gives up after NO_SPEECH_MS', () => {
    expect(run(times(70, -60)).verdict).toBe('go');
    expect(run(times(90, -60))).toEqual({ at: NO_SPEECH_MS, verdict: 'nothing' });
  });
  it('speech all the way: stops at MAX_MS with what was said', () => {
    expect(run(times(200, -20))).toEqual({ at: MAX_MS, verdict: 'stop' });
  });
  it('a phone with no level readings: only MAX_MS (nothing heard → "nothing"), the button ends it otherwise', () => {
    expect(run(times(120, undefined)).verdict).toBe('go');
    expect(run(times(160, undefined))).toEqual({ at: MAX_MS, verdict: 'nothing' });
  });
  it('bar level', () => {
    expect(barLevel(-60)).toBe(0);
    expect(barLevel(-10)).toBe(1);
    expect(barLevel(undefined)).toBe(0.35);
  });
});
