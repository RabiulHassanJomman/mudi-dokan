/** understand_queue (offline 🎤): recorded with no internet, read later, confirmed from home. */
import { leaveQueue, queueClip, queueCounts, queuedClip, queuedClips, dueClip, setReadOutcome } from '../understand';
import { getVoiceLog } from '../repo';
import { afterRead } from '../../domain/offline';
import { migratedDb, testWriter } from './nodeDb';

const T0 = 1_763_000_000_000;
const ready = () => true;

async function setup() {
  const db = await migratedDb();
  const w = testWriter(T0);
  return { db, w };
}

describe('understand_queue', () => {
  it('a recorded sentence: a voice log with the clip and no text, waiting, at the time it was said', async () => {
    const { db, w } = await setup();
    const id = await queueClip(db, w, { audioPath: 'file:///doc/off_1.wav', tab: 'ledger', customer: 'সাজু', kind: 'joma' });
    const q = (await queuedClip(db, id))!;
    expect(q).toMatchObject({ tab: 'ledger', state: 'waiting', attempts: 0, next_at: 0, customer: 'সাজু', kind: 'joma', audio_path: 'file:///doc/off_1.wav', transcript: '' });
    const log = (await getVoiceLog(db, id))!;
    expect(log).toMatchObject({ outcome: 'pending', source: 'voice', context_tab: 'ledger', transcript: '' });
    expect(q.queued_at).toBe(log.created_at);
    expect(await queueCounts(db)).toEqual({ ready: 0, waiting: 1 });
    // the recorder's start time, when given
    const b = await queueClip(db, w, { audioPath: 'file:///doc/off_2.wav', tab: 'sale', at: T0 - 5_000 });
    expect((await queuedClip(db, b))!.queued_at).toBe(T0 - 5_000);
  });

  it('due: waiting ones whose wait is over, oldest first', async () => {
    const { db, w } = await setup();
    const a = await queueClip(db, w, { audioPath: 'file:///doc/a.wav', tab: 'sale' });
    const b = await queueClip(db, w, { audioPath: 'file:///doc/b.wav', tab: 'sale' });
    expect((await dueClip(db, T0 + 1_000_000))?.voice_log_id).toBe(a);
    // a is tried, no internet yet: b is next, a waits a minute
    await setReadOutcome(db, w, a, afterRead({ text: null, error: 'network' }, 0, T0 + 10, ready));
    expect((await dueClip(db, T0 + 20))?.voice_log_id).toBe(b);
    await setReadOutcome(db, w, b, afterRead({ text: null, error: 'network' }, 0, T0 + 10, ready));
    expect(await dueClip(db, T0 + 20)).toBeNull();
    expect((await dueClip(db, T0 + 10 + 60_000))?.voice_log_id).toBe(a);
  });

  it('read: the heard text goes on the log, the row becomes ready; counts follow', async () => {
    const { db, w } = await setup();
    const a = await queueClip(db, w, { audioPath: 'file:///doc/a.wav', tab: 'sale' });
    await queueClip(db, w, { audioPath: 'file:///doc/b.wav', tab: 'sale' });
    const upd = async () => (await db.getFirstAsync<{ updated_at: number }>('SELECT updated_at FROM voice_logs WHERE id = ?', a))!.updated_at;
    const before = await upd();
    await setReadOutcome(db, w, a, afterRead({ text: 'নগদ বিক্রি ১০০ টাকা' }, 0, T0, ready));
    expect(await queuedClip(db, a)).toMatchObject({ state: 'ready', attempts: 1, transcript: 'নগদ বিক্রি ১০০ টাকা', last_error: null });
    expect(await upd()).toBeGreaterThan(before); // synced to the other phones
    expect(await queueCounts(db)).toEqual({ ready: 1, waiting: 1 });
    expect((await queuedClips(db)).map((r) => r.state)).toEqual(['ready', 'waiting']);
  });

  it('decided on the card: out of the queue (the log stays)', async () => {
    const { db, w } = await setup();
    const a = await queueClip(db, w, { audioPath: 'file:///doc/a.wav', tab: 'sale' });
    await leaveQueue(db, a);
    expect(await queuedClips(db)).toEqual([]);
    expect(await queueCounts(db)).toEqual({ ready: 0, waiting: 0 });
    expect(await getVoiceLog(db, a)).not.toBeNull();
  });
});
