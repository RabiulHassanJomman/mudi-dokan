/**
 * The clip as Gemini inline data. Pure TS (bytes in, base64 out).
 *
 * The recognizer's clip is 16 kHz mono 16-bit WAV (≈ 32 KB/s), which Gemini takes as is.
 * Over the limit (≈ 30 s), the WAV is halved to 8 kHz (speech stays clear), then cut to fit.
 * expo-audio clips (Android < 13) are AAC (ADTS), already small.
 */

export const MAX_AUDIO_BYTES = 1_000_000;

export interface InlineAudio {
  mimeType: string;
  base64: string;
  /** Bytes sent (before base64). */
  bytes: number;
  /** How the clip was changed to fit. */
  shrunk?: 'downsampled' | 'downsampled+cut';
}

const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));

interface Wav {
  channels: number;
  sampleRate: number;
  bits: number;
  dataAt: number;
  dataLen: number;
}

/** Reads a PCM WAV header; null if it isn't one. */
export function readWav(b: Uint8Array): Wav | null {
  if (b.length < 44 || ascii(b, 0, 4) !== 'RIFF' || ascii(b, 8, 4) !== 'WAVE') return null;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let at = 12;
  let fmt: Omit<Wav, 'dataAt' | 'dataLen'> | null = null;
  while (at + 8 <= b.length) {
    const id = ascii(b, at, 4);
    const len = v.getUint32(at + 4, true);
    if (id === 'fmt ') {
      if (v.getUint16(at + 8, true) !== 1) return null; // PCM only
      fmt = { channels: v.getUint16(at + 10, true), sampleRate: v.getUint32(at + 12, true), bits: v.getUint16(at + 22, true) };
    } else if (id === 'data') {
      if (!fmt) return null;
      // a recorder stopped early may leave a wrong length: take what is there
      return { ...fmt, dataAt: at + 8, dataLen: Math.min(len, b.length - at - 8) };
    }
    at += 8 + len + (len % 2);
  }
  return null;
}

export function wavFile(pcm: Uint8Array, sampleRate: number, channels: number, bits: number): Uint8Array {
  const out = new Uint8Array(44 + pcm.length);
  const v = new DataView(out.buffer);
  const put = (at: number, s: string) => [...s].forEach((c, i) => (out[at + i] = c.charCodeAt(0)));
  put(0, 'RIFF');
  v.setUint32(4, 36 + pcm.length, true);
  put(8, 'WAVE');
  put(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, channels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, (sampleRate * channels * bits) / 8, true);
  v.setUint16(32, (channels * bits) / 8, true);
  v.setUint16(34, bits, true);
  put(36, 'data');
  v.setUint32(40, pcm.length, true);
  out.set(pcm, 44);
  return out;
}

/**
 * Pause and resume: each resume is a new recognizer clip. Joins them (in order) into one WAV
 * for Gemini. Clips that are not WAVs are skipped; mixed formats are refused.
 */
export function joinWavs(clips: Uint8Array[]): Uint8Array {
  const parts = clips.map((c) => ({ c, w: readWav(c) })).filter((p): p is { c: Uint8Array; w: Wav } => p.w !== null);
  if (parts.length === 0) throw new Error('no audio to join');
  if (parts.length === 1 && parts.length === clips.length) return clips[0]!;
  const { sampleRate, channels, bits } = parts[0]!.w;
  if (parts.some((p) => p.w.sampleRate !== sampleRate || p.w.channels !== channels || p.w.bits !== bits)) {
    throw new Error('clips differ in format');
  }
  const pcm = new Uint8Array(parts.reduce((n, p) => n + p.w.dataLen, 0));
  let at = 0;
  for (const { c, w } of parts) {
    pcm.set(c.subarray(w.dataAt, w.dataAt + w.dataLen), at);
    at += w.dataLen;
  }
  return wavFile(pcm, sampleRate, channels, bits);
}

/** 16-bit mono WAV → half the sample rate (average of each pair), cut to maxBytes. */
function halveWav(b: Uint8Array, w: Wav, maxBytes: number): { bytes: Uint8Array; cut: boolean } {
  const src = new DataView(b.buffer, b.byteOffset + w.dataAt, w.dataLen);
  const pairs = Math.floor(w.dataLen / 4);
  const fit = Math.floor((maxBytes - 44) / 2);
  const n = Math.min(pairs, fit);
  const pcm = new Uint8Array(n * 2);
  const dst = new DataView(pcm.buffer);
  for (let i = 0; i < n; i++) dst.setInt16(i * 2, Math.round((src.getInt16(i * 4, true) + src.getInt16(i * 4 + 2, true)) / 2), true);
  return { bytes: wavFile(pcm, Math.floor(w.sampleRate / 2), 1, 16), cut: n < pairs };
}

export function fitAudio(bytes: Uint8Array, mimeType: string, maxBytes = MAX_AUDIO_BYTES): InlineAudio {
  let out = bytes;
  let shrunk: InlineAudio['shrunk'];
  if (bytes.length > maxBytes) {
    const w = mimeType === 'audio/wav' ? readWav(bytes) : null;
    if (!w || w.channels !== 1 || w.bits !== 16) throw new Error(`clip too big (${bytes.length} bytes)`);
    const h = halveWav(bytes, w, maxBytes);
    out = h.bytes;
    shrunk = h.cut ? 'downsampled+cut' : 'downsampled';
  }
  return { mimeType, base64: toBase64(out), bytes: out.length, ...(shrunk ? { shrunk } : {}) };
}

/** File name → Gemini's mime type (wav, aac, mp3, ogg, flac). */
export function audioMime(path: string): string | null {
  const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase();
  const m: Record<string, string> = { wav: 'audio/wav', aac: 'audio/aac', mp3: 'audio/mp3', ogg: 'audio/ogg', flac: 'audio/flac' };
  return ext ? m[ext] ?? null : null;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function toBase64(b: Uint8Array): string {
  const out: string[] = [];
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i]! << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    out.push(
      B64[(n >> 18) & 63]! +
        B64[(n >> 12) & 63]! +
        (i + 1 < b.length ? B64[(n >> 6) & 63]! : '=') +
        (i + 2 < b.length ? B64[n & 63]! : '='),
    );
  }
  return out.join('');
}
