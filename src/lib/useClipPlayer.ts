import { useCallback, useEffect, useRef, useState } from 'react';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useSQLiteContext } from 'expo-sqlite';

import type { Db } from '../db/repo';
import { resolveClip } from '../drive/app';
import { clipIcon, clipTap } from '../domain/clipTap';
import { speak, stopSpeaking } from './speak';

const FAIL_BN = {
  offline: 'ইন্টারনেট নেই, অন্য ফোনের কথা এখন শোনা যাচ্ছে না',
  no_access: 'Drive চালু নেই, অন্য ফোনের কথা শোনা যাচ্ছে না',
  missing: 'এই কথাটা আর পাওয়া যাচ্ছে না',
} as const;

/**
 * ▶️ / ⏸ for saved voice clips: one player per screen. `toggle(ref)` plays a clip, pauses it
 * if it is playing, resumes it if paused (domain/clipTap); `icon(ref)` is that row's icon.
 * `ref` is repo CLIP_SQL: a file on this phone, or 'drive:<id>' (another phone's clip,
 * downloaded from Drive once, then played from the cache).
 */
export function useClipPlayer() {
  const db = useSQLiteContext() as unknown as Db;
  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);
  const [current, setCurrent] = useState<string | null>(null);
  const currentRef = useRef<string | null>(null);
  const setLoaded = (ref: string | null) => {
    currentRef.current = ref;
    setCurrent(ref);
  };

  // ended: the next tap starts it from the beginning
  useEffect(() => {
    if (status.didJustFinish) setLoaded(null);
  }, [status.didJustFinish]);

  const playing = status.playing;
  const toggle = useCallback(
    (ref: string | null) => {
      if (!ref) return;
      const what = clipTap(currentRef.current, player.playing, ref);
      if (what === 'pause') {
        player.pause();
        return;
      }
      stopSpeaking();
      if (what === 'resume') {
        player.play();
        return;
      }
      setLoaded(ref);
      void (async () => {
        const r = await resolveClip(db, ref).catch(() => ({ ok: false as const, reason: 'missing' as const }));
        if (currentRef.current !== ref) return; // another clip tapped meanwhile
        if (!r.ok) {
          setLoaded(null);
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
  const icon = useCallback((ref: string | null) => clipIcon(current, playing, ref), [current, playing]);
  return { toggle, icon };
}
