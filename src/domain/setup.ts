/** প্রথমবার চালু (Setup): validation, defaults and the readback. Pure TS. */
import { formatNumber } from '../lib/bn';

export type Role = 'owner' | 'staff';

export interface SetupDraft {
  shopName: string;
  deviceName: string;
  role: Role | null;
  openingCashPoisha: number | null;
}

export type SetupProblem = 'shop_name' | 'device_name' | 'role' | 'opening_cash';

export const ROLE_BN: Record<Role, string> = { owner: 'মালিক', staff: 'কর্মচারী' };

/** "আপনার নাম" (= device_name): at most this many characters. */
export const DEVICE_NAME_MAX = 30;

/** Trimmed, one space between words, cut at DEVICE_NAME_MAX code points. */
export const cleanDeviceName = (s: string) => [...s.normalize('NFC').replace(/\s+/g, ' ').trim()].slice(0, DEVICE_NAME_MAX).join('').trim();

/** A new phone: nothing filled, role কর্মচারী until someone picks মালিক. */
export const newSetupDraft = (): SetupDraft => ({ shopName: '', deviceName: '', role: 'staff', openingCashPoisha: null });

/** "আমার নাম (হলো) রফিক।" / "আমি রফিক বলছি" → "রফিক". */
export function nameFromSpeech(text: string): string {
  let t = text.normalize('NFC').replace(/[।.!?,]+/g, ' ').replace(/\s+/g, ' ').trim();
  t = t.replace(/^আমার নাম( হলো| হল| হচ্ছে)? /, '').replace(/^আমি /, '').replace(/ বলছি$/, '');
  return cleanDeviceName(t);
}

/**
 * joinedShop: this phone signed in to a shop that is already in the cloud — its name and
 * opening cash come from there, so Setup asks only for this phone's name and role.
 */
export interface SetupMode {
  joinedShop?: boolean;
}

export function setupProblems(s: SetupDraft, mode: SetupMode = {}): SetupProblem[] {
  const p: SetupProblem[] = [];
  if (!mode.joinedShop && !s.shopName.trim()) p.push('shop_name');
  const name = s.deviceName.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!name || [...name].length > DEVICE_NAME_MAX) p.push('device_name');
  if (!s.role) p.push('role');
  if (!mode.joinedShop && (s.openingCashPoisha === null || s.openingCashPoisha < 0)) p.push('opening_cash');
  return p;
}

export const setupReadback = (s: SetupDraft, mode: SetupMode = {}) =>
  `দোকান: ${s.shopName.trim()}। আপনার নাম: ${s.deviceName.trim()}, ${s.role ? ROLE_BN[s.role] : '—'}। ` +
  (mode.joinedShop ? '' : `ক্যাশে ${formatNumber((s.openingCashPoisha ?? 0) / 100)} টাকা। `) +
  'ঠিক আছে?';

/** Shop-local calendar day, YYYY-MM-DD. */
export const businessDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
