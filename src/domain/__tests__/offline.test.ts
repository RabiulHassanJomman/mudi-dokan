/** Offline 🎤: record now, read later. */
import {
  READ_MAX_ATTEMPTS,
  afterRead,
  isNetworkError,
  nextReady,
  readBackoffMs,
  saidAtWords,
  waitingNote,
  waitingSpeech,
  waitingTitle,
} from '../offline';
import { fixedProblemWords, readKeyboardText } from '../keyboard';

const complete = (t: string) => !fixedProblemWords(readKeyboardText(t, {}));
const NOW = new Date(2026, 10, 28, 15, 0).getTime();

describe('reading a waiting clip', () => {
  it('a whole command → ready, with the text', () => {
    expect(afterRead({ text: ' সাজু ৫০ টাকা জমা দিয়েছে ' }, 0, NOW, complete)).toEqual({
      state: 'ready', transcript: 'সাজু ৫০ টাকা জমা দিয়েছে', attempts: 1, nextAt: 0, lastError: null,
    });
  });

  it('text with a part missing → unclear, text kept (the card shows it)', () => {
    expect(afterRead({ text: 'সাজু বাকি নিয়েছে' }, 0, NOW, complete)).toMatchObject({ state: 'unclear', transcript: 'সাজু বাকি নিয়েছে' });
  });

  it('still no internet → waiting, tried again later', () => {
    expect(afterRead({ text: null, error: 'network' }, 0, NOW, complete)).toEqual({
      state: 'waiting', transcript: '', attempts: 1, nextAt: NOW + 60_000, lastError: 'network',
    });
    expect(afterRead({ text: null, error: 'server' }, 2, NOW, complete)).toMatchObject({ state: 'waiting', nextAt: NOW + 900_000 });
  });

  it('nothing in the clip, or the phone cannot read files → unclear', () => {
    expect(afterRead({ text: null, error: 'no-speech' }, 0, NOW, complete)).toMatchObject({ state: 'unclear', lastError: 'no-speech' });
    expect(afterRead({ text: '' }, 0, NOW, complete)).toMatchObject({ state: 'unclear', lastError: 'no-speech' });
    expect(afterRead({ text: null, error: 'audio-capture' }, 0, NOW, complete)).toMatchObject({ state: 'unclear', lastError: 'audio-capture' });
  });

  it('cut short by the mic (বলুন opened): not counted, read again soon', () => {
    expect(afterRead({ text: null, error: 'aborted' }, 3, NOW, complete)).toEqual({
      state: 'waiting', transcript: '', attempts: 3, nextAt: NOW, lastError: 'aborted',
    });
  });

  it('gives up after READ_MAX_ATTEMPTS network failures', () => {
    expect(afterRead({ text: null, error: 'network' }, READ_MAX_ATTEMPTS - 2, NOW, complete).state).toBe('waiting');
    expect(afterRead({ text: null, error: 'network' }, READ_MAX_ATTEMPTS - 1, NOW, complete)).toMatchObject({ state: 'unclear', lastError: 'network' });
  });

  it('backoff grows and stays at 3 h', () => {
    expect([1, 2, 3, 4, 5, 9].map(readBackoffMs)).toEqual([60_000, 300_000, 900_000, 3_600_000, 10_800_000, 10_800_000]);
  });

  it('network errors', () => {
    expect(['network', 'server', 'busy'].every(isNetworkError)).toBe(true);
    expect(['no-speech', 'aborted', null, undefined].some(isNetworkError)).toBe(false);
  });
});

describe('home card words', () => {
  it('title with a Bangla count', () => {
    expect(waitingTitle(3)).toBe('অপেক্ষার হিসাব (৩টি)');
  });

  it('note and 🔊 by what is ready', () => {
    expect(waitingNote({ ready: 0, waiting: 2 })).toBe('ইন্টারনেট এলে বুঝে নেব');
    expect(waitingNote({ ready: 1, waiting: 2 })).toBe('১টি দেখুন, ২টি ইন্টারনেটের অপেক্ষায়');
    expect(waitingNote({ ready: 3, waiting: 0 })).toBe('চেপে দেখে হ্যাঁ চাপুন');
    expect(waitingSpeech({ ready: 0, waiting: 2 })).toBe('ইন্টারনেট ছিল না, ২টি কথা রাখা আছে। ইন্টারনেট এলে বুঝে নেব।');
    expect(waitingSpeech({ ready: 2, waiting: 0 })).toBe('ইন্টারনেট ছিল না, ২টি কথা রাখা আছে। চেপে দেখে হ্যাঁ চাপুন।');
    expect(waitingSpeech({ ready: 1, waiting: 1 })).toBe('ইন্টারনেট ছিল না, ২টি কথা রাখা আছে। ১টি দেখা যাবে। চেপে দেখে হ্যাঁ চাপুন।');
  });

  it('when it was said', () => {
    expect(saidAtWords(new Date(2026, 10, 28, 9, 5).getTime(), NOW)).toBe('আজ ০৯:০৫');
    expect(saidAtWords(new Date(2026, 10, 27, 18, 30).getTime(), NOW)).toBe('গতকাল ১৮:৩০');
    expect(saidAtWords(new Date(2026, 10, 11, 7, 0).getTime(), NOW)).toBe('১১ নভে ০৭:০০');
  });
});

describe('the next card', () => {
  const rows = [
    { voice_log_id: 'b', state: 'ready' as const, queued_at: 20 },
    { voice_log_id: 'a', state: 'waiting' as const, queued_at: 10 },
    { voice_log_id: 'c', state: 'unclear' as const, queued_at: 15 },
  ];

  it('oldest read one first (ready or unclear), never a waiting one', () => {
    expect(nextReady(rows)?.voice_log_id).toBe('c');
    expect(nextReady(rows, 'c')?.voice_log_id).toBe('b');
    expect(nextReady([rows[1]!])).toBeNull();
  });
});
