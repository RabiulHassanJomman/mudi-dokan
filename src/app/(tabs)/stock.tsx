import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ComingSoon } from '../../components/ComingSoon';
import { ScreenHeader } from '../../components/ScreenHeader';
import { speak } from '../../lib/speak';
import { colors, spacing } from '../../theme/tokens';

/** মাল. Filled in step 4 (product grid, low-stock alert, "নতুন মাল বলুন"). */
export default function StockScreen() {
  return (
    <SafeAreaView edges={['top']} style={styles.screen}>
      <ScreenHeader title="মাল" onListen={() => void speak('মাল পাতা। মালের তালিকা আর স্টক পরের ধাপে আসছে।')} />
      <View style={styles.body}>
        <ComingSoon icon="box" tint={colors.stockTint} ink={colors.stock} text="মালের তালিকা ও স্টক" step={4} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  body: { paddingHorizontal: spacing.screen },
});
