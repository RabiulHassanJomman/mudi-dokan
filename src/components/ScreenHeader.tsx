import { Pressable, StyleSheet, View } from 'react-native';

import { colors, fontSize, radius, size, spacing } from '../theme/tokens';
import { Icon } from './Icon';
import { Txt } from './Txt';

interface Props {
  title: string;
  /** "শুনুন" reads the screen aloud. */
  onListen?: () => void;
  /** ⚙ (home only): সেটিংস. */
  onSettings?: () => void;
}

/** Title + dark "শুনুন" pill, as on every tab screen in the design. */
export function ScreenHeader({ title, onListen, onSettings }: Props) {
  return (
    <View style={styles.row}>
      <Txt accessibilityRole="header" size={fontSize.headingLg} weight="bold" style={styles.title}>
        {title}
      </Txt>
      {onSettings && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="সেটিংস"
          onPress={onSettings}
          style={({ pressed }) => [styles.settings, pressed && { opacity: 0.85 }]}
        >
          <Icon name="settings" size={26} color={colors.ink2} strokeWidth={2} />
        </Pressable>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="শুনুন"
        accessibilityState={{ disabled: !onListen }}
        onPress={onListen}
        style={({ pressed }) => [styles.listen, { opacity: !onListen ? 0.55 : pressed ? 0.85 : 1 }]}
      >
        <Icon name="speaker" size={26} color={colors.onColor} strokeWidth={2} />
        <Txt size={fontSize.body} weight="semibold" color={colors.onColor}>
          শুনুন
        </Txt>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.screen,
    paddingTop: spacing.screenTop,
    paddingBottom: spacing.sm,
  },
  title: { flex: 1 },
  settings: {
    width: size.iconButton,
    height: size.iconButton,
    borderRadius: radius.icon,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listen: {
    height: size.iconButton,
    paddingHorizontal: 16,
    borderRadius: radius.pill,
    backgroundColor: colors.dark,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
});
