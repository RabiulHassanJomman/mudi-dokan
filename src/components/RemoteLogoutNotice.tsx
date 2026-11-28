import { useEffect } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { nav } from '../lib/nav';
import { speak } from '../lib/speak';
import { useRemoteLogout } from '../sync/app';
import { colors, fontSize, radius, spacing } from '../theme/tokens';
import { Icon } from './Icon';
import { Txt } from './Txt';

const TEXT = 'অ্যাডমিন এই ফোন লগ আউট করেছেন, তাই এই ফোনের হিসাব মুছে ফেলা হয়েছে। দোকানের হিসাব অন্য ফোনে আছে। আবার চালু করতে Google অ্যাকাউন্টে ঢুকুন।';

/** An admin logged this phone out and its data was erased (ফোনগুলো): say so, then ঠিক আছে → দোকান চালু করুন. */
export function RemoteLogoutNotice() {
  const [shown, close] = useRemoteLogout();
  // the phone is empty now: start again like a new phone
  const dismiss = () => {
    close();
    nav.replace('/setup');
  };
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
