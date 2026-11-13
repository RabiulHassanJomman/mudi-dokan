import { StyleSheet, Text, type TextProps } from 'react-native';

import { colors, fonts, fontSize } from '../theme/tokens';

type Weight = keyof typeof fonts;

interface Props extends TextProps {
  size?: number;
  weight?: Weight;
  color?: string;
  /** Allow several lines (transcripts, messages). Default: one line. */
  wrap?: boolean;
}

/**
 * Text in Hind Siliguri. Android needs one font family per weight,
 * so weight picks the family instead of fontWeight.
 */
export function Txt({ size = fontSize.body, weight = 'semibold', color = colors.ink, wrap = false, style, ...rest }: Props) {
  return (
    <Text
      // Android lays out Bangla in auto-width boxes one hair too narrow, wraps the last
      // word onto a line the box has no height for ("আবার শুনুন" → "আবার").
      // Labels are single-line by default so nothing wraps; long text opts in with `wrap`.
      numberOfLines={wrap ? undefined : 1}
      textBreakStrategy="simple"
      {...rest}
      style={[styles.base, { fontFamily: fonts[weight], fontSize: size, color, lineHeight: Math.round(size * 1.35) }, style]}
    />
  );
}

const styles = StyleSheet.create({
  // Bangla glyphs sit lower than Latin; keep Android's extra font padding off for even boxes
  base: { includeFontPadding: false },
});
