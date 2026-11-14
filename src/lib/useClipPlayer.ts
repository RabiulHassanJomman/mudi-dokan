import { useCallback } from 'react';
import { useAudioPlayer } from 'expo-audio';
import { useSQLiteContext } from 'expo-sqlite';

import type { Db } from '../db/repo';
import { resolveClip } from '../drive/app';
import { speak, stopSpeaking } from './speak';

const FAIL_BN = {
  offline: 'ইন্টারনেট নেই, অন্য ফোনের কথা এখন শোনা যাচ্ছে না',
  no_access: 'Drive চালু নেই, অন্য ফোনের কথা শোনা যাচ্ছে না',
  missing: 'এই কথাটা আর পাওয়া যাচ্ছে না',
} as const;

/**
 * ▶️ for saved voice clips: one player per screen, `play(ref)` swaps the clip. `ref` is
 * repo CLIP_SQL: a file on this phone, or 'drive:<id>' (another phone's clip, downloaded
 * from Drive once, then played from the cache).
 */
export function useClipPlayer() {
  const db = useSQLiteContext() as unknown as Db;
  const player = useAudioPlayer(null);
  return useCallback(
    (ref: string | null) => {
      if (!ref) return;
      stopSpeaking();
      void (async () => {
        const r = await resolveClip(db, ref).catch(() => ({ ok: false as const, reason: 'missing' as const }));
        if (!r.ok) {
          void speak(FAIL_BN[r.reason]);
          return;
        }
        player.replace({ uri: r.uri });
        await player.seekTo(0);
        player.play();
      })();
    },
    [db, player],
  );
}
