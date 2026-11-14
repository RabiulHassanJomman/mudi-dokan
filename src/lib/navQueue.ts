/**
 * Navigation that never crashes before the root navigator is mounted.
 * expo-router's global `router` throws "The imperative router is unavailable before the
 * first render has finished" while its routing bridge is unbound (cold start, activity
 * re-create, `am start`). Calls made then are queued and run in order once the navigator
 * is ready (setReady) or a retry succeeds. Pure TS: the router and the timer are injected.
 */

export interface RouterLike {
  push(href: never): void;
  replace(href: never): void;
  back(): void;
  canGoBack(): boolean;
}

const NOT_READY = /before the first render/i;
export const isNotReadyError = (e: unknown) => e instanceof Error && NOT_READY.test(e.message);

export interface NavQueueOptions {
  /** Retry every `retryMs` while calls wait (in case setReady never comes). */
  retryMs?: number;
  /** Give up on a waiting call after this long (a stale tap shouldn't navigate much later). */
  maxWaitMs?: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
}

export function createNavQueue<R extends RouterLike>(router: R, opts: NavQueueOptions = {}) {
  const retryMs = opts.retryMs ?? 100;
  const maxWaitMs = opts.maxWaitMs ?? 5000;
  const now = opts.now ?? Date.now;
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  let ready = false;
  let timer = false;
  const waiting: { run: () => void; at: number }[] = [];

  /** Runs queued calls in order; stops at the first that still isn't possible. */
  function flush() {
    while (waiting.length) {
      const next = waiting[0]!;
      if (now() - next.at > maxWaitMs) {
        waiting.shift();
        continue;
      }
      try {
        next.run();
        waiting.shift();
      } catch (e) {
        if (!isNotReadyError(e)) {
          waiting.shift();
          throw e;
        }
        ready = false;
        schedule();
        return;
      }
    }
  }

  function schedule() {
    if (timer) return;
    timer = true;
    setTimer(() => {
      timer = false;
      flush();
    }, retryMs);
  }

  /** Run now when possible, else queue (calls keep their order). */
  function run(fn: () => void) {
    if (waiting.length) {
      waiting.push({ run: fn, at: now() });
      return schedule();
    }
    try {
      fn();
    } catch (e) {
      if (!isNotReadyError(e)) throw e;
      ready = false;
      waiting.push({ run: fn, at: now() });
      schedule();
    }
  }

  return {
    push: (href: Parameters<R['push']>[0]) => run(() => router.push(href)),
    replace: (href: Parameters<R['replace']>[0]) => run(() => router.replace(href)),
    back: () => run(() => router.back()),
    /** false while the navigator isn't ready. */
    canGoBack: () => {
      try {
        return router.canGoBack();
      } catch (e) {
        if (isNotReadyError(e)) return false;
        throw e;
      }
    },
    /** The root navigator mounted (useRootNavigationState has a key): run what waited. */
    setReady(r: boolean) {
      ready = r;
      if (r) flush();
    },
    get ready() {
      return ready;
    },
    get pending() {
      return waiting.length;
    },
  };
}
