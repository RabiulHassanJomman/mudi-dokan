/** After this phone's data was erased: its files and its "setup done" mark go too. RN side. */
import { Directory, File, Paths } from 'expo-file-system';

import { clearSetupDone } from '../device';

export async function afterLocalWipe(audioFiles: readonly string[]): Promise<void> {
  for (const uri of audioFiles) {
    try {
      const f = new File(uri);
      if (f.exists) f.delete();
    } catch {
      // gone already
    }
  }
  // other phones' clips played from Drive are cached here
  for (const name of ['clips']) {
    try {
      const d = new Directory(Paths.cache, name);
      if (d.exists) d.delete();
    } catch {
      // harmless
    }
  }
  // the backup copies in Documents/backup stay: they are what the user keeps
  clearSetupDone();
}
