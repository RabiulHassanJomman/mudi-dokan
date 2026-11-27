import { joinWav, wavInfo } from '../wav';

/** A PCM WAV: 16 kHz mono 16-bit unless given; `extra` = a chunk before "data" (like Android's LIST). */
function wav(samples: number[], opts: { rate?: number; channels?: number; extra?: boolean } = {}): Uint8Array {
  const rate = opts.rate ?? 16000;
  const ch = opts.channels ?? 1;
  const data = new Uint8Array(samples.length * 2);
  const dv = new DataView(data.buffer);
  samples.forEach((s, i) => dv.setInt16(i * 2, s, true));
  const extra = opts.extra ? 12 : 0;
  const out = new Uint8Array(44 + extra + data.length);
  const v = new DataView(out.buffer);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, out.length - 8, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, ch, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * ch * 2, true);
  v.setUint16(32, ch * 2, true);
  v.setUint16(34, 16, true);
  let o = 36;
  if (extra) {
    str(o, 'LIST');
    v.setUint32(o + 4, 4, true);
    str(o + 8, 'INFO');
    o += 12;
  }
  str(o, 'data');
  v.setUint32(o + 4, data.length, true);
  out.set(data, o + 8);
  return out;
}

const samplesOf = (bytes: Uint8Array): number[] => {
  const info = wavInfo(bytes)!;
  const dv = new DataView(bytes.buffer, bytes.byteOffset + info.dataOffset, info.dataLength);
  return Array.from({ length: info.dataLength / 2 }, (_, i) => dv.getInt16(i * 2, true));
};

describe('WAV: one clip from the parts said between বিরতি and চালিয়ে যান', () => {
  it('reads the format and where the sound is', () => {
    expect(wavInfo(wav([1, 2, 3]))).toMatchObject({ sampleRate: 16000, channels: 1, bitsPerSample: 16, dataOffset: 44, dataLength: 6 });
    expect(wavInfo(wav([1], { extra: true }))).toMatchObject({ dataOffset: 56, dataLength: 2 });
    expect(wavInfo(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it('joins the parts in order into one valid WAV', () => {
    const out = joinWav([wav([1, 2]), wav([3], { extra: true }), wav([4, 5, 6])])!;
    expect(samplesOf(out)).toEqual([1, 2, 3, 4, 5, 6]);
    const info = wavInfo(out)!;
    expect(info).toMatchObject({ sampleRate: 16000, channels: 1, dataOffset: 44, dataLength: 12 });
    expect(new DataView(out.buffer).getUint32(4, true)).toBe(out.length - 8);
  });

  it('one part comes back as it is; a part in another format or not a WAV is left out', () => {
    const a = wav([7, 8]);
    expect(joinWav([a])).toBe(a);
    expect(samplesOf(joinWav([a, wav([9], { rate: 8000 }), new Uint8Array(10), wav([10])])!)).toEqual([7, 8, 10]);
    expect(joinWav([])).toBeNull();
    expect(joinWav([new Uint8Array(4)])).toBeNull();
  });

  it('a part cut short (data size larger than the file) uses what is there', () => {
    const cut = wav([1, 2, 3, 4]).slice(0, 44 + 4);
    expect(samplesOf(joinWav([wav([0]), cut])!)).toEqual([0, 1, 2]);
  });
});
