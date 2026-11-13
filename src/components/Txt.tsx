import { StyleSheet, Text, type TextProps } from 'react-native';

import { colors, fonts, fontSize } from '../theme/tokens';

type Weight = keyof typeof fonts;

interface Props extends TextProps {
  size?: number;
  weight?: Weight;
  color?: string;
}

/**
 * Text in Hind Siliguri. Android needs one font family per weight,
 * so weight picks the family instead of fontWeight.
 */
export function Txt({ size = fontSize.body, weight = 'semibold', color = colors.ink, style, ...rest }: Props) {
  return (
    <Text
      {...rest}
      style={[styles.base, { fontFamily: fonts[weight], fontSize: size, color, lineHeight: Math.round(size * 1.35) }, style]}
    />
  );
}

const styles = StyleSheet.create({
  // Bangla glyphs sit lower than Latin; keep Android's extra font padding off for even boxes
  base: { includeFontPadding: false },
});
