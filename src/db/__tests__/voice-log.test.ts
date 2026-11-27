import { createVoiceLog, debugLog, getVoiceLog } from '../repo';
import { migratedDb, testWriter } from './nodeDb';

describe('voice log', () => {
  it('a keyboard entry is engine android, no clip', async () => {
    const db = await migratedDb();
    const w = testWriter();
    const id = await createVoiceLog(db, w, { transcript: 'সাজু বাকি ১০০ টাকা', source: 'voice', contextTab: 'sale' });
    expect(await getVoiceLog(db, id)).toMatchObject({ outcome: 'pending', audio_path: null, audio_status: 'none' });
  });

  it('recognizer failed → stt_error', async () => {
    const db = await migratedDb();
    const w = testWriter();
    const id = await createVoiceLog(db, w, { transcript: '', source: 'voice', contextTab: 'sale', sttError: 'no-speech' });
    expect(await getVoiceLog(db, id)).toMatchObject({ outcome: 'stt_error' });
  });

  it('debugLog: the last voice commands, newest first, at most 200', async () => {
    const db = await migratedDb();
    const w = testWriter();
    await createVoiceLog(db, w, { transcript: 'লেখা', source: 'typed', contextTab: 'sale' });
    for (let i = 0; i < 205; i++) await createVoiceLog(db, w, { transcript: `কথা ${i}`, source: 'voice', contextTab: 'sale' });
    const rows = await debugLog(db);
    expect(rows).toHaveLength(200);
    expect(rows[0]!.transcript).toBe('কথা 204');
    expect(rows.every((r) => r.source === 'voice')).toBe(true);
    expect(await debugLog(db, 3)).toHaveLength(3);
  });
});
