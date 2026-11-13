import { useCallback, useEffect, useRef, useState } from 'react';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';

/**
 * One short bn-BD utterance → its alternatives (best first), or null (silence, error,
 * stopped). For questions answered in place (Setup cash, হ্যাঁ/না) — no audio is kept.
 * Each hook only reacts while its own listen() is pending, so several can share a screen.
 */
export function useVoiceOnce() {
  const [listening, setListening] = useState(false);
  const pending = useRef<((r: string[] | null) => void) | null>(null);

  const settle = useCallback((r: string[] | null) => {
    const resolve = pending.current;
    pending.current = null;
    setListening(false);
    resolve?.(r);
  }, []);

  useSpeechRecognitionEvent('result', (e) => {
    if (e.isFinal && pending.current) settle(e.results.map((r) => r.transcript).filter(Boolean));
  });
  useSpeechRecognitionEvent('end', () => {
    if (pending.current) settle(null);
  });

  const listen = useCallback(async (): Promise<string[] | null> => {
    const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!perm.granted) return null;
    if (pending.current) settle(null);
    return new Promise((resolve) => {
      pending.current = resolve;
      setListening(true);
      ExpoSpeechRecognitionModule.start({ lang: 'bn-BD', interimResults: false, maxAlternatives: 3, continuous: false });
    });
  }, [settle]);

  const stop = useCallback(() => {
    if (pending.current) ExpoSpeechRecognitionModule.abort();
  }, []);

  useEffect(
    () => () => {
      if (pending.current) ExpoSpeechRecognitionModule.abort();
    },
    [],
  );

  return { listening, listen, stop };
}
