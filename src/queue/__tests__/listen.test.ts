import { RATE_WAIT_MS, backoffMs, classify } from '../understand';
import { queueNext } from '../listen';

const retry = (error: string) => {
  const v = classify({ ok: false, parsed: null, error });
  if (v.kind !== 'retry') throw new Error('not a retry');
  return v;
};

describe('a clip Gemini could not answer', () => {
  it('no internet: waits for the network (not before)', () => {
    expect(queueNext(retry('api: network: Network request failed'), 1000)).toBe(0);
    expect(queueNext(retry('timeout: no answer in 8000 ms'), 1000)).toBe(0);
  });
  it('429 / overloaded: a minute; other errors: the first backoff', () => {
    expect(queueNext(retry('api: HTTP 429: quota'), 1000)).toBe(1000 + RATE_WAIT_MS);
    expect(queueNext(retry('api: HTTP 503: overloaded'), 1000)).toBe(1000 + RATE_WAIT_MS);
    expect(queueNext(retry('weird'), 1000)).toBe(1000 + backoffMs(1));
  });
});
