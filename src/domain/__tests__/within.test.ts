import { within } from '../within';

describe('within', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('is true when the wait ends in time', async () => {
    const p = within(Promise.resolve(), 1000);
    await expect(p).resolves.toBe(true);
  });

  it('is false when the wait never ends (the recorder never closed the file)', async () => {
    const p = within(new Promise<void>(() => {}), 1000);
    jest.advanceTimersByTime(1000);
    await expect(p).resolves.toBe(false);
  });

  it('is true when it ends just before the limit', async () => {
    let done!: () => void;
    const p = within(new Promise<void>((r) => (done = r)), 1000);
    jest.advanceTimersByTime(900);
    done();
    await expect(p).resolves.toBe(true);
  });
});
