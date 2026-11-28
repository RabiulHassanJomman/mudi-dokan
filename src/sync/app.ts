/**
 * Sync in the app: one controller for the app's life (RN side of src/sync).
 * - its own SQLite connection, so sync transactions never mix with a screen's save
 *   (busy_timeout makes one wait for the other)
 * - signed in → shops/{uid}; signed out → paused, the app works the same
 * - pushes a few seconds after a save (the screens' connection reports changes),
 *   when the network comes back, and on "এখন সিঙ্ক করুন"
 */
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { addDatabaseChangeListener, openDatabaseAsync } from 'expo-sqlite';

import { DATABASE_NAME } from '../db/client';
import { adoptCloudShop, dismissedMerges, mergeItems, repointMerged } from '../db/repo';
import { clearSession, deviceModel, getDevice, getSession, startSession, writer } from '../device';
import { markSignedIn, markSignedOut } from '../db/devices';
import { afterLocalWipe } from '../wipe/files';
import { duplicatePairs, type MergePair } from '../domain/merge';
import type { Db } from '../db/repo';
import { signOut, watchAccount } from './auth';
import { checkPresence } from './presence';
import { SyncController, type SyncStatus } from './controller';
import { SyncEngine } from './engine';
import { firestoreRemote } from './firestore';
import { SYNC_TABLE_NAMES } from './tables';

let controller: SyncController | null = null;
let syncDbRef: Db | null = null;
let starting: Promise<SyncController> | null = null;

let dataVersion = 0;
const dataSubs = new Set<(v: number) => void>();
const bumpData = () => {
  dataVersion++;
  for (const fn of dataSubs) fn(dataVersion);
};
/** Rows changed outside the screens (backup restore): screens reload. */
export const dataChanged = bumpData;

const firstSyncSubs = new Set<() => void>();

export const BUSY_TIMEOUT_MS = 10_000;

/** Starts once (root layout). Safe to call again. */
export function startSync(): Promise<SyncController> {
  if (controller) return Promise.resolve(controller);
  if (!starting) starting = boot();
  return starting;
}

async function boot(): Promise<SyncController> {
  const syncDb = await openDatabaseAsync(DATABASE_NAME, { useNewConnection: true });
  await syncDb.execAsync(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}; PRAGMA foreign_keys = ON;`);
  const engine = new SyncEngine(syncDb as unknown as Db);
  const ctl = new SyncController(engine, {
    afterApply: () => repointMerged(syncDb as unknown as Db, writer()),
    adoptShop: (shop) => adoptCloudShop(syncDb as unknown as Db, writer(), shop),
    onData: () => {
      bumpData();
      presence();
    },
    afterSync: () => presence(),
    // another phone erased the shop and the user said হ্যাঁ: this phone too, files included
    wipeLocal: async () => {
      await afterLocalWipe(await engine.wipeLocal(getDevice().id));
    },
    onFirstSync: () => {
      for (const fn of firstSyncSubs) fn();
    },
  });
  controller = ctl;
  syncDbRef = syncDb as unknown as Db;

  watchAccount((a) => {
    void (async () => {
      if (a) {
        // ফোনগুলো: this phone says it is signed in (a new session per sign-in), pushed with the first sync
        const session = getSession() ?? startSession();
        await engine
          .exclusive(() => markSignedIn(syncDb as unknown as Db, writer(), session, deviceModel()))
          .catch((e) => console.warn('markSignedIn failed', e));
      } else clearSession();
      await ctl.setAccount(a ? { uid: a.uid, email: a.email, remote: firestoreRemote(a.uid) } : null);
    })();
  });
  NetInfo.addEventListener((s) => ctl.setOnline(!!s.isConnected && s.isInternetReachable !== false));
  AppState.addEventListener('change', (s) => ctl.setActive(s === 'active'));
  // the screens' connection (enableChangeListener) — the sync connection doesn't report
  addDatabaseChangeListener((e) => {
    if (SYNC_TABLE_NAMES.includes(e.tableName)) ctl.localChange();
  });
  return ctl;
}

export const syncController = () => controller;

// ── ফোনগুলো: remote logout, last seen ─────────────────────────

let checking = false;
let leaving = false;
const logoutSubs = new Set<(v: boolean) => void>();
let remoteLoggedOut = false;

/** After a sync or rows from other phones: did an admin log this phone out? */
function presence(): void {
  const ctl = controller;
  const db = syncDbRef;
  if (!ctl || !db || checking || leaving) return;
  checking = true;
  void ctl.engine
    .exclusive(() => checkPresence(db, writer(), getSession()))
    .then(async (p) => {
      if (p === 'touched') ctl.localChange();
      if (p !== 'logout') return;
      await leave(false);
      remoteLoggedOut = true;
      for (const fn of logoutSubs) fn(true);
    })
    .catch((e) => console.warn('presence failed', e))
    .finally(() => {
      checking = false;
    });
}

/**
 * লগ আউট: this phone's row says so and is sent first (a few seconds at most: offline, the
 * next sign-in replaces it anyway), then Google/Firebase sign-out. The data stays on the phone.
 */
async function leave(mark: boolean): Promise<void> {
  const ctl = controller;
  const db = syncDbRef;
  leaving = true;
  try {
    if (ctl && db) {
      if (mark) await ctl.engine.exclusive(() => markSignedOut(db, writer()));
      await Promise.race([ctl.engine.push(), new Promise((r) => setTimeout(r, 5_000))]).catch(() => undefined);
    }
    clearSession();
    await signOut();
  } finally {
    leaving = false;
  }
}

/** The লগ আউট button (AccountCard). */
export const signOutShop = () => leave(true);

/** An admin logged this phone out (the notice shows until ঠিক আছে). */
export function useRemoteLogout(): [boolean, () => void] {
  const [v, setV] = useState(remoteLoggedOut);
  useEffect(() => {
    logoutSubs.add(setV);
    return () => {
      logoutSubs.delete(setV);
    };
  }, []);
  const dismiss = () => {
    remoteLoggedOut = false;
    for (const fn of logoutSubs) fn(false);
  };
  return [v, dismiss];
}

/** Settings › সিঙ্ক, the account card. */
export function useSyncStatus(): SyncStatus | null {
  const [s, setS] = useState<SyncStatus | null>(controller?.current ?? null);
  useEffect(() => {
    let off: (() => void) | undefined;
    void startSync().then((c) => {
      off = c.subscribe(setS);
    });
    return () => off?.();
  }, []);
  return s;
}

/** Changes when rows from another phone went in: add it to a screen's load deps to reload. */
export function useDataVersion(): number {
  const [v, setV] = useState(dataVersion);
  useEffect(() => {
    dataSubs.add(setV);
    return () => {
      dataSubs.delete(setV);
    };
  }, []);
  return v;
}

/** After the first pull from the shop account (merge screen). */
export function onFirstSync(fn: () => void): () => void {
  firstSyncSubs.add(fn);
  return () => firstSyncSubs.delete(fn);
}

/** Products/customers that may be the same (merge screen), minus pairs answered "না". */
export async function mergePairs(db: Db): Promise<MergePair[]> {
  const items = await mergeItems(db);
  const no = await dismissedMerges(db);
  return [...duplicatePairs('product', items.products, no), ...duplicatePairs('customer', items.customers, no)];
}
