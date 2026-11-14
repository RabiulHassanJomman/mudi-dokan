/**
 * After `npm run apk`: is the Gemini key in this APK? Prints a yes/no, never the key.
 * Looks for EXPO_PUBLIC_GEMINI_KEY in the environment and the .env files Expo reads,
 * then checks that the built JS bundle really contains it.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const APK = join(ROOT, 'android/app/build/outputs/apk/release/app-release.apk');
const NAME = 'EXPO_PUBLIC_GEMINI_KEY';

function keyFromFiles() {
  for (const f of ['.env.production.local', '.env.local', '.env.production', '.env']) {
    const p = join(ROOT, f);
    if (!existsSync(p)) continue;
    const m = readFileSync(p, 'utf8').match(new RegExp(`^\\s*${NAME}\\s*=\\s*["']?([^"'\\r\\n]*)`, 'm'));
    if (m && m[1].trim()) return { key: m[1].trim(), from: f };
  }
  return null;
}

const env = process.env[NAME]?.trim();
const found = env ? { key: env, from: 'environment' } : keyFromFiles();
console.log(`\nAPK: ${APK}`);
if (!found) {
  console.log('Gemini key: NOT included — this build runs Android STT + rule parser only (Gemini hidden).');
  process.exit(0);
}
let inBundle = false;
try {
  const bundle = execFileSync('unzip', ['-p', APK, 'assets/index.android.bundle'], { maxBuffer: 64 * 1024 * 1024 });
  inBundle = bundle.includes(Buffer.from(found.key));
} catch (e) {
  console.log(`(could not read the bundle: ${e.message})`);
}
console.log(
  inBundle
    ? `Gemini key: INCLUDED (from ${found.from}, …${found.key.slice(-4)}) — pilot only: anyone with this APK can read it.`
    : `Gemini key: set in ${found.from} but NOT found in the bundle — Gemini will be off in this APK.`,
);
