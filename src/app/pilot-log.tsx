import { useCallback, useState } from 'react';
import { FlatList, Pressable, Share, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { Icon } from '../components/Icon';
import { Txt } from '../components/Txt';
import { pilotLog, pilotStats, type Outcome, type PilotStats, type VoiceLogRow } from '../db/repo';
import { getDevice } from '../device';
import { formatNumber, toBnDigits } from '../lib/bn';
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

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        setStats(await pilotStats(db));
        setRows(await pilotLog(db, 300));
      })();
    }, [db]),
  );

  const share = async () => {
    const all = await pilotLog(db, 5000);
    const device = getDevice();
    const payload = {
      app: 'mudi-dokan',
      exported_at: new Date().toISOString(),
      device: { name: device.name, role: device.role },
      stats: await pilotStats(db),
      logs: all.map((r) => ({
        at: new Date(r.created_at).toISOString(),
        source: r.source,
        transcript: r.transcript,
        alternatives: r.alternatives_json ? (JSON.parse(r.alternatives_json) as string[]) : undefined,
        parsed: r.parsed_json ? (JSON.parse(r.parsed_json) as unknown) : undefined,
        outcome: r.outcome,
        edits: r.edits_json ? (JSON.parse(r.edits_json) as string[]) : undefined,
        saved: r.final_json ? (JSON.parse(r.final_json) as unknown) : undefined,
        stt_error: r.stt_error ?? undefined,
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
          </Txt>
        </View>
      )}

      <FlatList
        data={rows}
        keyExtractor={(r) => r.id}
        contentContainerStyle={styles.list}
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
                  {time(item.created_at)} · {item.source === 'typed' ? 'লেখা' : 'বলা'}
                  {parsed?.intent ? ` · ${parsed.intent}` : ''}
                  {item.edits_json ? ` · বদল: ${(JSON.parse(item.edits_json) as string[]).join(', ')}` : ''}
                </Txt>
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
  badge: { borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
});
