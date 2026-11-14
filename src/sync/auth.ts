/**
 * দোকানের Google অ্যাকাউন্ট: Google sign-in → Firebase Auth. All phones of a shop sign in
 * with the same account, so they share shops/{uid}.
 */
import Constants from 'expo-constants';
import { GoogleAuthProvider, getAuth, onAuthStateChanged, signInWithCredential, signOut as fbSignOut } from '@react-native-firebase/auth';
import { GoogleSignin, isErrorWithCode, statusCodes } from '@react-native-google-signin/google-signin';

export interface Account {
  uid: string;
  email: string | null;
}

let configured = false;
export function configure(): void {
  if (configured) return;
  const webClientId = Constants.expoConfig?.extra?.googleWebClientId as string | undefined;
  GoogleSignin.configure({ webClientId });
  configured = true;
}

export type SignInResult = { ok: true; account: Account } | { ok: false; reason: 'cancelled' | 'no_play_services' | 'network' | 'error'; message?: string };

export async function signIn(): Promise<SignInResult> {
  configure();
  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const res = await GoogleSignin.signIn();
    if (res.type !== 'success') return { ok: false, reason: 'cancelled' };
    const idToken = res.data.idToken;
    if (!idToken) return { ok: false, reason: 'error', message: 'no idToken (web client ID?)' };
    const cred = await signInWithCredential(getAuth(), GoogleAuthProvider.credential(idToken));
    return { ok: true, account: { uid: cred.user.uid, email: cred.user.email } };
  } catch (e) {
    if (isErrorWithCode(e)) {
      if (e.code === statusCodes.IN_PROGRESS) return { ok: false, reason: 'cancelled' };
      if (e.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) return { ok: false, reason: 'no_play_services' };
      if (String(e.code).includes('network') || e.code === '7') return { ok: false, reason: 'network', message: e.message };
    }
    return { ok: false, reason: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}

/** লগ আউট: this phone stops syncing; its data stays. */
export async function signOut(): Promise<void> {
  configure();
  try {
    await GoogleSignin.signOut();
  } catch {
    // not signed in to Google: fine
  }
  await fbSignOut(getAuth());
}

/** Firebase keeps the session across restarts; this reports it (and every change). */
export function watchAccount(cb: (a: Account | null) => void): () => void {
  return onAuthStateChanged(getAuth(), (u) => cb(u ? { uid: u.uid, email: u.email } : null));
}
