import { createNavQueue, isNotReadyError } from '../navQueue';

const notReady = () => {
  throw new Error('The imperative router is unavailable before the first render has finished.');
};

function fakeRouter() {
  const calls: string[] = [];
  let bound = false;
  const r = {
    push: (h: never) => (bound ? calls.push(`push ${String(h)}`) : notReady()),
    replace: (h: never) => (bound ? calls.push(`replace ${String(h)}`) : notReady()),
    back: () => (bound ? calls.push('back') : notReady()),
    canGoBack: () => (bound ? true : notReady()),
  };
  return { r, calls, bind: (b: boolean) => (bound = b) };
}

function clock() {
  let t = 0;
  const timers: { fn: () => void; at: number }[] = [];
  return {
    now: () => t,
    setTimer: (fn: () => void, ms: number) => timers.push({ fn, at: t + ms }),
    advance(ms: number) {
      t += ms;
      for (const x of timers.splice(0).filter((x) => x.at <= t)) x.fn();
    },
  };
}

describe('navQueue: no crash before the navigator is mounted', () => {
  it('a ready router navigates at once', () => {
    const f = fakeRouter();
    f.bind(true);
    const nav = createNavQueue(f.r);
    nav.push('/cash' as never);
    expect(f.calls).toEqual(['push /cash']);
  });

  it('not ready: the tap is queued (no throw) and runs, in order, when ready', () => {
    const f = fakeRouter();
    const c = clock();
    const nav = createNavQueue(f.r, { now: c.now, setTimer: c.setTimer });
    expect(() => nav.push('/cash' as never)).not.toThrow();
    nav.replace('/history' as never);
    expect(nav.pending).toBe(2);
    expect(nav.canGoBack()).toBe(false);
    f.bind(true);
    nav.attach(f.r);
    expect(f.calls).toEqual(['push /cash', 'replace /history']);
    expect(nav.pending).toBe(0);
  });

  it('the retry timer runs it even without an attach', () => {
    const f = fakeRouter();
    const c = clock();
    const nav = createNavQueue(f.r, { now: c.now, setTimer: c.setTimer, retryMs: 100 });
    nav.back();
    c.advance(100);
    expect(f.calls).toEqual([]);
    f.bind(true);
    c.advance(100);
    expect(f.calls).toEqual(['back']);
  });

  it('a stale tap is dropped after maxWaitMs', () => {
    const f = fakeRouter();
    const c = clock();
    const nav = createNavQueue(f.r, { now: c.now, setTimer: c.setTimer, retryMs: 100, maxWaitMs: 300 });
    nav.push('/cash' as never);
    for (let i = 0; i < 5; i++) c.advance(100);
    f.bind(true);
    nav.attach(f.r);
    expect(f.calls).toEqual([]);
    expect(nav.pending).toBe(0);
  });

  it('other errors are not swallowed', () => {
    const nav = createNavQueue({ push: () => { throw new Error('bad href'); }, replace: () => {}, back: () => {}, canGoBack: () => true });
    expect(() => nav.push('/x' as never)).toThrow('bad href');
    expect(isNotReadyError(new Error('bad href'))).toBe(false);
  });
});

describe('navQueue: what it logs (to find the stuck-after-install bug)', () => {
  it('each call, a wait for the router, and a tap dropped after maxWaitMs', () => {
    const f = fakeRouter();
    const c = clock();
    const log: string[] = [];
    const nav = createNavQueue(f.r, { now: c.now, setTimer: c.setTimer, retryMs: 100, maxWaitMs: 300, log: (m) => log.push(m) });
    nav.push('/say' as never);
    for (let i = 0; i < 5; i++) c.advance(100);
    expect(f.calls).toEqual([]);
    expect(log).toEqual(['nav push "/say"', 'nav waiting: router not ready', 'nav dropped after 400 ms: push "/say"']);
  });

});

describe('navQueue: each mounted app root brings its own router (attach)', () => {
  /** A root's own router (expo-router useRouter): works while that root is mounted. */
  function rootRouter(name: string, calls: string[]) {
    return {
      push: (h: never) => void calls.push(`${name} push ${String(h)}`),
      replace: (h: never) => void calls.push(`${name} replace ${String(h)}`),
      back: () => void calls.push(`${name} back`),
      canGoBack: () => true,
    };
  }

  it('Android relaunch after an update: root B mounts, then root A unmounts; taps still work (B)', () => {
    const global = fakeRouter(); // expo-router's global router: A's unmount unbound it
    const calls: string[] = [];
    const nav = createNavQueue(global.r);
    const detachA = nav.attach(rootRouter('A', calls));
    nav.attach(rootRouter('B', calls));
    detachA();
    nav.push('/say' as never);
    expect(calls).toEqual(['B push /say']);
    expect(nav.canGoBack()).toBe(true);
  });

  it('the newest mounted root is used; when none is attached, the global router', () => {
    const global = fakeRouter();
    global.bind(true);
    const calls: string[] = [];
    const nav = createNavQueue(global.r);
    const detachA = nav.attach(rootRouter('A', calls));
    const detachB = nav.attach(rootRouter('B', calls));
    nav.push('/1' as never);
    detachB();
    nav.push('/2' as never);
    detachA();
    nav.push('/3' as never);
    expect(calls).toEqual(['B push /1', 'A push /2']);
    expect(global.calls).toEqual(['push /3']);
  });

  it('a tap that waited runs as soon as a root attaches', () => {
    const global = fakeRouter();
    const c = clock();
    const calls: string[] = [];
    const nav = createNavQueue(global.r, { now: c.now, setTimer: c.setTimer });
    nav.push('/cash' as never);
    expect(nav.pending).toBe(1);
    nav.attach(rootRouter('A', calls));
    expect(calls).toEqual(['A push /cash']);
    expect(nav.pending).toBe(0);
  });

  it('detaching twice is harmless', () => {
    const global = fakeRouter();
    const calls: string[] = [];
    const nav = createNavQueue(global.r);
    const detachA = nav.attach(rootRouter('A', calls));
    nav.attach(rootRouter('B', calls));
    detachA();
    detachA();
    nav.back();
    expect(calls).toEqual(['B back']);
  });
});
