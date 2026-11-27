import { Redirect } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';

import { BottomNav } from '../../components/BottomNav';
import { isSetupDone, isTutorialSeen, markTutorialSeen } from '../../device';
import { colors } from '../../theme/tokens';

/** বিক্রি / মাল / বাকি. SDK 58: every tab must be declared here. */
export default function TabLayout() {
  // প্রথমবার চালু: until this phone has saved Setup once
  if (!isSetupDone()) return <Redirect href="/setup" />;
  // a phone set up before অ্যাপ শেখা existed (or that left it with back): don't show it on its own
  if (!isTutorialSeen()) markTutorialSeen();
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
