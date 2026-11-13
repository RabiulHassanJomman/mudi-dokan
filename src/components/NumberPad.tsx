import { Pressable, StyleSheet, View } from 'react-native';

import { PAD_KEYS, padKeyLabel, type PadKey } from '../domain/numpad';
import { toBnDigits } from '../lib/bn';
import { colors, fontSize, radius, spacing } from '../theme/tokens';
import { Icon } from './Icon';
import { Txt } from './Txt';

interface Props {
  onKey: (k: PadKey) => void;
  /** ½ dimmed and inert when false. */
  allowHalf?: boolean;
  keyHeight?: number;
}

/** ১–৯, ½, ০, ⌫ — 3 × 4, big keys (Pick.dc.html). */
export function NumberPad({ onKey, allowHalf = true, keyHeight = 60 }: Props) {
  return (
    <View style={styles.grid}>
      {PAD_KEYS.map((k) => {
        const off = k === 'half' && !allowHalf;
        return (
          <Pressable
            key={k}
            accessibilityRole="button"
            accessibilityLabel={padKeyLabel(k)}
            accessibilityState={{ disabled: off }}
            disabled={off}
            onPress={() => onKey(k)}
            style={({ pressed }) => [styles.key, { height: keyHeight }, pressed && styles.pressed, off && styles.off]}
          >
            {k === 'back' ? (
              <Icon name="back" size={30} color={colors.ink} strokeWidth={2.4} />
            ) : (
              <Txt size={fontSize.prompt} weight="bold">
                {k === 'half' ? '½' : toBnDigits(k)}
              </Txt>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  // three per row: (100% − 2 gaps) / 3
  key: {
    width: '31.9%',
    flexGrow: 1,
    borderRadius: radius.tab,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { backgroundColor: colors.saleTint },
  off: { opacity: 0.3 },
});
