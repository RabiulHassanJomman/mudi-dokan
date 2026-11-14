import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import type { PadKey } from '../domain/numpad';
import { toBnDigits } from '../lib/bn';
import { colors, fontSize, radius, size, spacing } from '../theme/tokens';
import { Icon } from './Icon';
import { NumberPad } from './NumberPad';
import { Txt } from './Txt';

interface Props {
  visible: boolean;
  title: string;
  initial: string | null;
  onDone: (phone: string | null) => void;
  onClose: () => void;
}

/** A phone number on the big pad: digits kept as text (leading ০ stays), up to 11. */
export function PhoneSheet({ visible, title, initial, onDone, onClose }: Props) {
  const [s, setS] = useState('');
  useEffect(() => {
    if (visible) setS(initial ?? '');
  }, [visible, initial]);
  const press = (k: PadKey) => setS((v) => (k === 'back' ? v.slice(0, -1) : k === 'half' || v.length >= 11 ? v : v + k));

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.top}>
            <Txt size={fontSize.label} weight="bold" style={styles.flex}>
              {title}
            </Txt>
            <Pressable accessibilityRole="button" accessibilityLabel="বন্ধ" onPress={onClose} style={styles.close}>
              <Icon name="close" size={26} color={colors.ink} strokeWidth={2.4} />
            </Pressable>
          </View>
          <View style={styles.display}>
            <Txt size={fontSize.amount} weight="bold" color={s ? colors.ink : colors.muted}>
              {s ? toBnDigits(s) : '০১…'}
            </Txt>
          </View>
          <NumberPad allowHalf={false} onKey={press} />
          <Pressable accessibilityRole="button" onPress={() => onDone(s || null)} style={({ pressed }) => [styles.ok, pressed && { opacity: 0.85 }]}>
            <Icon name="check" size={30} color={colors.onColor} strokeWidth={2.6} />
            <Txt size={fontSize.button} weight="bold" color={colors.onColor}>
              রাখুন
            </Txt>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(24,32,28,0.55)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.hero,
    borderTopRightRadius: radius.hero,
    padding: spacing.screen,
    paddingBottom: spacing.xxl,
    gap: spacing.sm,
  },
  top: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  close: {
    width: size.iconButton,
    height: size.iconButton,
    borderRadius: radius.icon,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  display: { backgroundColor: colors.surface, borderRadius: radius.card, paddingHorizontal: spacing.lg, paddingVertical: spacing.xs },
  ok: {
    height: 72,
    borderRadius: radius.button,
    backgroundColor: colors.sale,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
});
