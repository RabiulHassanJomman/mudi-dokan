import { withTimeout } from '../withTimeout';

describe('withTimeout', () => {
  it('passes the result through, or the rejection', async () => {
    await expect(withTimeout(Promise.resolve(3), 50, 'x')).resolves.toBe(3);
    await expect(withTimeout(Promise.reject(new Error('boom')), 50, 'x')).rejects.toThrow('boom');
  });
  it('gives up on a promise that never ends', async () => {
    await expect(withTimeout(new Promise(() => undefined), 20, 'gemini')).rejects.toThrow('gemini timed out');
  });
});
