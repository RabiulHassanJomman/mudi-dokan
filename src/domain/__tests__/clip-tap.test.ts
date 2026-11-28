import { clipIcon, clipTap } from '../clipTap';

describe('clipTap', () => {
  it('starts a clip that is not loaded', () => {
    expect(clipTap(null, false, 'a')).toBe('start');
    expect(clipTap('b', true, 'a')).toBe('start');
  });
  it('pauses the clip that is playing', () => {
    expect(clipTap('a', true, 'a')).toBe('pause');
  });
  it('resumes a paused clip', () => {
    expect(clipTap('a', false, 'a')).toBe('resume');
  });
  it('starts again after a clip ended (current cleared)', () => {
    expect(clipTap(null, false, 'a')).toBe('start');
  });
});

describe('clipIcon', () => {
  it('shows ⏸ only on the playing clip', () => {
    expect(clipIcon('a', true, 'a')).toBe('pause');
    expect(clipIcon('a', true, 'b')).toBe('play');
    expect(clipIcon('a', false, 'a')).toBe('play');
    expect(clipIcon(null, false, null)).toBe('play');
  });
});
