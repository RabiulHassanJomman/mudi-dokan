/**
 * This phone's identity. Kept in expo-sqlite's kv-store (a separate local
 * file), not in the synced tables: every phone has its own.
 * Setup (step ২) will set the name and role; until then: "এই ফোন", role unset.
 */
import { randomUUID } from 'expo-crypto';
import { Storage } from 'expo-sqlite/kv-store';

import type { Writer } from './db/repo';

const KEY_ID = 'device_id';
const KEY_NAME = 'device_name';
const KEY_ROLE = 'device_role';

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
