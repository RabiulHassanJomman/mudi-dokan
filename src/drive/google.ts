/**
 * The shop's Google account, for Drive (step 8): the same sign-in as sync, plus the
 * drive.file scope asked for separately (incremental consent) the first time Drive is used.
 */
import { GoogleSignin } from '@react-native-google-signin/google-signin';

import { configure } from '../sync/auth';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

/** The Google user of this app session; restores it silently after an app restart. */
async function currentUser() {
  configure();
  let u = GoogleSignin.getCurrentUser();
  if (!u && GoogleSignin.hasPreviousSignIn()) {
    try {
      const r = await GoogleSignin.signInSilently();
      u = r.type === 'success' ? r.data : null;
    } catch {
      u = null;
    }
  }
  return u;
}

/** Signed in and Drive allowed (no dialog). */
export async function hasDriveAccess(): Promise<boolean> {
  const u = await currentUser();
  return !!u?.scopes?.includes(DRIVE_SCOPE);
}

/** Shows Google's "allow Drive" screen if needed. true = allowed. */
export async function askDriveAccess(): Promise<boolean> {
  if (await hasDriveAccess()) return true;
  if (!(await currentUser())) return false;
  try {
    const r = await GoogleSignin.addScopes({ scopes: [DRIVE_SCOPE] });
    return !!r && r.type === 'success' && r.data.scopes.includes(DRIVE_SCOPE);
  } catch (e) {
    console.warn('drive scope', e);
    return false;
  }
}

export async function accessToken(): Promise<string> {
  if (!(await currentUser())) throw new Error('drive: not signed in');
  return (await GoogleSignin.getTokens()).accessToken;
}

export async function refreshToken(old: string): Promise<string> {
  await GoogleSignin.clearCachedAccessToken(old);
  return (await GoogleSignin.getTokens()).accessToken;
}
