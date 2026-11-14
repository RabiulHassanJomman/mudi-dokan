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
import { getDevice, writer } from '../device';
import { afterLocalWipe } from '../wipe/files';
import { duplicatePairs, type MergePair } from '../domain/merge';
import type { Db } from '../db/repo';
import { watchAccount } from './auth';
import { SyncController, type SyncStatus } from './controller';
import { SyncEngine } from './engine';
import { firestoreRemote } from './firestore';
import { SYNC_TABLE_NAMES } from './tables';

let controller: SyncController | null = null;
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
    onData: bumpData,
    // another phone erased the shop and the user said হ্যাঁ: this phone too, files included
    wipeLocal: async () => {
      await afterLocalWipe(await engine.wipeLocal(getDevice().id));
    },
    onFirstSync: () => {
      for (const fn of firstSyncSubs) fn();
    },
  });
  controller = ctl;

  watchAccount((a) => {
    void ctl.setAccount(a ? { uid: a.uid, email: a.email, remote: firestoreRemote(a.uid) } : null);
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
