import { StyleSheet, View } from 'react-native';

import { initialOf } from '../domain/customers';
import { avatarColors, colors, radius } from '../theme/tokens';
import { Txt } from './Txt';

/** Same name → same colour, every time. */
const colorOf = (name: string) => {
  let h = 0;
  for (const c of name) h = (h * 31 + c.codePointAt(0)!) >>> 0;
  return avatarColors[h % avatarColors.length]!;
};

/** Round initial for a customer (Baki list, Customer screen). */
export function Avatar({ name, size = 56 }: { name: string; size?: number }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.circle, { width: size, height: size, backgroundColor: colorOf(name) }]}
    >
      <Txt size={Math.round(size * 0.46)} weight="bold" color={colors.onColor}>
        {initialOf(name)}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
});
