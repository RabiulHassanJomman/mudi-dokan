import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { padDisplay, padPress, padValue } from '../domain/numpad';
import { colors, fontSize, radius, size, spacing } from '../theme/tokens';
import { Icon } from './Icon';
import { NumberPad } from './NumberPad';
import { Txt } from './Txt';

interface Props {
  visible: boolean;
  title: string;
  /** Shown before the number, e.g. "৳". */
  prefix?: string;
  initial: number | null;
  maxDigits?: number;
  onDone: (value: number | null) => void;
  onClose: () => void;
}

/** A number typed on the big pad, in a bottom sheet (Setup cash; later CashCount, price edits). */
export function NumberPadSheet({ visible, title, prefix, initial, maxDigits = 7, onDone, onClose }: Props) {
  const [s, setS] = useState('');
  useEffect(() => {
    if (visible) setS(initial === null ? '' : String(Math.round(initial)));
  }, [visible, initial]);

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
            <Txt size={fontSize.amountLg} weight="bold" color={s ? colors.ink : colors.muted}>
              {`${prefix ? `${prefix} ` : ''}${padDisplay(s) || '০'}`}
            </Txt>
          </View>
          <NumberPad allowHalf={false} onKey={(k) => setS((v) => padPress(v, k, { allowHalf: false, maxDigits }))} />
          <Pressable
            accessibilityRole="button"
            onPress={() => onDone(padValue(s))}
            style={({ pressed }) => [styles.ok, pressed && styles.pressed]}
          >
            <Icon name="check" size={30} color={colors.onColor} strokeWidth={2.6} />
            <Txt size={fontSize.button} weight="bold" color={colors.onColor}>
              ঠিক আছে
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
  pressed: { opacity: 0.85 },
});
