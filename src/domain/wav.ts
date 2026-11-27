/**
 * বলুন › বিরতি / চালিয়ে যান: each listen records its own WAV; the parts are joined into one
 * clip, so ▶ plays everything that was said. Pure TS (bytes in, bytes out).
 */

export interface WavInfo {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  /** Where the sound starts, and how many bytes of it there are (clipped to the file). */
  dataOffset: number;
  dataLength: number;
  /** The "fmt " chunk's body, copied into the joined file. */
  fmt: Uint8Array;
}

const tag = (b: Uint8Array, o: number) => String.fromCharCode(b[o]!, b[o + 1]!, b[o + 2]!, b[o + 3]!);

/** The format and the sound's place in a RIFF/WAVE file; null when it isn't one. */
export function wavInfo(b: Uint8Array): WavInfo | null {
  if (b.length < 12 || tag(b, 0) !== 'RIFF' || tag(b, 8) !== 'WAVE') return null;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let fmt: Uint8Array | null = null;
  let o = 12;
  while (o + 8 <= b.length) {
    const id = tag(b, o);
    const size = v.getUint32(o + 4, true);
    const body = o + 8;
    if (id === 'fmt ' && body + 16 <= b.length) fmt = b.slice(body, body + size);
    if (id === 'data') {
      if (!fmt) return null;
      const f = new DataView(fmt.buffer, fmt.byteOffset, fmt.byteLength);
      return {
        channels: f.getUint16(2, true),
        sampleRate: f.getUint32(4, true),
        bitsPerSample: f.getUint16(14, true),
        dataOffset: body,
        // a recording stopped early may say more than it has
        dataLength: Math.min(size, b.length - body),
        fmt,
      };
    }
    o = body + size + (size % 2);
  }
  return null;
}

const sameFormat = (a: WavInfo, b: WavInfo) =>
  a.sampleRate === b.sampleRate && a.channels === b.channels && a.bitsPerSample === b.bitsPerSample;

/** The parts, in order, as one WAV in the first part's format (other formats and non-WAVs are left out). */
export function joinWav(parts: readonly Uint8Array[]): Uint8Array | null {
  const ok = parts.map((p) => ({ p, info: wavInfo(p) })).filter((x): x is { p: Uint8Array; info: WavInfo } => !!x.info);
  const first = ok[0];
  if (!first) return null;
  if (parts.length === 1) return parts[0]!;
  const use = ok.filter((x) => sameFormat(x.info, first.info));
  // whole sample frames only
  const frame = Math.max(1, (first.info.channels * first.info.bitsPerSample) / 8);
  const lens = use.map((x) => x.info.dataLength - (x.info.dataLength % frame));
  const dataLength = lens.reduce((s, n) => s + n, 0);
  const fmt = first.info.fmt;
  const fmtSize = fmt.length + (fmt.length % 2);
  const out = new Uint8Array(12 + 8 + fmtSize + 8 + dataLength);
  const v = new DataView(out.buffer);
  const put = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  put(0, 'RIFF');
  v.setUint32(4, out.length - 8, true);
  put(8, 'WAVE');
  put(12, 'fmt ');
  v.setUint32(16, fmt.length, true);
  out.set(fmt, 20);
  const dataAt = 20 + fmtSize;
  put(dataAt, 'data');
  v.setUint32(dataAt + 4, dataLength, true);
  let o = dataAt + 8;
  use.forEach((x, i) => {
    out.set(x.p.subarray(x.info.dataOffset, x.info.dataOffset + lens[i]!), o);
    o += lens[i]!;
  });
  return out;
}
