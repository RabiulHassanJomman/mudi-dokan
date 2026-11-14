import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';

import { AccountCard } from '../components/AccountCard';
import { Icon } from '../components/Icon';
import { Txt } from '../components/Txt';
import { driveUsage, enableDrive, kick, setWifiOnly, useDriveStatus } from '../drive/app';
import { bytesBn, driveStateBn, driveWords } from '../drive/words';
import { formatNumber } from '../lib/bn';
import { nav } from '../lib/nav';
import { speak, stopSpeaking } from '../lib/speak';
import { agoBn } from '../sync/words';
import { colors, fontSize, radius, size, spacing } from '../theme/tokens';

/**
 * ⚙ › Drive: where the voice clips go. Storage the app uses on Drive, clips waiting to go up,
 * last upload, "শুধু Wi-Fi তে পাঠান" (default off), "এখন পাঠান".
 */
export default function DriveScreen() {
  const s = useDriveStatus();
  const [usage, setUsage] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void driveUsage()
        .then((u) => alive && setUsage(u))
        .catch(() => undefined);
      return () => {
        alive = false;
        stopSpeaking();
      };
    }, [s.access, s.signedIn]),
  );

  const words = { ...s, usageBytes: usage };

  const turnOn = async () => {
    setBusy(true);
    const ok = await enableDrive();
    setBusy(false);
    void speak(ok ? 'Drive চালু হয়েছে। অডিও পাঠানো শুরু হচ্ছে।' : 'Drive চালু হয়নি।');
  };

  const sendNow = async () => {
    setBusy(true);
    try {
      await kick();
      void speak(driveStateBn(words));
    } finally {
      setBusy(false);
    }
  };

  const toggleWifi = () => {
    const on = !s.wifiOnly;
    void setWifiOnly(on);
    void speak(on ? 'এখন থেকে শুধু Wi-Fi তে অডিও পাঠাবে।' : 'মোবাইল ডাটাতেও অডিও পাঠাবে।');
  };

  const rows: [string, string][] = [
    ['অবস্থা', driveStateBn(words)],
    ['Drive এ জায়গা', usage === null ? '—' : bytesBn(usage)],
    ['পাঠানো বাকি', `${formatNumber(s.pending)}টা অডিও`],
    ['শেষ পাঠানো', agoBn(s.lastUploadAt)],
  ];

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.top}>
        <Pressable accessibilityRole="button" accessibilityLabel="ফিরে যান" onPress={() => nav.back()} style={styles.square}>
          <Icon name="back" size={26} color={colors.ink} strokeWidth={2.2} />
        </Pressable>
        <Txt accessibilityRole="header" size={fontSize.headingLg} weight="bold" style={styles.flex}>
          Drive
        </Txt>
        <Pressable accessibilityRole="button" accessibilityLabel="শুনুন" onPress={() => void speak(driveWords(words))} style={styles.listen}>
          <Icon name="speaker" size={26} color={colors.onColor} strokeWidth={2} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {!s.signedIn && (
          <View style={styles.card}>
            <AccountCard />
          </View>
        )}

        {s.signedIn && s.access !== true && (
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void turnOn()}
            style={({ pressed }) => [styles.enable, pressed && styles.pressed]}
          >
            {busy ? <ActivityIndicator color={colors.onColor} /> : <Icon name="check" size={28} color={colors.onColor} strokeWidth={2.4} />}
            <View style={styles.flex}>
              <Txt size={fontSize.label} weight="bold" color={colors.onColor}>
                Drive চালু করুন
              </Txt>
              <Txt wrap size={fontSize.caption} weight="medium" color={colors.onColor}>
                কথার রেকর্ড আর ব্যাকআপ দোকানের Google Drive এ থাকবে
              </Txt>
            </View>
          </Pressable>
        )}

        <View style={styles.card}>
          {rows.map(([k, v], i) => (
            <View key={k} style={[styles.row, i < rows.length - 1 && styles.divider]}>
              <Txt size={fontSize.body} weight="semibold" color={colors.muted}>
                {k}
              </Txt>
              <Txt wrap size={fontSize.body} weight="bold" style={styles.value}>
                {v}
              </Txt>
            </View>
          ))}
          {!!s.lastError && s.pending > 0 && (
            <Txt wrap size={fontSize.caption} weight="medium" color={colors.bakiInk}>
              {s.lastError}
            </Txt>
          )}
        </View>

        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: s.wifiOnly }}
          onPress={toggleWifi}
          style={({ pressed }) => [styles.card, styles.toggle, pressed && styles.pressed]}
        >
          <View style={styles.flex}>
            <Txt size={fontSize.label} weight="bold">
              শুধু Wi-Fi তে পাঠান
            </Txt>
            <Txt wrap size={fontSize.caption} weight="medium" color={colors.muted}>
              চালু থাকলে মোবাইল ডাটা খরচ হবে না
            </Txt>
          </View>
          <View style={[styles.pill, s.wifiOnly ? styles.pillOn : styles.pillOff]}>
            <Txt size={fontSize.body} weight="bold" color={s.wifiOnly ? colors.onColor : colors.ink2}>
              {s.wifiOnly ? 'চালু' : 'বন্ধ'}
            </Txt>
          </View>
        </Pressable>

        <Txt wrap size={fontSize.caption} weight="medium" color={colors.muted}>
          ৯০ দিনের পুরনো রেকর্ড ফোন আর Drive থেকে মুছে যায়। যে ক্রেতার বাকি আছে, তার রেকর্ড বাকি শোধ না হওয়া পর্যন্ত থাকে।
        </Txt>
      </ScrollView>

      <Pressable
        accessibilityRole="button"
        disabled={busy || s.access !== true}
        onPress={() => void sendNow()}
        style={({ pressed }) => [styles.now, (busy || s.access !== true) && styles.disabled, pressed && styles.pressed]}
      >
        {busy || s.running ? <ActivityIndicator color={colors.onColor} /> : <Icon name="undo" size={28} color={colors.onColor} strokeWidth={2.4} />}
        <Txt size={fontSize.listAmount} weight="bold" color={colors.onColor}>
          এখন পাঠান
        </Txt>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: spacing.screen, paddingTop: spacing.screenTop, paddingBottom: 18, gap: spacing.md },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
  square: { width: size.iconButton, height: size.iconButton, borderRadius: radius.icon, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  listen: { width: size.iconButton, height: size.iconButton, borderRadius: radius.pill, backgroundColor: colors.dark, alignItems: 'center', justifyContent: 'center' },
  body: { gap: spacing.md, paddingBottom: spacing.sm },
  card: { backgroundColor: colors.surface, borderRadius: radius.section, padding: spacing.lg, gap: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 52, gap: spacing.sm },
  value: { flex: 1, textAlign: 'right' },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.dividerSoft },
  enable: {
    minHeight: 80,
    borderRadius: radius.section,
    backgroundColor: colors.stock,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
  },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 72 },
  pill: { minWidth: 72, minHeight: 52, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  pillOn: { backgroundColor: colors.sale },
  pillOff: { backgroundColor: colors.dividerSoft },
  now: {
    height: 80,
    borderRadius: radius.section,
    backgroundColor: colors.stock,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
});
