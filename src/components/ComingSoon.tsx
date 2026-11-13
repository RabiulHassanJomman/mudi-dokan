import { StyleSheet, View } from 'react-native';

import { colors, fontSize, radius, spacing } from '../theme/tokens';
import { Icon, type IconName } from './Icon';
import { Txt } from './Txt';

interface Props {
  icon: IconName;
  tint: string;
  ink: string;
  text: string;
  /** Build step that fills this screen (docs/Plan.md › Phase). */
  step: number;
}

/** Placeholder card for screens that later build steps fill in. */
export function ComingSoon({ icon, tint, ink, text, step }: Props) {
  return (
    <View style={styles.card}>
      <View style={[styles.tile, { backgroundColor: tint }]}>
        <Icon name={icon} size={48} color={ink} strokeWidth={1.6} />
      </View>
      <Txt wrap size={fontSize.label} weight="bold" style={styles.center}>
        {text}
      </Txt>
      <Txt size={fontSize.captionLg} weight="medium" color={colors.muted} style={styles.center}>
        ধাপ {toBanglaDigits(step)}-এ আসছে
      </Txt>
    </View>
  );
}

export function toBanglaDigits(n: number | string): string {
  return String(n).replace(/\d/g, (d) => String.fromCharCode(0x09e6 + Number(d)));
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.hero,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.sm,
  },
  tile: {
    width: 88,
    height: 88,
    borderRadius: radius.productHero,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: { textAlign: 'center' },
});
