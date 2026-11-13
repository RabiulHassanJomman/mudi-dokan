import * as Speech from 'expo-speech';

/** Read Bangla aloud. Resolves when speech ends (or is stopped). */
export function speak(text: string): Promise<void> {
  return new Promise((resolve) => {
    Speech.stop();
    Speech.speak(text, {
      language: 'bn-BD',
      rate: 0.95,
      onDone: () => resolve(),
      onStopped: () => resolve(),
      onError: () => resolve(),
    });
  });
}

export const stopSpeaking = () => Speech.stop();
