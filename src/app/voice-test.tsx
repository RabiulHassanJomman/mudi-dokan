import * as Speech from 'expo-speech';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon } from '../components/Icon';
import { Txt } from '../components/Txt';
import { nav } from '../lib/nav';
import { speak, stopSpeaking } from '../lib/speak';
import { colors, fontSize, radius, size, spacing } from '../theme/tokens';

const SAMPLE = 'চাল দুই কেজি, একশো কুড়ি টাকা। ঠিক আছে?';

/** Hidden (⚙ › ডিবাগ লগ › 🔊): every Bangla TTS voice on the phone, tap to hear it. */
export default function VoiceTestScreen() {
  const [voices, setVoices] = useState<Speech.Voice[] | null>(null);

  useEffect(() => {
    Speech.getAvailableVoicesAsync()
      .then((all) => setVoices(all.filter((v) => /^bn/i.test(v.language.replace('_', '-')))))
      .catch(() => setVoices([]));
    return () => {
      Speech.stop();
    };
  }, []);

  /** No voice: the app's own (lib/speak, domain/voice). */
  const play = (v?: Speech.Voice) => {
    if (!v) return void speak(SAMPLE);
    stopSpeaking();
    Speech.speak(SAMPLE, { language: 'bn-BD', rate: 0.95, voice: v.identifier });
  };

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.top}>
        <Pressable accessibilityRole="button" accessibilityLabel="ফিরে যান" onPress={() => nav.back()} style={styles.square}>
          <Icon name="back" size={26} color={colors.ink} strokeWidth={2.2} />
        </Pressable>
        <Txt accessibilityRole="header" size={fontSize.heading} weight="bold" style={styles.flex}>
          ভয়েস পরীক্ষা
        </Txt>
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        <Pressable accessibilityRole="button" onPress={() => play()} style={styles.card}>
          <Txt size={fontSize.label} weight="bold">
            🔊 অ্যাপের ভয়েস
          </Txt>
        </Pressable>
        {voices === null ? (
          <Txt size={fontSize.caption} color={colors.muted}>
            খুঁজছি…
          </Txt>
        ) : voices.length === 0 ? (
          <Txt size={fontSize.caption} color={colors.muted}>
            কোনো বাংলা ভয়েস পাওয়া যায়নি
          </Txt>
        ) : (
          voices.map((v) => (
            <Pressable key={v.identifier} accessibilityRole="button" onPress={() => play(v)} style={styles.card}>
              <Txt wrap size={fontSize.label} weight="bold">
                🔊 {v.name}
              </Txt>
              <Txt wrap size={fontSize.caption} weight="medium" color={colors.muted}>
                {`${v.language} · ${v.quality}`}
              </Txt>
            </Pressable>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: spacing.screen, paddingTop: spacing.screenTop, gap: spacing.sm },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
  square: { width: size.iconButton, height: size.iconButton, borderRadius: radius.icon, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  body: { gap: spacing.sm, paddingBottom: spacing.xl },
  card: { backgroundColor: colors.surface, borderRadius: radius.card, padding: spacing.md, gap: 2, minHeight: 52, justifyContent: 'center' },
});
