import { Pressable, StyleSheet, View } from 'react-native';

import { colors, fontSize, productTiles, radius, spacing } from '../theme/tokens';
import { Icon, productIcon } from './Icon';
import { Txt } from './Txt';

interface Props {
  /** What was heard ("চাউল"). */
  spoken: string;
  /** Closest known products, best first. */
  choices: readonly string[];
  onChoose: (name: string) => void;
  /** Default: “চাউল” — এর মধ্যে কোনটা? */
  question?: string;
}

/**
 * A heard product name we don't know, with the closest known ones as big picture chips.
 * Choosing one fixes the line; the heard name is remembered as an alias on save.
 */
export function ProductSuggest({ spoken, choices, onChoose, question }: Props) {
  if (!choices.length) return null;
  return (
    <View style={styles.box}>
      <Txt wrap size={fontSize.body} weight="bold" color={colors.stock}>
        {question ?? `“${spoken}” — নতুন মাল, নাকি এর মধ্যে কোনটা?`}
      </Txt>
      <View style={styles.chips}>
        {choices.map((name) => (
          <Pressable
            key={name}
            accessibilityRole="button"
            accessibilityLabel={`${name} বেছে নিন`}
            onPress={() => onChoose(name)}
            style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
          >
            <View style={[styles.pic, { backgroundColor: productTiles[name] ?? colors.neutralTint }]}>
              <Icon name={productIcon(name)} size={24} color={colors.ink} strokeWidth={1.6} />
            </View>
            <Txt size={fontSize.label} weight="bold">
              {name}
            </Txt>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: colors.stockTint, borderRadius: radius.card, padding: spacing.md, gap: spacing.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    minHeight: 56,
    paddingLeft: 6,
    paddingRight: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.stock,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  pic: { width: 44, height: 44, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.85 },
});
