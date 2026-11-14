import { shownEngine } from '../fallback';

describe('gemini mode: whose result drives the confirm card', () => {
  it('Gemini understood → Gemini', () => {
    expect(shownEngine({ intent: 'sale' }, 'চাল ২ কেজি')).toBe('gemini');
    expect(shownEngine({ intent: 'baki' }, '')).toBe('gemini');
  });

  it('no internet / timeout / API or schema error (no result) → Android, silently', () => {
    expect(shownEngine(null, 'চাল ২ কেজি')).toBe('android');
  });

  it('Gemini did not understand → Android when the recognizer heard something', () => {
    expect(shownEngine({ intent: 'unknown' }, 'চাল ২ কেজি')).toBe('android');
  });

  it('neither → none ("আবার বলুন")', () => {
    expect(shownEngine(null, '  ')).toBe('none');
    expect(shownEngine({ intent: 'unknown' }, '')).toBe('none');
  });
});
