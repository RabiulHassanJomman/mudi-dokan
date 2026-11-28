/**
 * ফোনগুলো (⚙ › ফোনগুলো): every phone of the shop, who is অ্যাডমিন, remote লগ আউট.
 * Pure TS, no RN imports.
 *
 * All phones share one Google account, so "who may do what" is the app's own rule, not the
 * server's: admin state is the latest admin_on / admin_off event per phone. Nobody is admin
 * until a phone claims it (only while nobody is); the last admin can't be removed.
 * Remote লগ আউট names the session the admin saw: the phone sends what is unsent, signs out
 * and erases its data when its current session has one. Signing in again starts a new session, which that event doesn't touch.
 */
import { toBnDigits } from '../lib/bn';

export type DeviceAction = 'admin_on' | 'admin_off' | 'logout';

export interface DeviceEvent {
  id: string;
  target_device_id: string;
  action: DeviceAction;
  target_session: string | null;
  device_name: string;
  created_at: number;
}

export interface DeviceRow {
  id: string;
  device_name: string;
  role: 'owner' | 'staff';
  model: string | null;
  session_id: string | null;
  /** 1 / 0; null = an app from before v17 (doesn't say). */
  signed_in: number | null;
  last_seen_at: number | null;
  updated_at: number;
}

export type DeviceState = 'in' | 'out' | 'leaving' | 'unknown';

export interface DeviceCard {
  id: string;
  name: string;
  model: string | null;
  isMe: boolean;
  isAdmin: boolean;
  state: DeviceState;
  /** When it last synced (or wrote its row). */
  seenAt: number | null;
}

const later = (a: DeviceEvent, b: DeviceEvent) => a.created_at > b.created_at || (a.created_at === b.created_at && a.id > b.id);

/**
 * Phones that are অ্যাডমিন now: the latest admin_on / admin_off / logout per phone. A remote
 * logout takes admin away too, so a removed phone that signs in again is not admin.
 */
export function adminIds(events: readonly DeviceEvent[]): Set<string> {
  const last = new Map<string, DeviceEvent>();
  for (const e of events) {
    const was = last.get(e.target_device_id);
    if (!was || later(e, was)) last.set(e.target_device_id, e);
  }
  return new Set([...last.values()].filter((e) => e.action === 'admin_on').map((e) => e.target_device_id));
}

/** An admin asked this phone's current session to log out. */
export function logoutRequested(events: readonly DeviceEvent[], deviceId: string, session: string | null): boolean {
  if (!session) return false;
  return events.some((e) => e.action === 'logout' && e.target_device_id === deviceId && e.target_session === session);
}

/** Nobody is admin yet: any phone may take it ("আমি অ্যাডমিন হব"). */
export const canClaimAdmin = (admins: ReadonlySet<string>) => admins.size === 0;

/** The last admin stays: someone must be able to manage the phones. */
export const canRemoveAdmin = (admins: ReadonlySet<string>, target: string) => admins.has(target) && admins.size > 1;

/** Only a signed-in phone can be made admin (not one that is logged out or on an old app). */
export const canMakeAdmin = (c: DeviceCard) => !c.isAdmin && c.state === 'in';

/** A signed-in phone (not this one) can be logged out, unless that is already asked. */
export const canLogOut = (c: DeviceCard) => !c.isMe && c.state === 'in';

function stateOf(row: DeviceRow, events: readonly DeviceEvent[]): DeviceState {
  if (row.signed_in === null) return 'unknown';
  if (row.signed_in === 0) return 'out';
  return logoutRequested(events, row.id, row.session_id) ? 'leaving' : 'in';
}

/** The list: this phone first, then signed-in phones, then by last seen (newest first). */
export function deviceCards(rows: readonly DeviceRow[], events: readonly DeviceEvent[], meId: string): DeviceCard[] {
  const admins = adminIds(events);
  const rank = (c: DeviceCard) => (c.isMe ? 0 : c.state === 'in' || c.state === 'leaving' ? 1 : 2);
  return rows
    .map((r) => ({
      id: r.id,
      name: r.device_name.trim() || 'নাম নেই',
      model: r.model,
      isMe: r.id === meId,
      isAdmin: admins.has(r.id),
      state: stateOf(r, events),
      seenAt: r.last_seen_at ?? r.updated_at,
    }))
    .sort((a, b) => rank(a) - rank(b) || (b.seenAt ?? 0) - (a.seenAt ?? 0) || a.id.localeCompare(b.id));
}

export const STATE_BN: Record<DeviceState, string> = {
  in: 'চালু আছে',
  out: 'লগ আউট',
  leaving: 'লগ আউট হচ্ছে… (ফোনটা ইন্টারনেটে এলে)',
  unknown: 'পুরনো অ্যাপ — অ্যাপ নতুন করুন',
};

const DAY = 24 * 60 * 60_000;
const startOfDay = (t: number) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** "শেষ দেখা": আজ / গতকাল / ৩ দিন আগে. */
export function seenWords(seenAt: number | null, now: number): string {
  if (seenAt === null) return 'কখনো না';
  const days = Math.round((startOfDay(now) - startOfDay(seenAt)) / DAY);
  if (days <= 0) return 'আজ';
  if (days === 1) return 'গতকাল';
  return `${toBnDigits(days)} দিন আগে`;
}

/** The ঠিক আছে? sheet's question for each action on a phone. */
export function actionQuestion(action: DeviceAction | 'claim', name: string): string {
  switch (action) {
    case 'claim':
      return 'এই ফোন অ্যাডমিন হবে। অ্যাডমিন সব ফোন দেখতে, অ্যাডমিন বানাতে আর লগ আউট করাতে পারে। ঠিক আছে?';
    case 'admin_on':
      return `${name}-এর ফোন অ্যাডমিন হবে। সে-ও সব ফোন সামলাতে পারবে। ঠিক আছে?`;
    case 'admin_off':
      return `${name}-এর ফোন আর অ্যাডমিন থাকবে না। ঠিক আছে?`;
    case 'logout':
      return `${name}-এর ফোন লগ আউট হবে, অ্যাডমিন থাকলে আর থাকবে না, ওই ফোনের সব হিসাব মুছে যাবে। যা পাঠানো হয়নি তা আগে পাঠানো হবে, দোকানের হিসাব অন্য ফোনে থাকবে। ঠিক আছে?`;
  }
}

/** Spoken after হ্যাঁ. */
export function actionDone(action: DeviceAction | 'claim', name: string): string {
  switch (action) {
    case 'claim':
      return 'এই ফোন এখন অ্যাডমিন।';
    case 'admin_on':
      return `${name} এখন অ্যাডমিন।`;
    case 'admin_off':
      return `${name} আর অ্যাডমিন নয়।`;
    case 'logout':
      return `${name}-এর ফোন ইন্টারনেটে এলেই লগ আউট হবে, ফোনের হিসাব মুছে যাবে।`;
  }
}

/** 🔊 on ফোনগুলো. */
export function devicesReadout(cards: readonly DeviceCard[], meAdmin: boolean, claimable: boolean): string {
  const lines = cards.map((c) => `${c.isMe ? 'এই ফোন, ' : ''}${c.name}${c.model ? `, ${c.model}` : ''}${c.isAdmin ? ', অ্যাডমিন' : ''}, ${STATE_BN[c.state]}।`);
  const tail = claimable
    ? 'এখনো কেউ অ্যাডমিন নয়। আমি অ্যাডমিন হব চাপুন।'
    : meAdmin
      ? 'আপনি অ্যাডমিন। কোনো ফোনের নিচের বোতাম চেপে অ্যাডমিন বানান, সরান বা লগ আউট করান।'
      : 'শুধু অ্যাডমিন বদলাতে পারেন।';
  return [`ফোনগুলো। মোট ${toBnDigits(cards.length)}টা ফোন।`, ...lines, tail].join(' ');
}
