/**
 * Step 8 in the app (RN side of src/drive): Google Drive for voice clips and backups.
 * - its own SQLite connection (like sync), busy_timeout so it waits for a screen's save
 * - runs when: app start, back online, foreground, a clip was queued, দিন শেষ, the
 *   background task (expo-background-task, every few hours), "এখন" buttons
 * - each run: retention (once a day), nightly backup (after 9 pm, or one asked for by
 *   দিন শেষ), then the upload queue. Wi-Fi only (setting, default off) holds the uploads
 *   and the backup, not retention.
 * Without sign-in or the Drive permission nothing goes up; clips wait on the phone.
 */
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { getDocumentAsync } from 'expo-document-picker';
import { addDatabaseChangeListener, openDatabaseAsync } from 'expo-sqlite';

import { canCompress, wavToAac } from '../../modules/audio-compress';
import { DATABASE_NAME } from '../db/client';
import { SCHEMA_VERSION } from '../db/migrations';
import type { Db } from '../db/repo';
import { getDevice } from '../device';
import { dataChanged, syncController } from '../sync/app';
import { watchAccount } from '../sync/auth';
import { ROOT_FOLDER, backupPath, stamp, type DriveApi, type DriveFile } from './api';
import {
  BACKUP_MIME,
  META_BACKUP_AT,
  META_BACKUP_WANTED,
  backupName,
  backupsToDelete,
  exportBackup,
  nightlyDue,
  parseBackup,
  restoreBackup,
  type BackupFile,
  type ParseResult,
  type RestoreResult,
} from './backup';
import { accessToken, askDriveAccess, hasDriveAccess, refreshToken } from './google';
import { getMeta, getMetaNumber, setMeta } from './meta';
import { META_LAST_ERROR, META_LAST_UPLOAD, pendingUploads, runUploadQueue, type ClipFiles } from './queue';
import { META_RETENTION_AT, runRetention } from './retention';
import { restDrive } from './rest';

const META_WIFI_ONLY = 'drive:wifi_only';
/** Retention runs at most this often. */
const RETENTION_EVERY_MS = 20 * 3_600_000;
const BUSY_TIMEOUT_MS = 10_000;

export interface DriveStatus {
  signedIn: boolean;
  /** drive.file allowed (null = not known yet). */
  access: boolean | null;
  online: boolean;
  wifi: boolean;
  wifiOnly: boolean;
  pending: number;
  lastUploadAt: number | null;
  lastBackupAt: number | null;
  lastError: string | null;
  running: boolean;
}

let db: Db | null = null;
let opening: Promise<Db | null> | null = null;
let api: DriveApi | null = null;
let signedIn = false;
let online = true;
let wifi = false;
let access: boolean | null = null;
let running: Promise<void> | null = null;
let again = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let status: DriveStatus = {
  signedIn: false,
  access: null,
  online: true,
  wifi: false,
  wifiOnly: false,
  pending: 0,
  lastUploadAt: null,
  lastBackupAt: null,
  lastError: null,
  running: false,
};
const subs = new Set<(s: DriveStatus) => void>();

/** The Drive connection; null if the DB isn't migrated to this app's version yet (background before first start). */
async function openDb(): Promise<Db | null> {
  if (db) return db;
  if (!opening) {
    opening = (async () => {
      const c = await openDatabaseAsync(DATABASE_NAME, { useNewConnection: true });
      await c.execAsync(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}; PRAGMA foreign_keys = ON;`);
      const v = await c.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
      if (v?.user_version !== SCHEMA_VERSION) {
        await c.closeAsync();
        return null;
      }
      db = c as unknown as Db;
      return db;
    })().finally(() => (opening = null));
  }
  return opening;
}

function driveApi(d: Db): DriveApi {
  if (api) return api;
  api = restDrive({
    token: accessToken,
    refresh: refreshToken,
    fetch: (url, init) => fetch(url, init),
    putFile: async (url, uri, headers) => {
      const r = await new File(uri).upload(url, { httpMethod: 'PUT', headers });
      return { status: r.status, body: r.body };
    },
    downloadTo: async (url, uri, headers) => {
      await File.downloadFileAsync(url, new File(uri), { headers, idempotent: true });
      return { status: 200 };
    },
    cache: {
      get: (k) => getMeta(d, `drive:folder:${k}`),
      set: async (k, v) => {
        if (k === '*') await d.runAsync("DELETE FROM sync_meta WHERE key LIKE 'drive:folder:%'");
        else await setMeta(d, `drive:folder:${k}`, v);
      },
    },
  });
  return api;
}

const clipFiles: ClipFiles = {
  exists: async (uri) => new File(uri).exists,
  remove: async (uri) => {
    const f = new File(uri);
    if (f.exists) f.delete();
  },
  compress: async (uri) => {
    if (!canCompress()) return null;
    const out = uri.replace(/\.wav$/i, '.aac');
    await wavToAac(uri, out, 16_000);
    return out;
  },
};

// ── status ──────────────────────────────────────────────────────

async function publish(patch: Partial<DriveStatus> = {}): Promise<void> {
  const d = db;
  if (d) {
    try {
      patch = {
        pending: await pendingUploads(d),
        lastUploadAt: await getMetaNumber(d, META_LAST_UPLOAD),
        lastBackupAt: await getMetaNumber(d, META_BACKUP_AT),
        lastError: await getMeta(d, META_LAST_ERROR),
        wifiOnly: (await getMeta(d, META_WIFI_ONLY)) === '1',
        ...patch,
      };
    } catch {
      // DB busy: keep the last numbers
    }
  }
  status = { ...status, signedIn, online, wifi, access, ...patch };
  for (const fn of subs) fn(status);
}

export function useDriveStatus(): DriveStatus {
  const [s, setS] = useState(status);
  useEffect(() => {
    subs.add(setS);
    void publish();
    return () => {
      subs.delete(setS);
    };
  }, []);
  return s;
}

// ── run ─────────────────────────────────────────────────────────

/** Starts once (root layout). */
let started = false;
export function startDrive(): void {
  if (started) return;
  started = true;
  void (async () => {
    await openDb();
    watchAccount((a) => {
      signedIn = !!a;
      access = null;
      if (!a) api = null;
      kick();
    });
    NetInfo.addEventListener((s) => {
      const was = online && (!status.wifiOnly || wifi);
      online = !!s.isConnected && s.isInternetReachable !== false;
      wifi = s.type === 'wifi';
      if (!was && online) kick();
      else void publish();
    });
    AppState.addEventListener('change', (s) => {
      if (s === 'active') kick();
    });
    // a new clip was queued (createVoiceLog on the screens' connection)
    addDatabaseChangeListener((e) => {
      if (e.tableName === 'audio_queue') schedule(60_000);
    });
    kick();
  })();
}

function schedule(ms: number): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    kick();
  }, Math.max(1_000, Math.min(ms, 6 * 3_600_000)));
}

/** Run now (or right after the current run). */
export function kick(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    do {
      again = false;
      await runOnce(false);
    } while (again);
  })().finally(() => {
    running = null;
    void publish({ running: false });
  });
  return running;
}

/** Background task / app: one pass of everything that is due. */
async function runOnce(background: boolean): Promise<void> {
  const d = await openDb();
  if (!d) return;
  await publish({ running: true });
  const now = Date.now();
  const canDrive = signedIn && (access ?? (access = await hasDriveAccess().catch(() => false)));
  const net = background ? await NetInfo.fetch() : null;
  if (net) {
    online = !!net.isConnected && net.isInternetReachable !== false;
    wifi = net.type === 'wifi';
  }
  const wifiOnly = (await getMeta(d, META_WIFI_ONLY)) === '1';
  // another phone erased the shop and this one hasn't answered: no clip or backup goes to Drive
  // (it would bring the erased "Mudi Dokan" folder back)
  const paused = (await getMeta(d, 'wipe_pending')) !== null;
  const reach = canDrive && online && !paused;
  const send = reach && (!wifiOnly || wifi);
  const a = canDrive ? driveApi(d) : null;
  try {
    // 1. retention, once a day (local copies even without Drive)
    const lastRet = await getMetaNumber(d, META_RETENTION_AT);
    if (lastRet === null || now - lastRet >= RETENTION_EVERY_MS) {
      const r = await runRetention({ db: d, api: reach ? a : null, removeFile: clipFiles.remove });
      if (r.expired) syncController()?.localChange();
    }
    // 2. nightly backup, or the one দিন শেষ asked for
    if (send && a) {
      const wanted = (await getMeta(d, META_BACKUP_WANTED)) === '1';
      if (wanted || nightlyDue(await getMetaNumber(d, META_BACKUP_AT), now)) await backupWith(d, a);
    }
    // 3. clips
    if (send && a) {
      const r = await runUploadQueue({ db: d, api: a, files: clipFiles });
      if (r.uploaded) {
        await setMeta(d, META_LAST_ERROR, null);
        syncController()?.localChange();
      }
    }
  } catch (e) {
    await setMeta(d, META_LAST_ERROR, e instanceof Error ? e.message : String(e)).catch(() => undefined);
  }
  if (!background) {
    const next = await d.getFirstAsync<{ t: number | null }>('SELECT MIN(next_at) AS t FROM audio_queue');
    if (next?.t != null) schedule(next.t - Date.now());
  }
  await publish({ running: false });
}

/** expo-background-task: the daily jobs while the app is closed. */
export async function runInBackground(): Promise<void> {
  const d = await openDb();
  if (!d) return;
  signedIn = (await hasDriveAccess().catch(() => false)) || signedIn;
  access = signedIn ? true : access;
  await runOnce(true);
}

// ── settings ────────────────────────────────────────────────────

export async function setWifiOnly(on: boolean): Promise<void> {
  const d = await openDb();
  if (!d) return;
  await setMeta(d, META_WIFI_ONLY, on ? 1 : 0);
  await publish();
  if (!on) kick();
}

/** "Drive চালু করুন": Google's consent screen for drive.file. */
export async function enableDrive(): Promise<boolean> {
  access = await askDriveAccess();
  void publish();
  if (access) kick();
  return access;
}

/** Bytes the app keeps on Drive (Drive screen; one request per 1000 files). */
export async function driveUsage(): Promise<number | null> {
  const d = await openDb();
  if (!d || !signedIn || !(await hasDriveAccess())) return null;
  return driveApi(d).usage();
}

// ── backup ──────────────────────────────────────────────────────

async function backupWith(d: Db, a: DriveApi): Promise<number> {
  const now = Date.now();
  const dev = getDevice();
  const b = await exportBackup(d, { deviceId: dev.id, deviceName: dev.name }, now);
  const parent = await a.folder(backupPath);
  await a.uploadText(JSON.stringify(b), backupName(now), BACKUP_MIME, parent);
  await setMeta(d, META_BACKUP_AT, now);
  await setMeta(d, META_BACKUP_WANTED, null);
  try {
    for (const id of backupsToDelete(await a.list(parent))) await a.remove(id);
  } catch {
    // housekeeping: next time
  }
  return now;
}

export type BackupNow = { ok: true; at: number } | { ok: false; reason: 'no_account' | 'no_access' | 'offline' | 'error'; message?: string };

/** "এখন ব্যাকআপ নিন". Wi-Fi only doesn't hold a backup the user asked for. */
export async function backupNow(): Promise<BackupNow> {
  const d = await openDb();
  if (!d) return { ok: false, reason: 'error', message: 'db' };
  if (!signedIn) return { ok: false, reason: 'no_account' };
  if (!(await askDriveAccess())) return { ok: false, reason: 'no_access' };
  access = true;
  if (!online) return { ok: false, reason: 'offline' };
  try {
    const at = await backupWith(d, driveApi(d));
    await publish();
    return { ok: true, at };
  } catch (e) {
    return { ok: false, reason: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}

/** দিন শেষ করুন: back up now if Drive can be reached, else as soon as it can. */
export async function backupAfterDayClose(): Promise<void> {
  const d = await openDb();
  if (!d) return;
  await setMeta(d, META_BACKUP_WANTED, 1);
  void kick();
}

/** "ফাইল হিসেবে শেয়ার": the backup JSON through the share sheet (no Google needed). */
export async function shareBackupFile(): Promise<void> {
  const d = await openDb();
  if (!d) throw new Error('db');
  const dev = getDevice();
  const now = Date.now();
  const b = await exportBackup(d, { deviceId: dev.id, deviceName: dev.name }, now);
  const dir = new Directory(Paths.cache, 'backup');
  if (!dir.exists) dir.create({ intermediates: true });
  const f = new File(dir, backupName(now));
  if (f.exists) f.delete();
  f.create();
  f.write(JSON.stringify(b));
  await Sharing.shareAsync(f.uri, { mimeType: BACKUP_MIME, dialogTitle: 'মুদি দোকান ব্যাকআপ' });
}

/**
 * A backup file kept on this phone (Documents/backup, never wiped) and shown to the share sheet
 * before "সব তথ্য মুছুন". Returns false if there is no way to share (the copy is still kept).
 */
export async function backupBeforeWipe(): Promise<{ uri: string; shared: boolean }> {
  const d = await openDb();
  if (!d) throw new Error('db');
  const dev = getDevice();
  const now = Date.now();
  const b = await exportBackup(d, { deviceId: dev.id, deviceName: dev.name }, now);
  const dir = new Directory(Paths.document, 'backup');
  if (!dir.exists) dir.create({ intermediates: true });
  const f = new File(dir, `before-wipe-${stamp(now)}.json`);
  if (f.exists) f.delete();
  f.create();
  f.write(JSON.stringify(b));
  if (!(await Sharing.isAvailableAsync())) return { uri: f.uri, shared: false };
  await Sharing.shareAsync(f.uri, { mimeType: BACKUP_MIME, dialogTitle: 'মুদি দোকান ব্যাকআপ — মোছার আগে রেখে দিন' });
  return { uri: f.uri, shared: true };
}

/** "সব তথ্য মুছুন": the whole "Mudi Dokan" folder on Drive (audio and backups). false = nothing was there / no access. */
export async function removeDriveFolder(): Promise<boolean> {
  const d = await openDb();
  if (!d || !signedIn || !(await hasDriveAccess())) return false;
  const gone = await driveApi(d).removeFolder([ROOT_FOLDER]);
  api = null; // folder ids are cached no more
  return gone;
}

/** Backups on Drive, newest first. */
export async function listBackups(): Promise<DriveFile[] | null> {
  const d = await openDb();
  if (!d || !signedIn || !(await askDriveAccess())) return null;
  const a = driveApi(d);
  return (await a.list(await a.folder(backupPath))).filter((f) => f.name.startsWith('mudi-dokan-backup-'));
}

export async function loadDriveBackup(fileId: string): Promise<ParseResult> {
  const d = await openDb();
  if (!d) return { ok: false, reason: 'not_backup' };
  return parseBackup(await driveApi(d).downloadText(fileId));
}

/** A backup file from the phone (Downloads, WhatsApp…). null = nothing picked. */
export async function loadBackupFile(): Promise<ParseResult | null> {
  const r = await getDocumentAsync({ type: ['application/json', 'text/plain', '*/*'], copyToCacheDirectory: true });
  if (r.canceled || !r.assets[0]) return null;
  return parseBackup(await new File(r.assets[0].uri).text());
}

const LOCAL_COPIES = 3;

/**
 * "ফেরত আনুন" after হ্যাঁ: a copy of this phone's DB first (Documents/backup, last 3 kept),
 * then merge the backup in (screens' connection), then sync sends only what the cloud lacks.
 */
export async function restoreFrom(screenDb: Db, b: BackupFile): Promise<RestoreResult> {
  const d = (await openDb()) ?? screenDb;
  const dev = getDevice();
  const now = Date.now();
  const dir = new Directory(Paths.document, 'backup');
  if (!dir.exists) dir.create({ intermediates: true });
  const copy = new File(dir, `before-restore-${stamp(now)}.json`);
  if (copy.exists) copy.delete();
  copy.create();
  copy.write(JSON.stringify(await exportBackup(d, { deviceId: dev.id, deviceName: dev.name }, now)));
  const old = dir
    .list()
    .filter((x): x is File => x instanceof File && x.name.startsWith('before-restore-'))
    .sort((x, y) => y.name.localeCompare(x.name))
    .slice(LOCAL_COPIES);
  for (const f of old) f.delete();

  const ctl = syncController();
  const r = await restoreBackup(screenDb, b);
  if (ctl && signedIn) void ctl.restored();
  dataChanged();
  return r;
}

// ── ▶️ ──────────────────────────────────────────────────────────

export type ClipResult = { ok: true; uri: string } | { ok: false; reason: 'offline' | 'no_access' | 'missing' };

/**
 * A ▶️ ref (repo CLIP_SQL) → a playable local file: the clip on this phone, or else the
 * Drive copy, downloaded once into the cache (voice_logs.audio_path, local only).
 */
export async function resolveClip(screenDb: Db, ref: string): Promise<ClipResult> {
  let logId: string | null = null;
  if (ref.startsWith('drive:')) logId = ref.slice(6);
  else {
    if (new File(ref).exists) return { ok: true, uri: ref };
    logId = (await screenDb.getFirstAsync<{ id: string }>('SELECT id FROM voice_logs WHERE audio_path = ?', ref))?.id ?? null;
  }
  if (!logId) return { ok: false, reason: 'missing' };
  const log = await screenDb.getFirstAsync<{ drive_file_id: string | null; audio_status: string }>(
    'SELECT drive_file_id, audio_status FROM voice_logs WHERE id = ?',
    logId,
  );
  if (!log?.drive_file_id || log.audio_status === 'expired') return { ok: false, reason: 'missing' };
  if (!online) return { ok: false, reason: 'offline' };
  const d = await openDb();
  if (!d || !signedIn || !(await askDriveAccess())) return { ok: false, reason: 'no_access' };
  const dir = new Directory(Paths.cache, 'clips');
  if (!dir.exists) dir.create({ intermediates: true });
  const dest = new File(dir, `${logId}.aac`);
  try {
    await driveApi(d).download(log.drive_file_id, dest.uri);
  } catch (e) {
    console.warn('clip download', e);
    return { ok: false, reason: online ? 'missing' : 'offline' };
  }
  await screenDb.runAsync('UPDATE voice_logs SET audio_path = ? WHERE id = ?', dest.uri, logId); // local column
  return { ok: true, uri: dest.uri };
}

