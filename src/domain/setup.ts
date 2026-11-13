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

/** "এই ফোন কার?" chips; "+ নতুন নাম" types any other. */
export const DEVICE_PRESETS = ['আব্বু', 'আম্মু', 'কর্মচারী ১'] as const;

export const ROLE_BN: Record<Role, string> = { owner: 'মালিক', staff: 'কর্মচারী' };

/** আব্বু/আম্মু → মালিক, কর্মচারী … → কর্মচারী; any other name: chosen by hand. */
export function defaultRole(name: string): Role | null {
  const n = name.trim();
  if (n === 'আব্বু' || n === 'আম্মু') return 'owner';
  if (n.startsWith('কর্মচারী')) return 'staff';
  return null;
}

export function setupProblems(s: SetupDraft): SetupProblem[] {
  const p: SetupProblem[] = [];
  if (!s.shopName.trim()) p.push('shop_name');
  if (!s.deviceName.trim()) p.push('device_name');
  if (!s.role) p.push('role');
  if (s.openingCashPoisha === null || s.openingCashPoisha < 0) p.push('opening_cash');
  return p;
}

export const setupReadback = (s: SetupDraft) =>
  `দোকান: ${s.shopName.trim()}। এই ফোন: ${s.deviceName.trim()}, ${s.role ? ROLE_BN[s.role] : '—'}। ` +
  `ক্যাশে ${formatNumber((s.openingCashPoisha ?? 0) / 100)} টাকা। ঠিক আছে?`;

/** Shop-local calendar day, YYYY-MM-DD. */
export const businessDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
