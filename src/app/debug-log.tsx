import { useCallback, useState } from 'react';
import { FlatList, Pressable, Share, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { Icon } from '../components/Icon';
import { Txt } from '../components/Txt';
import { DEBUG_LOG_LIMIT, debugLog, type VoiceLogRow } from '../db/repo';
import { whenBn } from '../drive/words';
import { buildLabel } from '../lib/buildInfo';
import { nav } from '../lib/nav';
import { useClipPlayer } from '../lib/useClipPlayer';
import { colors, fontSize, radius, size, spacing } from '../theme/tokens';

/**
 * Hidden (⚙ › long-press the version): the last 200 spoken commands, for troubleshooting only.
 * What was written (Ridmik / typed), what the app made of it, the error if any. No scores.
 */
export default function DebugLogScreen() {
  const db = useSQLiteContext();
  const play = useClipPlayer();
  const [rows, setRows] = useState<VoiceLogRow[]>([]);

  useFocusEffect(
    useCallback(() => {
      void debugLog(db).then(setRows);
    }, [db]),
  );

  const share = () => {
    const payload = {
      app: 'mudi-dokan',
      build: buildLabel(),
      exported_at: new Date().toISOString(),
      commands: rows.map((r) => ({
        at: new Date(r.created_at).toISOString(),
        tab: r.context_tab,
        outcome: r.outcome,
        transcript: r.transcript,
        parsed: r.parsed_json ? (JSON.parse(r.parsed_json) as unknown) : null,
        error: r.stt_error,
      })),
    };
    void Share.share({ title: 'মুদি দোকান ডিবাগ লগ', message: JSON.stringify(payload, null, 1) });
  };

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.top}>
        <Pressable accessibilityRole="button" accessibilityLabel="ফিরে যান" onPress={() => nav.back()} style={styles.square}>
          <Icon name="back" size={26} color={colors.ink} strokeWidth={2.2} />
        </Pressable>
        <Txt accessibilityRole="header" size={fontSize.heading} weight="bold" style={styles.flex}>
          ডিবাগ লগ
        </Txt>
        <Pressable accessibilityRole="button" accessibilityLabel="সংখ্যার ফন্ট" onPress={() => nav.push('/font-test')} style={styles.square}>
          <Txt size={fontSize.label} weight="bold">
            ১২৩
          </Txt>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="ভয়েস পরীক্ষা" onPress={() => nav.push('/voice-test')} style={styles.square}>
          <Txt size={fontSize.label} weight="bold">
            🔊
          </Txt>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="শেয়ার" onPress={share} style={styles.square}>
          <Icon name="arrow" size={26} color={colors.ink} strokeWidth={2.2} />
        </Pressable>
      </View>
      <Txt wrap size={fontSize.caption} weight="medium" color={colors.muted}>
        {`${buildLabel()} · শেষ ${DEBUG_LOG_LIMIT}টা`}
      </Txt>
      <FlatList
        data={rows}
        keyExtractor={(r) => r.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Txt size={fontSize.body} weight="medium" color={colors.muted}>
            কিছু নেই
          </Txt>
        }
        renderItem={({ item: r }) => {
          const err = r.stt_error;
          const intent = r.intent;
          return (
            <View style={styles.row}>
              {r.audio_path ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="রেকর্ড শুনুন"
                  onPress={() => play(r.audio_path)}
                  style={styles.play}
                >
                  <Icon name="play" size={20} color={colors.sale} />
                </Pressable>
              ) : (
                <View style={[styles.play, styles.noClip]} />
              )}
              <View style={styles.flex}>
                <Txt wrap size={fontSize.body} weight="bold">
                  {r.transcript || '—'}
                </Txt>
                <Txt wrap size={fontSize.caption} weight="medium" color={colors.muted}>
                  {`${whenBn(r.created_at)} · ${r.context_tab ?? ''} · ${intent ?? '—'} · ${r.outcome}`}
                </Txt>
                {!!err && (
                  <Txt wrap size={fontSize.caption} weight="medium" color={colors.bakiInk}>
                    {err}
                  </Txt>
                )}
              </View>
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: spacing.screen, paddingTop: spacing.screenTop, gap: spacing.sm },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
  square: { width: size.iconButton, height: size.iconButton, borderRadius: radius.icon, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  list: { gap: spacing.xs, paddingBottom: spacing.xl },
  row: { backgroundColor: colors.surface, borderRadius: radius.icon, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm },
  play: { width: 52, height: 52, borderRadius: radius.pill, backgroundColor: colors.saleTint, alignItems: 'center', justifyContent: 'center' },
  noClip: { opacity: 0 },
});
