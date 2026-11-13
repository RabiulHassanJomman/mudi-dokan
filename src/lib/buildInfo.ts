import Constants from 'expo-constants';

const extra = (Constants.expoConfig?.extra ?? {}) as { gitCommit?: string; builtAt?: string };

/** "v0.1.0 · 054a741 · release · ১৩/১১ ১৬:০২" — which build is on the phone (pilot log; home in debug). */
export const BUILD = {
  version: Constants.expoConfig?.version ?? '?',
  commit: extra.gitCommit ?? '?',
  builtAt: extra.builtAt ?? null,
  mode: __DEV__ ? 'debug' : 'release',
} as const;

export function buildLabel(): string {
  const at = BUILD.builtAt ? new Date(BUILD.builtAt) : null;
  const when = at ? ` · ${at.getDate()}/${at.getMonth() + 1} ${at.getHours()}:${String(at.getMinutes()).padStart(2, '0')}` : '';
  return `v${BUILD.version} · ${BUILD.commit} · ${BUILD.mode}${when}`;
}
