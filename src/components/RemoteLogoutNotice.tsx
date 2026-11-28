import { useEffect } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { speak } from '../lib/speak';
import { useRemoteLogout } from '../sync/app';
import { colors, fontSize, radius, spacing } from '../theme/tokens';
import { Icon } from './Icon';
import { Txt } from './Txt';

const TEXT = 'অ্যাডমিন এই ফোন লগ আউট করেছেন। এই ফোনের হিসাব ফোনেই আছে, শুধু সিঙ্ক বন্ধ। আবার চালু করতে সেটিংস থেকে Google অ্যাকাউন্টে ঢুকুন।';

/** An admin logged this phone out (ফোনগুলো): say so once, until ঠিক আছে. */
export function RemoteLogoutNotice() {
  const [shown, dismiss] = useRemoteLogout();
  useEffect(() => {
    if (shown) void speak(TEXT);
  }, [shown]);
  return (
    <Modal visible={shown} transparent animationType="fade" onRequestClose={dismiss}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.head}>
            <Icon name="phone" size={30} color={colors.bakiInk} />
            <Txt size={fontSize.label} weight="bold" color={colors.bakiInk} style={styles.flex}>
              লগ আউট হয়েছে
            </Txt>
            <Pressable accessibilityRole="button" accessibilityLabel="শুনুন" onPress={() => void speak(TEXT)} style={styles.listen}>
              <Icon name="speaker" size={24} color={colors.onColor} />
            </Pressable>
          </View>
          <Txt wrap size={fontSize.body} weight="semibold">
            {TEXT}
          </Txt>
          <Pressable accessibilityRole="button" onPress={dismiss} style={({ pressed }) => [styles.ok, pressed && { opacity: 0.85 }]}>
            <Icon name="check" size={28} color={colors.onColor} strokeWidth={2.4} />
            <Txt size={fontSize.label} weight="bold" color={colors.onColor}>
              ঠিক আছে
            </Txt>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.section, borderTopRightRadius: radius.section, padding: spacing.xl, gap: spacing.lg },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
  listen: { width: 52, height: 52, borderRadius: radius.pill, backgroundColor: colors.dark, alignItems: 'center', justifyContent: 'center' },
  ok: { minHeight: 72, borderRadius: radius.section, backgroundColor: colors.sale, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
});
