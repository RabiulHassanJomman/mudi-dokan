/**
 * This phone's identity. Kept in expo-sqlite's kv-store (a separate local
 * file), not in the synced tables: every phone has its own.
 * Setup sets the name and role; until then: "এই ফোন", role unset.
 */
import { randomUUID } from 'expo-crypto';
import { Storage } from 'expo-sqlite/kv-store';

import type { Writer } from './db/repo';

const KEY_ID = 'device_id';
const KEY_NAME = 'device_name';
const KEY_ROLE = 'device_role';
const KEY_SETUP = 'setup_done';

export type DeviceRole = 'owner' | 'staff';

export interface DeviceInfo {
  id: string;
  name: string;
  role: DeviceRole | null;
}

export function getDevice(): DeviceInfo {
  let id = Storage.getItemSync(KEY_ID);
  if (!id) {
    id = randomUUID();
    Storage.setItemSync(KEY_ID, id);
  }
  const role = Storage.getItemSync(KEY_ROLE);
  return {
    id,
    name: Storage.getItemSync(KEY_NAME) ?? 'এই ফোন',
    role: role === 'owner' || role === 'staff' ? role : null,
  };
}

export function writer(device: DeviceInfo = getDevice()): Writer {
  return { deviceId: device.id, deviceName: device.name, newId: randomUUID, now: Date.now };
}

/** After Setup is saved (the devices row has the same values; this copy is read synchronously). */
export function setDevice(name: string, role: DeviceRole): void {
  Storage.setItemSync(KEY_NAME, name);
  Storage.setItemSync(KEY_ROLE, role);
}

/** প্রথমবার চালু runs until this phone has saved Setup once. */
export const isSetupDone = () => Storage.getItemSync(KEY_SETUP) === '1';
export const markSetupDone = () => Storage.setItemSync(KEY_SETUP, '1');

/** After a wipe: প্রথমবার চালু runs again (the name and role stay filled in). */
export const clearSetupDone = () => Storage.removeItemSync(KEY_SETUP);
