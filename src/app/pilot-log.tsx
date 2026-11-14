import { useCallback, useState } from 'react';
import { Alert, FlatList, Pressable, Share, StyleSheet, View } from 'react-native';
import { File } from 'expo-file-system';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { Icon } from '../components/Icon';
import { Txt } from '../components/Txt';
import { pilotLog, pilotStats, setSttOk, wipePilotData, type Outcome, type PilotStats, type VoiceLogRow } from '../db/repo';
import { getDevice, writer } from '../device';
import { BUILD, buildLabel } from '../lib/buildInfo';
import { formatNumber, toBnDigits } from '../lib/bn';
import { speak } from '../lib/speak';
import { useClipPlayer } from '../lib/useClipPlayer';
import { colors, fontSize, radius, size, spacing } from '../theme/tokens';

const OUTCOME: Record<Outcome, { label: string; bg: string; ink: string }> = {
  saved: { label: 'ঠিক', bg: colors.saleTint, ink: colors.saleDark },
  saved_edited: { label: 'ঠিক করে রাখা', bg: colors.stockTint, ink: colors.stock },
  cancelled: { label: 'বাতিল', bg: colors.bakiTint, ink: colors.bakiInk },
  pending: { label: 'ছেড়ে গেছে', bg: colors.bakiTint, ink: colors.bakiInk },
  unsupported: { label: 'অন্য কাজ', bg: colors.neutralTint, ink: colors.ink2 },
  stt_error: { label: 'শোনা যায়নি', bg: colors.neutralTint, ink: colors.ink2 },
};

/** "পাইলট ডাটা মুছুন" must be held this long before the confirm dialog opens. */
const WIPE_HOLD_MS = 3000;

const time = (ms: number) => {
  const d = new Date(ms);
  return toBnDigits(`${d.getDate()}/${d.getMonth() + 1} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`);
};

/** Pilot debug log: every command, what happened, ▶️ the clip, share as JSON. */
export default function PilotLogScreen() {
  const db = useSQLiteContext();
  const play = useClipPlayer();
  const [stats, setStats] = useState<PilotStats | null>(null);
  const [rows, setRows] = useState<VoiceLogRow[]>([]);

  const load = useCallback(async () => {
    setStats(await pilotStats(db));
    setRows(await pilotLog(db, 300));
  }, [db]);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  /** Reviewer listened to the clip: did STT write what was said? Tap again to clear. */
  const markStt = async (r: VoiceLogRow, ok: boolean) => {
    const next = r.stt_ok === (ok ? 1 : 0) ? null : ok;
    await setSttOk(db, writer(), r.id, next);
    await load();
  };

  const wipe = () =>
    Alert.alert(
      'পাইলট ডাটা মুছবেন?',
      'সব বিক্রি, বাকি, মাল, ক্রেতা, পাইলট লগ আর রেকর্ড মুছে যাবে। ফেরত আনা যাবে না। আগে শেয়ার করে রাখুন।',
      [
        { text: 'না', style: 'cancel' },
        {
          text: 'মুছুন',
          style: 'destructive',
          onPress: () =>
            void (async () => {
              const audio = await wipePilotData(db);
              for (const uri of audio) {
                try {
                  new File(uri).delete();
                } catch {
                  // already gone
                }
              }
              await load();
            })(),
        },
      ],
    );

  const share = async () => {
    const all = await pilotLog(db, 5000);
    const device = getDevice();
    const payload = {
      app: 'mudi-dokan',
      exported_at: new Date().toISOString(),
      device: { name: device.name, role: device.role },
      build: BUILD,
      stats: await pilotStats(db),
      logs: all.map((r) => ({
        id: r.id,
        at: new Date(r.created_at).toISOString(),
        source: r.source,
        tab: r.context_tab ?? undefined,
        intent: r.intent ?? undefined,
        transcript: r.transcript,
        alternatives: r.alternatives_json ? (JSON.parse(r.alternatives_json) as string[]) : undefined,
        parsed: r.parsed_json ? (JSON.parse(r.parsed_json) as unknown) : undefined,
        outcome: r.outcome,
        edits: r.edits_json ? (JSON.parse(r.edits_json) as string[]) : undefined,
        saved: r.final_json ? (JSON.parse(r.final_json) as unknown) : undefined,
        stt_error: r.stt_error ?? undefined,
        stt_ok: r.stt_ok === null ? undefined : r.stt_ok === 1,
        via: r.via ?? undefined,
        has_audio: !!r.audio_path,
      })),
    };
    await Share.share({ title: 'মুদি দোকান পাইলট লগ', message: JSON.stringify(payload, null, 1) });
  };

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.top}>
        <Pressable accessibilityRole="button" accessibilityLabel="ফিরে যান" onPress={() => router.back()} style={styles.back}>
          <Icon name="back" size={26} color={colors.ink} strokeWidth={2.2} />
        </Pressable>
        <Txt accessibilityRole="header" size={fontSize.heading} weight="bold" style={styles.flex}>
          পাইলট লগ
        </Txt>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="শুনুন"
          onPress={() =>
            void speak(
              stats
                ? `পাইলট লগ। মোট ${formatNumber(stats.total)}টি কমান্ড। ${stats.accuracy === null ? '' : `ঠিক বুঝেছে ${formatNumber(stats.accuracy)} শতাংশ।`}`
                : 'পাইলট লগ।',
            )
          }
          style={styles.speaker}
        >
          <Icon name="speaker" size={26} color={colors.onColor} strokeWidth={2} />
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => void share()} style={styles.share}>
          <Txt size={fontSize.body} weight="bold" color={colors.onColor}>
            শেয়ার
          </Txt>
        </Pressable>
      </View>

      {stats && (
        <View style={styles.statsCard}>
          <Txt size={fontSize.captionLg} weight="medium" color={colors.onDarkMuted}>
            ঠিক বুঝেছে (লক্ষ্য ৮০%)
          </Txt>
          <Txt size={fontSize.amountLg} weight="bold" color={colors.onColor}>
            {stats.accuracy === null ? '—' : `${toBnDigits(stats.accuracy)}%`}
          </Txt>
          <Txt wrap size={fontSize.captionLg} weight="medium" color={colors.onDarkMuted}>
            মোট {formatNumber(stats.total)} · ঠিক {formatNumber(stats.saved)} · ঠিক করে {formatNumber(stats.edited)} · বাতিল{' '}
            {formatNumber(stats.cancelled)} · অন্য কাজ {formatNumber(stats.unsupported)} · শোনা যায়নি{' '}
            {formatNumber(stats.sttError)}
            {stats.picked > 0 ? ` · ছবি দেখে ${formatNumber(stats.picked)} (হিসাবে নেই)` : ''}
            {stats.sttChecked > 0 ? ` · শোনা ঠিক ${formatNumber(stats.sttOk)}/${formatNumber(stats.sttChecked)}` : ''}
          </Txt>
        </View>
      )}

      <FlatList
        data={rows}
        keyExtractor={(r) => r.id}
        contentContainerStyle={styles.list}
        ListFooterComponent={
          <View style={styles.footer}>
            {/* 3 s hold, then the confirm dialog: a tap while scrolling must not get near a wipe */}
            <Pressable
              accessibilityRole="button"
              accessibilityHint="৩ সেকেন্ড চেপে ধরে রাখুন"
              delayLongPress={WIPE_HOLD_MS}
              onLongPress={wipe}
              style={({ pressed }) => [styles.wipe, pressed && styles.wipeHeld]}
            >
              {({ pressed }) => (
                <Txt size={fontSize.body} weight="bold" color={pressed ? colors.onColor : colors.bakiInk}>
                  {pressed ? 'ধরে রাখুন…' : 'পাইলট ডাটা মুছুন'}
                </Txt>
              )}
            </Pressable>
            <Txt size={fontSize.caption} weight="medium" color={colors.muted} style={styles.center}>
              ৩ সেকেন্ড চেপে ধরে রাখুন
            </Txt>
            <Txt size={fontSize.caption} weight="medium" color={colors.muted} style={styles.center}>
              {buildLabel()}
            </Txt>
          </View>
        }
        ListEmptyComponent={
          <Txt wrap size={fontSize.body} weight="medium" color={colors.muted} style={styles.center}>
            এখনো কিছু নেই। বিক্রি পাতায় মাইক চেপে বলুন।
          </Txt>
        }
        renderItem={({ item }) => {
          const o = OUTCOME[item.outcome];
          const parsed = item.parsed_json ? (JSON.parse(item.parsed_json) as { intent?: string }) : null;
          return (
            <View style={styles.row}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${item.transcript || 'রেকর্ড'} শুনুন`}
                accessibilityState={{ disabled: !item.audio_path }}
                onPress={() => play(item.audio_path)}
                style={[styles.play, !item.audio_path && styles.disabled]}
              >
                <Icon name="play" size={22} color={colors.sale} />
              </Pressable>
              <View style={styles.flex}>
                <Txt wrap size={fontSize.bodyLg} weight="bold">
                  {item.transcript ? `“${item.transcript}”` : `(${item.stt_error ?? 'কিছু না'})`}
                </Txt>
                <Txt wrap size={fontSize.caption} weight="medium" color={colors.muted}>
                  {time(item.created_at)} · {item.via === 'pick' ? 'ছবি দেখে' : item.source === 'typed' ? 'লেখা' : 'বলা'}
                  {item.intent ?? parsed?.intent ? ` · ${item.intent ?? parsed?.intent}` : ''}
                  {item.edits_json ? ` · বদল: ${(JSON.parse(item.edits_json) as string[]).join(', ')}` : ''}
                </Txt>
                {item.source === 'voice' && !!item.transcript && (
                  <View style={styles.sttRow}>
                    <Txt size={fontSize.caption} weight="semibold" color={colors.muted}>
                      শোনা:
                    </Txt>
                    <SttChip label="ঠিক" on={item.stt_ok === 1} onPress={() => void markStt(item, true)} />
                    <SttChip label="ভুল" on={item.stt_ok === 0} onPress={() => void markStt(item, false)} />
                  </View>
                )}
              </View>
              <View style={[styles.badge, { backgroundColor: o.bg }]}>
                <Txt size={fontSize.caption} weight="bold" color={o.ink}>
                  {o.label}
                </Txt>
              </View>
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

function SttChip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={`শোনা ${label}`}
      accessibilityState={{ checked: on }}
      onPress={onPress}
      style={[styles.chip, on && (label === 'ঠিক' ? styles.chipOk : styles.chipBad)]}
    >
      <Txt size={fontSize.caption} weight="bold" color={on ? colors.onColor : colors.ink2}>
        {label}
      </Txt>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: spacing.screen, paddingTop: spacing.screenTop, gap: spacing.md },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  back: {
    width: size.iconButton,
    height: size.iconButton,
    borderRadius: radius.icon,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  speaker: {
    width: size.iconButton,
    height: size.iconButton,
    borderRadius: radius.pill,
    backgroundColor: colors.dark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  share: {
    height: size.iconButton,
    paddingHorizontal: 18,
    borderRadius: radius.pill,
    backgroundColor: colors.dark,
    justifyContent: 'center',
  },
  flex: { flex: 1 },
  center: { textAlign: 'center' },
  statsCard: { backgroundColor: colors.dark, borderRadius: radius.section, padding: spacing.lg, gap: 2 },
  list: { gap: spacing.xs, paddingBottom: spacing.xl },
  row: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  play: {
    width: size.iconButton,
    height: size.iconButton,
    borderRadius: radius.pill,
    backgroundColor: colors.saleTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.35 },
  sttRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: 4 },
  chip: {
    minWidth: 56,
    minHeight: 36,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipOk: { backgroundColor: colors.sale, borderColor: colors.sale },
  chipBad: { backgroundColor: colors.baki, borderColor: colors.baki },
  footer: { gap: spacing.sm, paddingTop: spacing.lg, alignItems: 'center' },
  wipe: {
    minHeight: size.iconButton,
    paddingHorizontal: 20,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.baki,
    backgroundColor: colors.bakiTint,
    justifyContent: 'center',
  },
  wipeHeld: { backgroundColor: colors.baki },
  badge: { borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
});
