import { Pressable, StyleSheet, View } from 'react-native';
import type { BottomTabBarProps } from 'expo-router/js-tabs';

import { colors, fontSize, radius, size } from '../theme/tokens';
import { Icon, type IconName } from './Icon';
import { Txt } from './Txt';

/** Tab look from the design: active = solid color, others = their tint. */
const TABS: Record<string, { label: string; icon: IconName; solid: string; tint: string; tintInk: string }> = {
  index: { label: 'বিক্রি', icon: 'cart', solid: colors.sale, tint: colors.saleTint, tintInk: colors.saleDark },
  stock: { label: 'মাল', icon: 'box', solid: colors.stock, tint: colors.stockTint, tintInk: colors.stock },
  baki: { label: 'বাকি', icon: 'book', solid: colors.baki, tint: colors.bakiTint, tintInk: colors.bakiInk },
};

/** The three big icon tabs at the bottom (বিক্রি / মাল / বাকি). */
export function BottomNav({ state, emitter, navigateToTab, insets }: BottomTabBarProps) {
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel="প্রধান মেনু"
      style={[styles.bar, { paddingBottom: 10 + insets.bottom }]}
    >
      {state.routes.map((route, i) => {
        const tab = TABS[route.name];
        if (!tab) return null;
        const active = state.index === i;
        const ink = active ? colors.onColor : tab.tintInk;
        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={tab.label}
            onPress={() => {
              const event = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              if (!active && !event.defaultPrevented) navigateToTab(route.key);
            }}
            style={({ pressed }) => [
              styles.tab,
              { backgroundColor: active ? tab.solid : tab.tint, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <Icon name={tab.icon} size={size.navIcon} color={ink} />
            <Txt size={fontSize.body} weight="bold" color={ink}>
              {tab.label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    gap: 8,
    paddingTop: 8,
    paddingHorizontal: 10,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  tab: {
    flex: 1,
    height: size.navTab,
    borderRadius: radius.tab,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
});
