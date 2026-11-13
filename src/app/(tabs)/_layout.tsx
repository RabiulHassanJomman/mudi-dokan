import { Tabs } from 'expo-router/js-tabs';

import { BottomNav } from '../../components/BottomNav';
import { colors } from '../../theme/tokens';

/** বিক্রি / মাল / বাকি. SDK 58: every tab must be declared here. */
export default function TabLayout() {
  return (
    <Tabs
      tabBar={(props) => <BottomNav {...props} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.bg } }}
    >
      <Tabs.Screen name="index" options={{ title: 'বিক্রি' }} />
      <Tabs.Screen name="stock" options={{ title: 'মাল' }} />
      <Tabs.Screen name="baki" options={{ title: 'বাকি' }} />
    </Tabs>
  );
}
