/**
 * Voice clip → small AAC (step 8, before the Drive upload). Android only, native
 * (MediaCodec): 16-bit PCM WAV in, AAC-LC in ADTS (.aac) out, mono, ~16 kbps.
 * ADTS because expo-audio plays it and Gemini takes it ("audio/aac") like the recorder's clips.
 */
import { requireOptionalNativeModule } from 'expo';

export interface CompressResult {
  /** Output size in bytes. */
  bytes: number;
  durationMs: number;
}

interface Native {
  wavToAac(input: string, output: string, bitRate: number): Promise<CompressResult>;
}

const native = requireOptionalNativeModule<Native>('AudioCompress');

export const canCompress = () => native !== null;

/** Paths may be file:// URIs. Throws if the input isn't 16-bit PCM WAV. */
export function wavToAac(input: string, output: string, bitRate = 16_000): Promise<CompressResult> {
  if (!native) return Promise.reject(new Error('AudioCompress native module missing'));
  return native.wavToAac(input, output, bitRate);
}

// ── offline 🎤: one sentence as 16 kHz mono PCM WAV (native WavRecorderModule) ──

export interface RecordResult {
  /** file:// uri of the WAV. */
  uri: string;
  durationMs: number;
  /** Speech was heard (louder than the room for 0.2 s or more). */
  heard: boolean;
  /** When recording started (ms): the entry's time. */
  startedAt: number;
  why: 'silence' | 'nothing' | 'max' | 'stop';
}

interface Recorder {
  record(output: string, silenceMs: number, startTimeoutMs: number, maxMs: number): Promise<RecordResult>;
  stop(): void;
}

const recorder = requireOptionalNativeModule<Recorder>('WavRecorder');

export const canRecordWav = () => recorder !== null;

/** Resolves when recording ends (quiet after speech, nothing said, too long, or stopWav()). */
export function recordWav(output: string, limits: { silenceMs: number; startTimeoutMs: number; maxMs: number }): Promise<RecordResult> {
  if (!recorder) return Promise.reject(new Error('WavRecorder native module missing'));
  return recorder.record(output, limits.silenceMs, limits.startTimeoutMs, limits.maxMs);
}

export const stopWav = () => recorder?.stop();
