import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { ConfirmSheet } from '../components/ConfirmSheet';
import { Icon } from '../components/Icon';
import { Txt } from '../components/Txt';
import type { Db } from '../db/repo';
import type { DriveFile } from '../drive/api';
import { backupNow, listBackups, loadBackupFile, loadDriveBackup, restoreFrom, shareBackupFile, useDriveStatus } from '../drive/app';
import type { BackupFile, ParseResult } from '../drive/backup';
import { backupWords, bytesBn, whenBn } from '../drive/words';
import { formatNumber } from '../lib/bn';
import { nav } from '../lib/nav';
import { speak, stopSpeaking } from '../lib/speak';
import { agoBn } from '../sync/words';
import { colors, fontSize, radius, size, spacing } from '../theme/tokens';

const NOW_FAIL_BN = {
  no_account: 'Google অ্যাকাউন্টে ঢোকা নেই। ফাইল হিসেবে শেয়ার করে রাখুন।',
  no_access: 'Drive চালু হয়নি, ব্যাকআপ নেওয়া গেল না।',
  offline: 'ইন্টারনেট নেই। নেট এলে আবার চাপুন।',
  error: 'ব্যাকআপ নেওয়া গেল না। আবার চেষ্টা করুন।',
} as const;

const PARSE_FAIL_BN = {
  not_backup: 'এটা মুদি দোকানের ব্যাকআপ ফাইল না।',
  newer_app: 'এই ব্যাকআপ নতুন অ্যাপের। আগে অ্যাপ আপডেট করুন।',
} as const;

const rowsIn = (b: BackupFile) => Object.values(b.tables).reduce((n, t) => n + t.length, 0);

/**
 * ⚙ › ব্যাকআপ: last backup, "এখন ব্যাকআপ নিন" (Drive), "ব্যাকআপ থেকে ফেরত আনুন" (a Drive
 * backup or a file; হ্যাঁ/না first; this phone's data is copied aside before), and
 * "ফাইল হিসেবে শেয়ার" (JSON through the share sheet, works without Google).
 */
export default function BackupScreen() {
  const db = useSQLiteContext() as unknown as Db;
  const s = useDriveStatus();
  const [busy, setBusy] = useState<null | 'now' | 'share' | 'list' | 'load' | 'restore'>(null);
  const [picking, setPicking] = useState(false);
  const [files, setFiles] = useState<DriveFile[] | null>(null);
  const [chosen, setChosen] = useState<{ backup: BackupFile; label: string } | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      return () => stopSpeaking();
    }, []),
  );

  const say = (t: string) => {
    setNote(t);
    void speak(t);
  };

  const now = async () => {
    setBusy('now');
    const r = await backupNow();
    setBusy(null);
    if (r.ok) say('ব্যাকআপ নেওয়া হয়েছে, Drive এ আছে।');
    else {
      say(NOW_FAIL_BN[r.reason]);
      if (r.message) console.warn('backup', r.message);
    }
  };

  const share = async () => {
    setBusy('share');
    try {
      await shareBackupFile();
    } catch (e) {
      say('ফাইল বানানো গেল না।');
      console.warn('share backup', e);
    } finally {
      setBusy(null);
    }
  };

  const openPicker = async () => {
    setPicking(true);
    setFiles(null);
    void speak('কোন ব্যাকআপ ফেরত আনবেন? তালিকা থেকে বাছুন, বা ফোনের ফাইল থেকে আনুন।');
    if (!s.signedIn) return;
    setBusy('list');
    try {
      setFiles(await listBackups());
    } catch (e) {
      say('Drive এর ব্যাকআপ আনা গেল না। ইন্টারনেট দেখুন।');
      console.warn('list backups', e);
    } finally {
      setBusy(null);
    }
  };

  const choose = async (load: () => Promise<ParseResult | null>, label: (b: BackupFile) => string) => {
    setBusy('load');
    try {
      const r = await load();
      if (!r) return;
      if (!r.ok) {
        say(PARSE_FAIL_BN[r.reason]);
        return;
      }
      setChosen({ backup: r.backup, label: label(r.backup) });
    } catch (e) {
      say('ব্যাকআপ খোলা গেল না।');
      console.warn('load backup', e);
    } finally {
      setBusy(null);
    }
  };

  const restore = async () => {
    if (!chosen) return;
    setBusy('restore');
    try {
      const r = await restoreFrom(db, chosen.backup);
      setChosen(null);
      setPicking(false);
      say(
        r.added || r.updated
          ? `ফেরত আনা হয়েছে। ${formatNumber(r.added)}টা নতুন হিসাব যোগ হয়েছে। আগের সব হিসাব ঠিক আছে।`
          : 'ফেরত আনা হয়েছে। এই ফোনে সব হিসাব আগে থেকেই ছিল।',
      );
    } catch (e) {
      say('ফেরত আনা গেল না। ফোনের হিসাব যেমন ছিল তেমন আছে।');
      console.warn('restore', e);
    } finally {
      setBusy(null);
    }
  };

  const confirmText = chosen
    ? `${chosen.label} এর ব্যাকআপ ফেরত আনবেন? এতে ${formatNumber(rowsIn(chosen.backup))}টা হিসাব আছে। ` +
      'এই ফোনের কিছু মুছবে না, যা নেই শুধু তা যোগ হবে। আগে এই ফোনের হিসাবের একটা কপি রাখা হবে।'
    : '';

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.top}>
        <Pressable accessibilityRole="button" accessibilityLabel="ফিরে যান" onPress={() => nav.back()} style={styles.square}>
          <Icon name="back" size={26} color={colors.ink} strokeWidth={2.2} />
        </Pressable>
        <Txt accessibilityRole="header" size={fontSize.headingLg} weight="bold" style={styles.flex}>
          ব্যাকআপ
        </Txt>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="শুনুন"
          onPress={() => void speak(backupWords(s.lastBackupAt, s.signedIn))}
          style={styles.listen}
        >
          <Icon name="speaker" size={26} color={colors.onColor} strokeWidth={2} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.card}>
          <Txt size={fontSize.body} weight="semibold" color={colors.muted}>
            শেষ ব্যাকআপ
          </Txt>
          <Txt size={fontSize.listAmount} weight="bold">
            {s.lastBackupAt === null ? 'এখনো নেই' : whenBn(s.lastBackupAt)}
          </Txt>
          {s.lastBackupAt !== null && (
            <Txt size={fontSize.captionLg} weight="medium" color={colors.muted}>
              {agoBn(s.lastBackupAt)}
            </Txt>
          )}
          <Txt wrap size={fontSize.caption} weight="medium" color={colors.muted}>
            {s.signedIn ? 'প্রতি রাতে আর দিন শেষ করলে Drive এর “Mudi Dokan/Backup” এ যায়। শেষ ৩০টা থাকে।' : 'Google অ্যাকাউন্টে ঢোকা নেই: Drive এ ব্যাকআপ হচ্ছে না।'}
          </Txt>
        </View>

        {note && (
          <View style={styles.note}>
            <Txt wrap size={fontSize.body} weight="bold" color={colors.saleDark}>
              {note}
            </Txt>
          </View>
        )}

        <Big icon="up" label="এখন ব্যাকআপ নিন" color={colors.sale} busy={busy === 'now'} disabled={!!busy || !s.signedIn} onPress={() => void now()} />
        <Big icon="undo" label="ব্যাকআপ থেকে ফেরত আনুন" color={colors.stock} busy={busy === 'list'} disabled={!!busy} onPress={() => void openPicker()} />

        {picking && (
          <View style={styles.card}>
            {busy === 'list' && <ActivityIndicator color={colors.stock} />}
            {files?.length === 0 && (
              <Txt size={fontSize.body} weight="medium" color={colors.muted}>
                Drive এ কোনো ব্যাকআপ নেই
              </Txt>
            )}
            {files?.map((f, i) => (
              <Pressable
                key={f.id}
                accessibilityRole="button"
                disabled={!!busy}
                onPress={() => void choose(() => loadDriveBackup(f.id), () => whenBn(f.createdTime))}
                style={({ pressed }) => [styles.pickRow, i > 0 && styles.dividerTop, pressed && styles.pressed]}
              >
                <View style={styles.flex}>
                  <Txt size={fontSize.label} weight="bold">
                    {whenBn(f.createdTime)}
                  </Txt>
                  <Txt size={fontSize.caption} weight="medium" color={colors.muted}>
                    {bytesBn(f.size)}
                  </Txt>
                </View>
                <Icon name="arrow" size={24} color={colors.stock} />
              </Pressable>
            ))}
            <Pressable
              accessibilityRole="button"
              disabled={!!busy}
              onPress={() => void choose(loadBackupFile, (b) => `${whenBn(b.created_at)} (${b.device_name})`)}
              style={({ pressed }) => [styles.pickRow, styles.dividerTop, pressed && styles.pressed]}
            >
              {busy === 'load' ? <ActivityIndicator color={colors.stock} /> : <Icon name="list" size={26} color={colors.stock} />}
              <Txt size={fontSize.label} weight="bold" color={colors.stock} style={styles.flex}>
                ফোনের ফাইল থেকে আনুন
              </Txt>
            </Pressable>
          </View>
        )}

        <Big icon="arrow" label="ফাইল হিসেবে শেয়ার" color={colors.ink2} busy={busy === 'share'} disabled={!!busy} onPress={() => void share()} light />
        <Txt wrap size={fontSize.caption} weight="medium" color={colors.muted}>
          Google ছাড়াই: পুরো হিসাব একটা ফাইলে, WhatsApp বা অন্য ফোনে রেখে দিন। ফেরত আনতে “ফোনের ফাইল থেকে আনুন”।
        </Txt>
      </ScrollView>

      <ConfirmSheet visible={!!chosen} busy={busy === 'restore'} text={confirmText} onYes={() => void restore()} onNo={() => setChosen(null)} />
    </SafeAreaView>
  );
}

function Big(p: { icon: 'up' | 'undo' | 'arrow'; label: string; color: string; busy: boolean; disabled: boolean; onPress: () => void; light?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={p.disabled}
      onPress={p.onPress}
      style={({ pressed }) => [
        styles.big,
        p.light ? styles.bigLight : { backgroundColor: p.color },
        p.disabled && !p.busy && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      {p.busy ? (
        <ActivityIndicator color={p.light ? p.color : colors.onColor} />
      ) : (
        <Icon name={p.icon} size={28} color={p.light ? p.color : colors.onColor} strokeWidth={2.4} />
      )}
      <Txt size={fontSize.button} weight="bold" color={p.light ? p.color : colors.onColor}>
        {p.label}
      </Txt>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: spacing.screen, paddingTop: spacing.screenTop, paddingBottom: 18, gap: spacing.md },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
  square: { width: size.iconButton, height: size.iconButton, borderRadius: radius.icon, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  listen: { width: size.iconButton, height: size.iconButton, borderRadius: radius.pill, backgroundColor: colors.dark, alignItems: 'center', justifyContent: 'center' },
  body: { gap: spacing.md, paddingBottom: spacing.xl },
  card: { backgroundColor: colors.surface, borderRadius: radius.section, padding: spacing.lg, gap: spacing.xs },
  note: { backgroundColor: colors.saleTint, borderRadius: radius.icon, padding: spacing.md },
  big: { minHeight: 72, borderRadius: radius.section, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg },
  bigLight: { backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.border },
  pickRow: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  dividerTop: { borderTopWidth: 1, borderTopColor: colors.dividerSoft },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
});
