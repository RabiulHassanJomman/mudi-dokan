/** "সব তথ্য মুছুন" in the app (RN side of src/wipe): what each choice does, in order. */
import NetInfo from '@react-native-community/netinfo';

import { getDevice } from '../device';
import { backupBeforeWipe, removeDriveFolder } from '../drive/app';
import { bumpQueue } from '../lib/understand';
import { dataChanged, startSync } from '../sync/app';
import { signOut } from '../sync/auth';
import { afterLocalWipe } from './files';
import type { WipeScope, WipeStatus } from './flow';

export { backupBeforeWipe };

/**
 * scope 'phone': this phone's data, files and Google sign-in go; other phones and the cloud keep theirs.
 * scope 'everywhere': first Google (every document, plus the tombstone the other phones read), then
 * the Drive "Mudi Dokan" folder, then this phone; with no internet nothing at all is erased.
 */
export async function wipeEverything(scope: WipeScope): Promise<WipeStatus> {
  const ctl = await startSync();
  const device = getDevice();
  let files: string[];
  if (scope === 'everywhere') {
    if (!ctl.current.email) return 'no_account';
    const net = await NetInfo.fetch();
    if (!net.isConnected || net.isInternetReachable === false) return 'offline';
    try {
      ({ files } = await ctl.engine.wipeEverywhere(device.name, device.id, async () => void (await removeDriveFolder())));
    } catch (e) {
      console.warn('wipeEverywhere failed', e);
      return 'cloud_failed';
    }
  } else {
    files = await ctl.engine.wipeLocal(device.id);
    await signOut();
  }
  await afterLocalWipe(files);
  dataChanged();
  bumpQueue();
  return 'ok';
}

