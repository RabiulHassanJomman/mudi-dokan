/**
 * Gemini is the only engine: every spoken command is the recorded clip sent to Gemini.
 * The key is EXPO_PUBLIC_GEMINI_KEY from .env (gitignored), inlined at build time; a build
 * without it still runs (typing and ছবি দেখে work) and says "Gemini key নেই" where Gemini
 * would be needed. Pilot only: anyone with the APK can read the key.
 */
import { Storage } from 'expo-sqlite/kv-store';

import { DEFAULT_MODEL } from '../gemini';

const KEY_MODEL = 'gemini_model';

export const geminiKey = (): string | null => process.env.EXPO_PUBLIC_GEMINI_KEY?.trim() || null;
export const hasGemini = (): boolean => geminiKey() !== null;

export const NO_KEY_BN = 'Gemini key নেই';
export const NO_KEY_HELP_BN = 'এই অ্যাপে Gemini key নেই, তাই কথা বুঝতে পারবে না। ছবি দেখে বা লিখে হিসাব রাখুন।';

/** Setting, else EXPO_PUBLIC_GEMINI_MODEL, else the current Flash-Lite. */
export const getGeminiModel = (): string =>
  Storage.getItemSync(KEY_MODEL)?.trim() || process.env.EXPO_PUBLIC_GEMINI_MODEL?.trim() || DEFAULT_MODEL;
export function setGeminiModel(model: string): void {
  if (model.trim()) Storage.setItemSync(KEY_MODEL, model.trim());
  else Storage.removeItemSync(KEY_MODEL);
}
