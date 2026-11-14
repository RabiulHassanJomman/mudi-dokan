/**
 * Runs Gemini on a recorded clip and writes the result to the voice log (RN side of
 * src/gemini). Never throws: any failure is stored as gemini_error, and the caller
 * falls back to the Android result.
 */
import { File } from 'expo-file-system';

import { customerBalances, knownNames, pickProducts, productAliasMap, setGeminiResult, type Db } from '../db/repo';
import { getDevice, writer } from '../device';
import { audioInput, geminiParse, type GeminiResult } from '../gemini';
import { audioMime, fitAudio } from '../gemini/audio';
import type { ClientDeps } from '../gemini/client';
import { promptContext } from '../gemini/context';
import type { Tab } from '../gemini/prompt';
import { tidyCustomers, type TidyResult } from '../gemini/tidy';
import { geminiKey, getGeminiModel } from './engine';

/** The shopkeeper is waiting (gemini mode): stop retrying past this. */
export const GEMINI_WAIT_MS = 12_000;

const TABS: readonly Tab[] = ['sale', 'purchase', 'ledger', 'stock', 'expense'];

export async function runGemini(
  db: Db,
  logId: string,
  clipUri: string,
  opts: { tab: string; hint: string | null; deadlineMs?: number },
): Promise<GeminiResult> {
  const model = getGeminiModel();
  const t0 = Date.now();
  let result: GeminiResult;
  try {
    const apiKey = geminiKey();
    if (!apiKey) throw new Error('no EXPO_PUBLIC_GEMINI_KEY in this build');
    const mime = audioMime(clipUri);
    if (!mime) throw new Error(`clip type not supported: ${clipUri.split('/').pop()}`);
    const audio = fitAudio(await new File(clipUri).bytes(), mime);
    const [catalog, owed, names, aliases] = await Promise.all([pickProducts(db), customerBalances(db), knownNames(db), productAliasMap(db)]);
    const device = getDevice();
    const prompt = promptContext({
      tab: TABS.find((t) => t === opts.tab) ?? 'sale',
      catalog,
      customers: [...new Set([...owed.map((c) => c.name), ...names.customers])],
      hint: opts.hint,
      device: { name: device.name, role: device.role },
    });
    const deps: ClientDeps = { apiKey, model, fetch: fetch as unknown as ClientDeps['fetch'], deadlineMs: opts.deadlineMs };
    result = await geminiParse(deps, audioInput(audio), prompt, { knownProducts: names.products, productAliases: aliases });
  } catch (e) {
    result = { ok: false, model, parsed: null, transcript: null, error: `error: ${e instanceof Error ? e.message : String(e)}`, ms: Date.now() - t0, usage: null };
  }
  try {
    await setGeminiResult(db, writer(), logId, result);
  } catch (e) {
    console.warn('setGeminiResult failed', e);
  }
  return result;
}

/** "Gemini দিয়ে গুছিয়ে নিন": the import's raw lines + the shop's customer names → tidy rows. */
export async function tidyCustomerLines(lines: readonly string[], existingNames: readonly string[]): Promise<TidyResult> {
  const apiKey = geminiKey();
  const zero = { promptTokens: 0, audioTokens: 0, outputTokens: 0, thoughtTokens: 0 };
  if (!apiKey) return { ok: false, rows: [], error: 'no EXPO_PUBLIC_GEMINI_KEY in this build', ms: 0, usage: zero };
  return tidyCustomers({ apiKey, model: getGeminiModel(), fetch: fetch as unknown as ClientDeps['fetch'] }, lines, existingNames);
}
