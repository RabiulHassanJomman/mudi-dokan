/**
 * The understand queue on the phone (RN side of src/queue): clips said while Gemini couldn't
 * answer are sent when it can, oldest first, one call per ~4 s (15 a minute). Starts once
 * (root layout); runs at start, when the network is back, when the app comes forward and
 * a minute after a 429. The answers wait for হ্যাঁ/না on the review screen.
 */
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { File } from 'expo-file-system';
import { addDatabaseChangeListener } from 'expo-sqlite';

import { openBackgroundDb } from '../db/background';
import { BACKGROUND_DEADLINE_MS, RateGate, runUnderstandQueue, type RunResult } from '../queue/understand';
import { hasGemini } from './engine';
import { runGemini } from './gemini';

/** Shared with the live path (Listening), so the two together stay within the free limit. */
export const gate = new RateGate();

let online = true;
let running: Promise<RunResult | null> | null = null;
let again = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let started = false;

let version = 0;
const subs = new Set<(v: number) => void>();
/** The queue changed (something was queued, understood, confirmed or thrown away). */
export const bumpQueue = () => {
  version++;
  for (const fn of subs) fn(version);
};
export function useQueueVersion(): number {
  const [v, setV] = useState(version);
  useEffect(() => {
    subs.add(setV);
    return () => {
      subs.delete(setV);
    };
  }, []);
  return v;
}

export function startUnderstanding(): void {
  if (started) return;
  started = true;
  NetInfo.addEventListener((s) => {
    const was = online;
    online = !!s.isConnected && s.isInternetReachable !== false;
    if (!was && online) kick();
  });
  AppState.addEventListener('change', (s) => {
    if (s === 'active') kick();
  });
  addDatabaseChangeListener((e) => {
    if (e.tableName === 'understand_queue') bumpQueue();
  });
  kick();
}

/** Run now, or right after the current run. Returns that run's result (null when there was nothing to do). */
export function kick(): Promise<RunResult | null> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    let last: RunResult | null = null;
    do {
      again = false;
      last = await once();
    } while (again);
    return last;
  })().finally(() => {
    running = null;
  });
  return running;
}

async function once(): Promise<RunResult | null> {
  if (!hasGemini() || !online) return null;
  const db = await openBackgroundDb();
  if (!db) return null;
  const res = await runUnderstandQueue({
    db,
    gate,
    keepGoing: () => online,
    clipExists: async (uri) => new File(uri).exists,
    understand: async (id, clip, tab) => {
      const r = await runGemini(db, id, clip, { tab, hint: null, deadlineMs: BACKGROUND_DEADLINE_MS });
      return { ok: r.ok, parsed: r.parsed, error: r.error };
    },
  });
  bumpQueue();
  // 429 / overload / a bad answer: look again when the wait is over; "offline" while the network
  // says it is up (a captive portal): try again in a few minutes
  if (res.stopped === 'rate' || res.stopped === 'error' || res.stopped === 'offline') {
    if (timer) clearTimeout(timer);
    const wait = res.stopped === 'rate' ? 62_000 : res.stopped === 'offline' ? 5 * 60_000 : 30 * 60_000;
    timer = setTimeout(() => void kick(), wait);
  }
  return res;
}
