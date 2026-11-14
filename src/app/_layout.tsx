import { useEffect } from 'react';
import { Stack, useRootNavigationState } from 'expo-router';
import { SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';

import { DATABASE_NAME, initDatabase } from '../db/client';
import { nav } from '../lib/nav';
import { colors } from '../theme/tokens';

export default function RootLayout() {
  return (
    <SQLiteProvider databaseName={DATABASE_NAME} onInit={initDatabase}>
      <StatusBar style="dark" />
      <NavReady />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="listening"
          options={{ presentation: 'fullScreenModal', animation: 'fade', contentStyle: { backgroundColor: colors.listening.bg } }}
        />
        <Stack.Screen name="confirm" options={{ animation: 'slide_from_bottom' }} />
        <Stack.Screen name="pilot-log" />
        <Stack.Screen name="setup" options={{ animation: 'fade' }} />
        <Stack.Screen name="pick" options={{ animation: 'slide_from_bottom' }} />
        <Stack.Screen name="customer/[id]" />
        <Stack.Screen name="import" />
        <Stack.Screen name="cash" />
        <Stack.Screen name="cash-count" />
        <Stack.Screen name="history" />
      </Stack>
    </SQLiteProvider>
  );
}

/** Tells the nav queue when the root navigator is mounted: taps made before that run then. */
function NavReady() {
  const key = useRootNavigationState()?.key;
  useEffect(() => nav.setReady(!!key), [key]);
  return null;
}
