/**
 * Remote (src/sync/engine.ts) on Firestore: shops/{uid}/{table}/{rowId}.
 * Every write is stamped with `_at` = server time; pulls and listeners ask `_at > since`.
 * Firestore's own offline cache is off: SQLite is the cache and the outbox.
 */
import { getApp } from '@react-native-firebase/app';
import {
  Timestamp,
  collection,
  doc,
  getDocs,
  initializeFirestore,
  onSnapshot,
  query,
  serverTimestamp,
  where,
  writeBatch,
  type DocumentSnapshot,
  type Firestore,
  type QuerySnapshot,
  type Timestamp as TimestampT,
} from '@react-native-firebase/firestore';

import type { DocData, Remote, RemoteDoc } from './engine';

const WRITE_TIMEOUT_MS = 30_000;
const AT = '_at';

let fs: Firestore | null = null;
function db(): Firestore {
  if (!fs) fs = initializeFirestore(getApp(), { persistence: false });
  return fs;
}

function toRemote(d: DocumentSnapshot): RemoteDoc {
  const data = { ...(d.data() ?? {}) } as DocData;
  const at = data[AT] as TimestampT | null | undefined;
  delete data[AT];
  return { id: d.id, data, serverAt: at ? at.toMillis() : null };
}

function timeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('unavailable: write timed out')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

export function firestoreRemote(uid: string): Remote {
  const col = (table: string) => collection(db(), 'shops', uid, table);
  const since = (table: string, ms: number) => query(col(table), where(AT, '>', Timestamp.fromMillis(ms)));
  return {
    async write(table, docs) {
      const batch = writeBatch(db());
      for (const d of docs) batch.set(doc(col(table), d.id), { ...d.data, [AT]: serverTimestamp() });
      await timeout(batch.commit(), WRITE_TIMEOUT_MS);
    },
    async fetchSince(table, ms) {
      const snap = await getDocs(since(table, ms));
      return snap.docs.map(toRemote);
    },
    listen(table, ms, onDocs, onError) {
      return onSnapshot(
        since(table, ms),
        (snap: QuerySnapshot) => {
          const changed = snap
            .docChanges()
            .filter((c) => c.type !== 'removed')
            .map((c) => toRemote(c.doc));
          if (changed.length) onDocs(changed);
        },
        onError,
      );
    },
  };
}
