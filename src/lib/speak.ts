import * as Speech from 'expo-speech';
import NetInfo from '@react-native-community/netinfo';

import { pickVoice } from '../domain/voice';

/** The phone's voice identifiers; asked once (Android may answer [] before TTS is ready, then again). */
let voices: string[] | null = null;
let loading: Promise<string[]> | null = null;
function loadVoices(): Promise<string[]> {
  if (voices) return Promise.resolve(voices);
  loading ??= Speech.getAvailableVoicesAsync()
    .then((vs) => {
      const ids = vs.map((v) => v.identifier);
      if (ids.length) voices = ids;
      return ids;
    })
    .catch(() => [])
    .finally(() => {
      loading = null;
    });
  return loading;
}

/** Each speak / stop takes a turn; a speak still waiting for the voices gives up when its turn is past. */
let turn = 0;

let online = true;
let watching = false;
function watchNetwork() {
  if (watching) return;
  watching = true;
  NetInfo.addEventListener((s) => {
    online = !!s.isConnected && s.isInternetReachable !== false;
  });
}

/** Read Bangla aloud (male Bangladeshi voice, domain/voice.ts). Resolves when speech ends (or is stopped). */
export async function speak(text: string): Promise<void> {
  watchNetwork();
  const mine = ++turn;
  const voice = pickVoice(await loadVoices(), online);
  // stopped (or a newer speak) while the voices were being asked: say nothing
  if (mine !== turn) return;
  return new Promise((resolve) => {
    Speech.stop();
    Speech.speak(text, {
      language: 'bn-BD',
      rate: 0.95,
      ...(voice ? { voice } : {}),
      onDone: () => resolve(),
      onStopped: () => resolve(),
      onError: () => resolve(),
    });
  });
}

export const stopSpeaking = () => {
  turn++;
  Speech.stop();
};
