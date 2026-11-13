import { useCallback } from 'react';
import { useAudioPlayer } from 'expo-audio';

import { stopSpeaking } from './speak';

/** ▶️ for saved voice clips: one player per screen, `play(uri)` swaps the clip. */
export function useClipPlayer() {
  const player = useAudioPlayer(null);
  return useCallback(
    (uri: string | null) => {
      if (!uri) return;
      stopSpeaking();
      player.replace({ uri });
      void player.seekTo(0).then(() => player.play());
    },
    [player],
  );
}
