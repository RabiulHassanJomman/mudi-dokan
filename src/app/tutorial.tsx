import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';

import { Icon } from '../components/Icon';
import { Txt } from '../components/Txt';
import { markTutorialSeen } from '../device';
import { TUTORIAL_PAGES, tutorialPosition, tutorialSpeech, type TutorialTone } from '../domain/tutorial';
import { nav } from '../lib/nav';
import { speak, stopSpeaking } from '../lib/speak';
import { colors, fontSize, radius, size, spacing } from '../theme/tokens';

const TONE: Record<TutorialTone, { solid: string; tint: string; ink: string }> = {
  sale: { solid: colors.sale, tint: colors.saleTint, ink: colors.saleDark },
  baki: { solid: colors.baki, tint: colors.bakiTint, ink: colors.bakiInk },
  stock: { solid: colors.stock, tint: colors.stockTint, ink: colors.stock },
};

/**
 * অ্যাপ শেখা (domain/tutorial.ts): slides, one page at a time, each read aloud when it opens.
 * After the first Setup (then → home), or from ⚙ (?again=1, then → back). বাদ দিন ends it early.
 */
export default function TutorialScreen() {
  const again = useLocalSearchParams<{ again?: string }>().again === '1';
  const [i, setI] = useState(0);
  const page = TUTORIAL_PAGES[i]!;
  const last = i === TUTORIAL_PAGES.length - 1;
  const tone = TONE[page.tone];

  useEffect(() => {
    void speak(tutorialSpeech(page));
  }, [page]);
  useEffect(() => stopSpeaking, []);

  const finish = () => {
    stopSpeaking();
    markTutorialSeen();
    if (again && nav.canGoBack()) nav.back();
    else nav.replace('/');
  };

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Txt size={fontSize.label} weight="bold" color={colors.muted} style={styles.flex} accessibilityLabel={`পাতা ${tutorialPosition(i)}`}>
          {`অ্যাপ শেখা  ${tutorialPosition(i)}`}
        </Txt>
        {!last && (
          <Pressable accessibilityRole="button" onPress={finish} style={({ pressed }) => [styles.skip, pressed && styles.pressed]}>
            <Txt size={fontSize.label} weight="bold" color={colors.ink2}>
              বাদ দিন
            </Txt>
          </Pressable>
        )}
        <Pressable accessibilityRole="button" accessibilityLabel="আবার শুনুন" onPress={() => void speak(tutorialSpeech(page))} style={styles.listen}>
          <Icon name="speaker" size={26} color={colors.onColor} strokeWidth={2} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${page.title}, শুনুন`} onPress={() => void speak(tutorialSpeech(page))} style={[styles.bigIcon, { backgroundColor: tone.tint }]}>
          <View style={[styles.iconDisc, { backgroundColor: tone.solid }]}>
            <Icon name={page.icon} size={72} color={colors.onColor} strokeWidth={2} />
          </View>
        </Pressable>

        <Txt accessibilityRole="header" wrap size={fontSize.promptLg} weight="bold" color={tone.ink} style={styles.center}>
          {page.title}
        </Txt>

        <View style={styles.lines}>
          {page.lines.map((l) => (
            <Txt key={l} wrap size={fontSize.button} weight="semibold" color={colors.ink} style={styles.center}>
              {l}
            </Txt>
          ))}
        </View>

        {page.example && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`যেমন বলুন: ${page.example}, শুনুন`}
            onPress={() => void speak(page.example!)}
            style={({ pressed }) => [styles.example, { borderColor: tone.solid, backgroundColor: tone.tint }, pressed && styles.pressed]}
          >
            <View style={styles.exampleHead}>
              <Icon name="mic" size={24} color={tone.ink} />
              <Txt size={fontSize.body} weight="bold" color={tone.ink}>
                যেমন বলুন
              </Txt>
            </View>
            <Txt wrap size={fontSize.heading} weight="bold" color={colors.ink}>
              {`“${page.example}”`}
            </Txt>
          </Pressable>
        )}
      </ScrollView>

      <View accessibilityLabel="পাতা" style={styles.dots}>
        {TUTORIAL_PAGES.map((p, n) => (
          <View key={p.key} style={[styles.dot, n === i && { backgroundColor: tone.solid, width: 22 }]} />
        ))}
      </View>

      <View style={styles.footer}>
        {i > 0 && (
          <Pressable accessibilityRole="button" accessibilityLabel="আগের পাতা" onPress={() => setI(i - 1)} style={({ pressed }) => [styles.prev, pressed && styles.pressed]}>
            <Icon name="back" size={30} color={colors.ink} strokeWidth={2.4} />
            <Txt size={fontSize.button} weight="bold">
              আগের
            </Txt>
          </Pressable>
        )}
        <Pressable
          accessibilityRole="button"
          onPress={() => (last ? finish() : setI(i + 1))}
          style={({ pressed }) => [styles.next, { backgroundColor: tone.solid }, pressed && styles.pressed]}
        >
          <Txt size={fontSize.listAmount} weight="bold" color={colors.onColor}>
            {last ? 'শুরু করুন' : 'পরের'}
          </Txt>
          <Icon name={last ? 'check' : 'arrow'} size={30} color={colors.onColor} strokeWidth={2.4} />
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: spacing.screen, paddingBottom: spacing.screen, gap: spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingTop: spacing.xl },
  flex: { flex: 1 },
  center: { textAlign: 'center' },
  skip: { minHeight: size.iconButton, paddingHorizontal: spacing.lg, borderRadius: radius.pill, backgroundColor: colors.neutralTint, alignItems: 'center', justifyContent: 'center' },
  listen: { width: size.iconButton, height: size.iconButton, borderRadius: radius.pill, backgroundColor: colors.dark, alignItems: 'center', justifyContent: 'center' },
  body: { flexGrow: 1, alignItems: 'stretch', justifyContent: 'center', gap: spacing.xl, paddingVertical: spacing.md },
  bigIcon: { alignSelf: 'center', width: 168, height: 168, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  iconDisc: { width: 124, height: 124, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  lines: { gap: spacing.sm },
  example: { borderWidth: 2, borderRadius: radius.section, padding: spacing.lg, gap: spacing.xs },
  exampleHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: radius.pill, backgroundColor: colors.border },
  footer: { flexDirection: 'row', gap: spacing.sm },
  prev: { minHeight: size.bigAction, paddingHorizontal: spacing.xl, borderRadius: radius.button, backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
  next: { flex: 1, minHeight: size.bigAction, borderRadius: radius.button, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  pressed: { opacity: 0.85 },
});
