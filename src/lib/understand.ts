/**
 * Offline 🎤, the reading half: while the app is open and the internet is on, each clip waiting
 * in understand_queue goes to the phone's recognizer (Google, bn-BD) as a file (Android 13+),
 * one at a time; the text is read by the fixed formats → ready / unclear (domain/offline.ts).
 * Never while বলুন has the mic (setMicBusy): opening বলুন cuts a read short, it is read again.
 */
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { File } from 'expo-file-system';
import { AudioEncodingAndroid, ExpoSpeechRecognitionModule } from 'expo-speech-recognition';

import { customerAliasMap, knownNames, productAliasMap, type Db } from '../db/repo';
import { dueClip, queueCounts, queuedClips, setReadOutcome } from '../db/understand';
import { writer } from '../device';
import { fixedProblemWords, joinPieces, readKeyboardText } from '../domain/keyboard';
import { afterRead, nextReady } from '../domain/offline';
import { nav } from './nav';

/** Reading a file needs Android 13 (and recording one is only useful then). */
export const CAN_READ_LATER = Platform.OS === 'android' && Number(Platform.Version) >= 33;

/** A clip is at most 60 s; Google gets it in real time, plus a margin. */
const READ_TIMEOUT_MS = 90_000;
const TICK_MS = 60_000;

let online = true;
let micBusy = false;
let reading = false;
let started = false;
let db: Db | null = null;
const listeners = new Set<() => void>();

const changed = () => listeners.forEach((l) => l());

/** Internet as NetInfo last said (unknown reachability counts as online). */
export const isOnline = () => online;

/** Fresh answer, for the moment 🎤 is tapped. */
export async function checkOnline(): Promise<boolean> {
  const s = await NetInfo.fetch().catch(() => null);
  if (s) online = !!s.isConnected && s.isInternetReachable !== false;
  return online;
}

/** বলুন has (or gives back) the mic. Taking it cuts a read short. */
export function setMicBusy(busy: boolean) {
  micBusy = busy;
  if (busy && reading) ExpoSpeechRecognitionModule.abort();
  if (!busy) setTimeout(() => void kick(), 2_000);
}

/** The queue changed (a clip queued, read, or decided): the home card counts again. */
export function queueChanged() {
  changed();
  void kick();
}

/** Called once the DB is ready (root layout). */
export function startUnderstand(d: Db) {
  db = d;
  if (started) return;
  started = true;
  NetInfo.addEventListener((s) => {
    const was = online;
    online = !!s.isConnected && s.isInternetReachable !== false;
    if (online && !was) void kick();
  });
  setInterval(() => void kick(), TICK_MS);
  void checkOnline().then(() => kick());
}

async function kick() {
  if (!db || reading || micBusy || !online || !CAN_READ_LATER) return;
  reading = true;
  try {
    for (;;) {
      if (micBusy || !online) break;
      const clip = await dueClip(db, Date.now());
      if (!clip) break;
      const heard = clip.audio_path && new File(clip.audio_path).exists ? await readFile(clip.audio_path) : { text: null, error: 'missing' };
      const names = await knownNames(db);
      const aliases = await customerAliasMap(db);
      const ctx = { knownProducts: names.products, knownCustomers: [...names.customers, ...Object.keys(aliases)], productAliases: await productAliasMap(db) };
      const complete = (t: string) => !fixedProblemWords(readKeyboardText(t, ctx, { customer: clip.customer ?? undefined }, aliases));
      const o = afterRead(heard, clip.attempts, Date.now(), complete);
      console.log(`MUDI_UNDERSTAND ${clip.voice_log_id} → ${o.state}${o.lastError ? ` (${o.lastError})` : ''}`);
      await setReadOutcome(db, writer(), clip.voice_log_id, o);
      changed();
      // aborted (বলুন took the mic): stop here, the next kick reads it again
      if (o.lastError === 'aborted') break;
    }
  } catch (e) {
    console.warn('understand queue failed', e);
  } finally {
    reading = false;
  }
}

/** One WAV through the recognizer: the final pieces joined, or the error. */
function readFile(uri: string): Promise<{ text: string | null; error: string | null }> {
  return new Promise((resolve) => {
    const pieces: string[] = [];
    let error: string | null = null;
    let done = false;
    const subs = [
      ExpoSpeechRecognitionModule.addListener('result', (e) => {
        const t = (e.results[0]?.transcript ?? '').trim();
        if (e.isFinal && t) pieces.push(t);
      }),
      ExpoSpeechRecognitionModule.addListener('error', (e) => {
        error = e.error;
      }),
      ExpoSpeechRecognitionModule.addListener('end', () => finish()),
    ];
    const timer = setTimeout(() => {
      error ??= 'network';
      ExpoSpeechRecognitionModule.abort();
      setTimeout(finish, 1_500);
    }, READ_TIMEOUT_MS);
    function finish() {
      if (done) return;
      done = true;
      clearTimeout(timer);
      subs.forEach((s) => s.remove());
      resolve({ text: joinPieces(pieces) || null, error });
    }
    try {
      ExpoSpeechRecognitionModule.start({
        lang: 'bn-BD',
        interimResults: false,
        continuous: true,
        maxAlternatives: 1,
        requiresOnDeviceRecognition: false,
        audioSource: { uri, audioChannels: 1, audioEncoding: AudioEncodingAndroid.ENCODING_PCM_16BIT, sampleRate: 16000 },
      });
    } catch (e) {
      error = 'audio-capture';
      console.warn('file recognition did not start', e);
      finish();
    }
  });
}

/** The home card: how many are ready to confirm / still waiting. Counts again on every queue change. */
export function useQueueCounts(d: Db) {
  const [counts, setCounts] = useState({ ready: 0, waiting: 0 });
  useEffect(() => {
    let alive = true;
    const load = () => void queueCounts(d).then((c) => alive && setCounts(c)).catch(() => undefined);
    load();
    listeners.add(load);
    return () => {
      alive = false;
      listeners.delete(load);
    };
  }, [d]);
  return counts;
}

/**
 * Opens the next read clip (oldest first) on the confirm card, after `after` (the one just
 * decided). Returns false when none is ready.
 */
export async function openNextQueued(d: Db, how: 'push' | 'replace', after: string | null = null): Promise<boolean> {
  const next = nextReady(await queuedClips(d), after);
  if (!next) return false;
  const params = {
    logId: next.voice_log_id,
    tab: next.tab,
    queued: '1',
    ...(next.customer ? { customer: next.customer } : {}),
    ...(next.kind ? { kind: next.kind } : {}),
  };
  if (how === 'push') nav.push({ pathname: '/confirm', params });
  else nav.replace({ pathname: '/confirm', params });
  return true;
}
