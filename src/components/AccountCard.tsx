import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { signIn, signOut } from '../sync/auth';
import { useSyncStatus } from '../sync/app';
import { PHASE_BN, agoBn } from '../sync/words';
import { formatNumber } from '../lib/bn';
import { speak } from '../lib/speak';
import { nav } from '../lib/nav';
import { colors, fontSize, radius, size, spacing } from '../theme/tokens';
import { ConfirmSheet } from './ConfirmSheet';
import { Icon } from './Icon';
import { Txt } from './Txt';

const FAIL_BN = {
  cancelled: 'ঢোকা হয়নি।',
  no_play_services: 'এই ফোনে Google Play নেই।',
  network: 'ইন্টারনেট নেই। পরে আবার চেষ্টা করুন।',
  error: 'ঢোকা গেল না। আবার চেষ্টা করুন।',
} as const;

/**
 * দোকানের Google অ্যাকাউন্ট: "ঢুকুন" button, or the signed-in email with "লগ আউট" and
 * (settings) the সিঙ্ক screen. Every phone of the shop uses the same account.
 * Optional: without it the app works the same, only nothing syncs.
 */
export function AccountCard({ showSync = false }: { showSync?: boolean }) {
  const status = useSyncStatus();
  const [busy, setBusy] = useState(false);
  const [askOut, setAskOut] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const email = status?.email ?? null;

  const doSignIn = async () => {
    setBusy(true);
    setFailed(null);
    const r = await signIn();
    setBusy(false);
    if (r.ok) {
      void speak('দোকানের অ্যাকাউন্টে ঢোকা হয়েছে। সিঙ্ক শুরু হচ্ছে।');
    } else {
      setFailed(FAIL_BN[r.reason]);
      void speak(FAIL_BN[r.reason]);
      if (r.message) console.warn('signIn', r.message);
    }
  };

  const doSignOut = async () => {
    setBusy(true);
    try {
      await signOut();
      void speak('লগ আউট হয়েছে। এই ফোনের হিসাব ফোনেই আছে।');
    } finally {
      setBusy(false);
      setAskOut(false);
    }
  };

  if (!email) {
    return (
      <View style={styles.gap}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="দোকানের Google অ্যাকাউন্টে ঢুকুন"
          disabled={busy}
          onPress={() => void doSignIn()}
          style={({ pressed }) => [styles.google, pressed && styles.pressed]}
        >
          {busy ? <ActivityIndicator color={colors.ink} /> : <Txt size={fontSize.heading} weight="bold" color={colors.stock}>G</Txt>}
          <Txt size={fontSize.label} weight="bold" style={styles.flex}>
            দোকানের Google অ্যাকাউন্টে ঢুকুন
          </Txt>
        </Pressable>
        <Txt wrap size={fontSize.captionLg} weight="medium" color={colors.muted}>
          {failed ?? 'দোকানের সব ফোনে একই অ্যাকাউন্ট। না ঢুকলেও অ্যাপ চলবে, শুধু অন্য ফোনে হিসাব যাবে না।'}
        </Txt>
      </View>
    );
  }

  const stats = status?.stats;
  return (
    <View style={styles.gap}>
      <View style={styles.row}>
        <View style={styles.ok}>
          <Icon name="check" size={24} color={colors.onColor} strokeWidth={2.6} />
        </View>
        <Txt size={fontSize.body} weight="bold" style={styles.flex}>
          {email}
        </Txt>
      </View>
      {status && (
        <Txt wrap size={fontSize.captionLg} weight="medium" color={status.phase === 'error' ? colors.bakiInk : colors.muted}>
          {`${PHASE_BN[status.phase]} · শেষ সিঙ্ক ${agoBn(stats?.lastSyncAt ?? null)}${stats?.pending ? ` · বাকি ${formatNumber(stats.pending)}` : ''}`}
        </Txt>
      )}
      <View style={styles.row}>
        {showSync && (
          <Pressable
            accessibilityRole="button"
            onPress={() => nav.push('/sync')}
            style={({ pressed }) => [styles.button, styles.syncButton, pressed && styles.pressed]}
          >
            <Icon name="undo" size={24} color={colors.stock} />
            <Txt size={fontSize.body} weight="bold" color={colors.stock}>
              সিঙ্ক
            </Txt>
          </Pressable>
        )}
        <Pressable
          accessibilityRole="button"
          onPress={() => setAskOut(true)}
          style={({ pressed }) => [styles.button, styles.outButton, pressed && styles.pressed]}
        >
          <Txt size={fontSize.body} weight="bold" color={colors.bakiInk}>
            লগ আউট
          </Txt>
        </Pressable>
      </View>
      <ConfirmSheet
        visible={askOut}
        busy={busy}
        text="লগ আউট করবেন? এই ফোনের হিসাব ফোনেই থাকবে, শুধু সিঙ্ক বন্ধ হবে।"
        onYes={() => void doSignOut()}
        onNo={() => setAskOut(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { gap: spacing.sm },
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  google: {
    minHeight: size.stepper,
    borderRadius: radius.icon,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  ok: { width: 40, height: 40, borderRadius: radius.pill, backgroundColor: colors.sale, alignItems: 'center', justifyContent: 'center' },
  button: { flex: 1, minHeight: 56, borderRadius: radius.icon, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
  syncButton: { backgroundColor: colors.stockTint },
  outButton: { backgroundColor: colors.bakiTint },
  pressed: { opacity: 0.85 },
});
