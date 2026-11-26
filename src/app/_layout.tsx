import { useEffect } from 'react';
import { Stack, useRootNavigationState } from 'expo-router';
import { SQLiteProvider, useSQLiteContext } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';

import { DATABASE_NAME, initDatabase } from '../db/client';
import { nav } from '../lib/nav';
import { mergePairs, onFirstSync, startSync } from '../sync/app';
import { startDrive } from '../drive/app';
import { WipeNotice } from '../components/WipeNotice';
import { startUnderstanding } from '../lib/understand';
import { registerDriveTask } from '../drive/background';
import { colors } from '../theme/tokens';

/**
 * Must be one constant object: SQLiteProvider reopens the DB (and re-runs onInit, i.e. the
 * migration) whenever `options` changes identity — an inline {} did that on every render.
 */
const DB_OPTIONS = { enableChangeListener: true } as const;

export default function RootLayout() {
  return (
    <SQLiteProvider databaseName={DATABASE_NAME} onInit={initDatabase} options={DB_OPTIONS}>
      <StatusBar style="dark" />
      <NavReady />
      <SyncBoot />
      <WipeNotice />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="listening"
          options={{ presentation: 'fullScreenModal', animation: 'fade', contentStyle: { backgroundColor: colors.listening.bg } }}
        />
        <Stack.Screen name="say" options={{ animation: 'fade' }} />
        <Stack.Screen name="confirm" options={{ animation: 'slide_from_bottom' }} />
        <Stack.Screen name="review" />
        <Stack.Screen name="debug-log" />
        <Stack.Screen name="font-test" />
        <Stack.Screen name="voice-test" />
        <Stack.Screen name="wipe" />
        <Stack.Screen name="setup" options={{ animation: 'fade' }} />
        <Stack.Screen name="pick" options={{ animation: 'slide_from_bottom' }} />
        <Stack.Screen name="customer/[id]" />
        <Stack.Screen name="import" />
        <Stack.Screen name="cash" />
        <Stack.Screen name="cash-count" />
        <Stack.Screen name="history" />
        <Stack.Screen name="sync" />
        <Stack.Screen name="drive" />
        <Stack.Screen name="backup" />
        <Stack.Screen name="merge" options={{ animation: 'slide_from_bottom' }} />
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

/**
 * Starts sync once the DB is migrated (SQLiteProvider renders children after onInit).
 * After the first pull from the shop account: "এই দুইটা কি একই?" if the two phones made the
 * same product/customer.
 */
function SyncBoot() {
  const db = useSQLiteContext();
  useEffect(() => {
    void startSync().catch((e) => console.warn('sync start failed', e));
    // step 8: voice clips to Drive, nightly backup, 90-day audio retention
    startDrive();
    // Gemini only: what was said offline is understood when it can be
    startUnderstanding();
    void registerDriveTask();
    return onFirstSync(() => {
      void mergePairs(db).then((p) => {
        if (p.length) nav.push('/merge');
      });
    });
  }, [db]);
  return null;
}
