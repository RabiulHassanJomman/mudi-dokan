import { parseCommand } from '../../parser';
import { createVoiceLog, engineLogs, getVoiceLog, setGeminiResult, setOutcome, setParsed } from '../repo';
import { migratedDb, testWriter } from './nodeDb';

const android = parseCommand('চাল ২ কেজি', { tab: 'sale', knownProducts: ['চাল'] });
const gemini = { ...android, raw: 'চাল দুই কেজি' };

describe('voice log: Android vs Gemini (v7)', () => {
  it('both: Android shown, Gemini written later, even after the save', async () => {
    const db = await migratedDb();
    const w = testWriter();
    const id = await createVoiceLog(db, w, { transcript: 'চাল ২ কেজি', source: 'voice', contextTab: 'sale', engine: 'both', audioPath: 'file:///v.wav' });
    await setParsed(db, w, id, android, { by: 'android', android });
    await setOutcome(db, w, id, 'saved', { final: { items: [] } });
    await setGeminiResult(db, w, id, {
      model: 'gemini-3.5-flash-lite', parsed: gemini, transcript: 'চাল দুই কেজি', error: null, ms: 1234.4,
      usage: { promptTokens: 900, audioTokens: 120, outputTokens: 60, thoughtTokens: 8 },
    });
    const r = (await getVoiceLog(db, id))!;
    expect(r).toMatchObject({
      engine: 'both', parsed_by: 'android', outcome: 'saved', gemini_transcript: 'চাল দুই কেজি', gemini_error: null,
      gemini_model: 'gemini-3.5-flash-lite', gemini_ms: 1234, gemini_prompt_tokens: 900, gemini_audio_tokens: 120,
      gemini_output_tokens: 60, gemini_thought_tokens: 8,
    });
    expect(JSON.parse(r.android_json!)).toEqual(android);
    expect(JSON.parse(r.gemini_json!).raw).toBe('চাল দুই কেজি');
  });

  it('a failed Gemini call keeps the reason and no result', async () => {
    const db = await migratedDb();
    const w = testWriter();
    const id = await createVoiceLog(db, w, { transcript: 'চাল', source: 'voice', contextTab: 'sale', engine: 'gemini' });
    await setGeminiResult(db, w, id, { model: 'm', parsed: null, transcript: null, error: 'timeout: no answer in 8000 ms', ms: 8001, usage: null });
    expect(await getVoiceLog(db, id)).toMatchObject({ gemini_json: null, gemini_error: 'timeout: no answer in 8000 ms', gemini_prompt_tokens: null });
  });

  it('gemini mode: STT failed but Gemini understood → pending, not stt_error', async () => {
    const db = await migratedDb();
    const w = testWriter();
    const id = await createVoiceLog(db, w, { transcript: '', source: 'voice', contextTab: 'sale', engine: 'gemini', sttError: 'no-speech', keepPending: true });
    expect(await getVoiceLog(db, id)).toMatchObject({ outcome: 'pending', stt_error: 'no-speech' });
    const plain = await createVoiceLog(db, w, { transcript: '', source: 'voice', contextTab: 'sale', sttError: 'no-speech' });
    expect(await getVoiceLog(db, plain)).toMatchObject({ outcome: 'stt_error', engine: null });
  });

  it('engineLogs: voice logs with an engine since a time', async () => {
    const db = await migratedDb();
    const w = testWriter();
    await createVoiceLog(db, w, { transcript: 'পুরনো', source: 'voice', contextTab: 'sale' });
    await createVoiceLog(db, w, { transcript: 'লেখা', source: 'typed', contextTab: 'sale' });
    await createVoiceLog(db, w, { transcript: 'চাল', source: 'voice', contextTab: 'sale', engine: 'both' });
    expect((await engineLogs(db, 0)).map((r) => r.transcript)).toEqual(['চাল']);
  });
});
