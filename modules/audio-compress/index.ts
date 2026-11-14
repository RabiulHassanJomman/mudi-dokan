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
