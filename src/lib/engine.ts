/**
 * Voice engine setting (optional Gemini; pilot log screen): kept per phone in the kv-store.
 * Without EXPO_PUBLIC_GEMINI_KEY at build time Gemini doesn't exist in the app: android only.
 *   android = recognizer + rule parser (as before)
 *   gemini  = the recorded clip to Gemini; Android result only as fallback
 *   both    = Android drives the confirm card; Gemini runs on the same clip in the background
 */
import { Storage } from 'expo-sqlite/kv-store';

import type { Engine } from '../db/repo';
import { DEFAULT_MODEL } from '../gemini';

const KEY_ENGINE = 'voice_engine';
const KEY_MODEL = 'gemini_model';

export const ENGINES: readonly Engine[] = ['android', 'gemini', 'both'];

/** No setting saved: gemini when this build has a key, else android. */
export const defaultEngine = (hasKey: boolean): Engine => (hasKey ? 'gemini' : 'android');

/** EXPO_PUBLIC_GEMINI_KEY from .env (gitignored), inlined at build time. Pilot only: anyone with the APK can read it. */
export const geminiKey = (): string | null => process.env.EXPO_PUBLIC_GEMINI_KEY?.trim() || null;

/** Without a key, Gemini can't run: android. */
export function getEngine(): Engine {
  if (!geminiKey()) return 'android';
  const v = Storage.getItemSync(KEY_ENGINE);
  return ENGINES.includes(v as Engine) ? (v as Engine) : defaultEngine(true);
}
export const setEngine = (e: Engine) => Storage.setItemSync(KEY_ENGINE, e);

/** Setting, else EXPO_PUBLIC_GEMINI_MODEL, else the current Flash-Lite. */
export const getGeminiModel = (): string =>
  Storage.getItemSync(KEY_MODEL)?.trim() || process.env.EXPO_PUBLIC_GEMINI_MODEL?.trim() || DEFAULT_MODEL;
export function setGeminiModel(model: string): void {
  if (model.trim()) Storage.setItemSync(KEY_MODEL, model.trim());
  else Storage.removeItemSync(KEY_MODEL);
}
