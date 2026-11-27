import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon } from '../components/Icon';
import { Txt } from '../components/Txt';
import { nav } from '../lib/nav';
import { colors, fontSize, radius, size, spacing } from '../theme/tokens';

const DIGITS = '১২৩৪৫৬৭৮৯০';
const SAMPLE = '৳ ১১১ · ১০১ · ৭১১ · ৩,১২০ · ২.৫ · ৫০০ · ৬৯৮';

/** Hidden (⚙ › ডিবাগ লগ › ফন্ট): the digits in the app's two fonts, the way the phone draws them. */
const CANDIDATES = [
  { name: 'Hind Siliguri (আগে)', family: 'HindSiliguri_700Bold' },
  { name: 'Noto Sans Bengali ✔ বাছা', family: 'NotoSansBengali_700Bold' },
] as const;

export default function FontTestScreen() {
  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.top}>
        <Pressable accessibilityRole="button" accessibilityLabel="ফিরে যান" onPress={() => nav.back()} style={styles.square}>
          <Icon name="back" size={26} color={colors.ink} strokeWidth={2.2} />
        </Pressable>
        <Txt accessibilityRole="header" size={fontSize.heading} weight="bold" style={styles.flex}>
          সংখ্যার ফন্ট
        </Txt>
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        {CANDIDATES.map((c) => (
          <View key={c.name} style={styles.card}>
            <Txt size={fontSize.caption} weight="medium" color={colors.muted}>
              {c.name}
            </Txt>
            <Text style={[styles.big, { fontFamily: c.family }]}>{DIGITS}</Text>
            <Text style={[styles.sample, { fontFamily: c.family }]}>{SAMPLE}</Text>
          </View>
        ))}
        <View style={styles.card}>
          <Txt size={fontSize.caption} weight="medium" color={colors.muted}>
            অ্যাপে এখন (Txt + Num)
          </Txt>
          <Txt size={52} weight="bold">
            {DIGITS}
          </Txt>
          <Txt size={fontSize.listAmount} weight="bold">
            চাল ২ কেজি · ৳ ১২০ · হাতে ক্যাশ ৳ ৮,২৩০
          </Txt>
        </View>
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
  card: { backgroundColor: colors.surface, borderRadius: radius.card, padding: spacing.md, gap: 2 },
  big: { fontSize: 44, lineHeight: 60, color: colors.ink },
  sample: { fontSize: 24, lineHeight: 34, color: colors.ink },
});
