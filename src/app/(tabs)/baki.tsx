import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ComingSoon } from '../../components/ComingSoon';
import { ScreenHeader } from '../../components/ScreenHeader';
import { colors, spacing } from '../../theme/tokens';

/** বাকি খাতা. Filled in step 4 (customer list, মোট পাবো). মহাজন tab stays hidden until Phase 3. */
export default function BakiScreen() {
  return (
    <SafeAreaView edges={['top']} style={styles.screen}>
      <ScreenHeader title="বাকি" />
      <View style={styles.body}>
        <ComingSoon icon="book" tint={colors.bakiTint} ink={colors.bakiInk} text="ক্রেতার বাকি খাতা" step={4} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  body: { paddingHorizontal: spacing.screen },
});
