import { audioMime, fitAudio, joinWavs, MAX_AUDIO_BYTES, readWav, toBase64, wavFile } from '../audio';

/** 16 kHz mono 16-bit WAV of `seconds`, a ramp so the averaging is checkable. */
function clip(seconds: number, rate = 16000): Uint8Array {
  const n = Math.round(seconds * rate);
  const pcm = new Uint8Array(n * 2);
  const v = new DataView(pcm.buffer);
  for (let i = 0; i < n; i++) v.setInt16(i * 2, (i % 200) * 10, true);
  return wavFile(pcm, rate, 1, 16);
}

describe('audio for Gemini', () => {
  it('base64 matches Node', () => {
    for (const s of ['', 'a', 'ab', 'abc', 'abcd', 'বাংলা']) {
      const b = new TextEncoder().encode(s);
      expect(toBase64(b)).toBe(Buffer.from(b).toString('base64'));
    }
  });

  it('reads the recognizer’s WAV header', () => {
    expect(readWav(clip(1))).toEqual({ channels: 1, sampleRate: 16000, bits: 16, dataAt: 44, dataLen: 32000 });
    expect(readWav(new TextEncoder().encode('not a wav file at all, just some text here...'))).toBeNull();
  });

  it('a short clip (5 s ≈ 160 KB) goes as is', () => {
    const b = clip(5);
    const a = fitAudio(b, 'audio/wav');
    expect(a).toEqual({ mimeType: 'audio/wav', base64: Buffer.from(b).toString('base64'), bytes: b.length });
  });

  it('a long clip is halved to 8 kHz to stay under 1 MB', () => {
    const a = fitAudio(clip(40), 'audio/wav'); // 1.28 MB
    expect(a.shrunk).toBe('downsampled');
    expect(a.bytes).toBeLessThan(MAX_AUDIO_BYTES);
    const out = new Uint8Array(Buffer.from(a.base64, 'base64'));
    const w = readWav(out)!;
    expect(w.sampleRate).toBe(8000);
    expect(w.dataLen).toBe(40 * 8000 * 2);
    // first sample = average of samples 0 and 1 (0 and 10)
    expect(new DataView(out.buffer).getInt16(44, true)).toBe(5);
  });

  it('a very long clip is also cut to fit', () => {
    const a = fitAudio(clip(70), 'audio/wav');
    expect(a.shrunk).toBe('downsampled+cut');
    expect(a.bytes).toBeLessThanOrEqual(MAX_AUDIO_BYTES);
  });

  it('a big clip that is not 16-bit mono WAV is refused', () => {
    expect(() => fitAudio(new Uint8Array(MAX_AUDIO_BYTES + 1), 'audio/aac')).toThrow(/too big/);
  });

  it('mime types Gemini takes', () => {
    expect(audioMime('file:///data/voice_1.wav')).toBe('audio/wav');
    expect(audioMime('rec.aac')).toBe('audio/aac');
    expect(audioMime('rec.m4a')).toBeNull();
  });
});

describe('joinWavs (pause and resume)', () => {
  it('one clip comes back as it is', () => {
    const a = clip(1);
    expect(joinWavs([a])).toBe(a);
  });

  it('joins clips into one WAV: samples in order, one header', () => {
    const a = clip(1);
    const b = clip(0.5);
    const j = joinWavs([a, b]);
    const w = readWav(j)!;
    expect(w.sampleRate).toBe(16000);
    expect(w.channels).toBe(1);
    expect(w.dataLen).toBe(16000 * 2 + 8000 * 2);
    expect(j.length).toBe(44 + w.dataLen);
    const ra = readWav(a)!;
    const rb = readWav(b)!;
    expect(Array.from(j.subarray(w.dataAt, w.dataAt + ra.dataLen))).toEqual(Array.from(a.subarray(ra.dataAt, ra.dataAt + ra.dataLen)));
    expect(Array.from(j.subarray(w.dataAt + ra.dataLen))).toEqual(Array.from(b.subarray(rb.dataAt, rb.dataAt + rb.dataLen)));
  });

  it('skips a clip that is not a WAV (a segment with no sound)', () => {
    const a = clip(1);
    expect(readWav(joinWavs([new Uint8Array(10), a, new Uint8Array(0)]))!.dataLen).toBe(readWav(a)!.dataLen);
  });

  it('refuses clips with different sample rates', () => {
    expect(() => joinWavs([clip(1), clip(1, 8000)])).toThrow();
  });

  it('nothing usable is an error', () => {
    expect(() => joinWavs([])).toThrow();
    expect(() => joinWavs([new Uint8Array(5)])).toThrow();
  });
});
