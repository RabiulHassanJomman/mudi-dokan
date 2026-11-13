import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSQLiteContext } from 'expo-sqlite';

import { toBanglaDigits } from '../../components/ComingSoon';
import { Icon } from '../../components/Icon';
import { ScreenHeader } from '../../components/ScreenHeader';
import { Txt } from '../../components/Txt';
import { SCHEMA_VERSION } from '../../db/migrations';
import { parseCommand } from '../../parser';
import { colors, fonts, fontSize, radius, size, spacing } from '../../theme/tokens';

/** বিক্রি (home). Step 1: shell only — mic wiring is step 2. */
export default function SaleScreen() {
  return (
    <SafeAreaView edges={['top']} style={styles.screen}>
      <ScreenHeader title="আমার দোকান" />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={styles.micArea}>
          <View
            accessible
            accessibilityRole="button"
            accessibilityLabel="বলতে চাপুন (ধাপ ২-এ চালু হবে)"
            accessibilityState={{ disabled: true }}
            style={styles.mic}
          >
            <Icon name="mic" size={84} color={colors.onColor} />
          </View>
          <Txt size={fontSize.prompt} weight="bold">
            চাপুন, বলুন
          </Txt>
          <Txt size={fontSize.captionLg} weight="medium" color={colors.muted}>
            মাইক ধাপ ২-এ চালু হবে
          </Txt>
        </View>
        <ParserCheck />
        <DbStatus />
      </ScrollView>
    </SafeAreaView>
  );
}

const FIELD_LABELS: Record<string, string> = {
  intent: 'কাজ',
  product: 'মাল',
  item: 'খরচ',
  customer: 'ক্রেতা',
  person: 'কে',
  quantity: 'পরিমাণ',
  amount: 'টাকা',
  buyPrice: 'কেনা দাম',
  sellPrice: 'বেচা দাম',
  credit: 'বাকিতে',
  isNewProduct: 'নতুন মাল',
  note: 'কারণ',
  period: 'সময়',
  missing: 'বাকি আছে',
};

/** Debug: type a command and see what the parser makes of it (proves the app runs src/parser). */
function ParserCheck() {
  const [text, setText] = useState('চাল ২ কেজি');
  const rows = useMemo(() => {
    const { raw: _raw, normalized: _norm, ...fields } = parseCommand(text, { tab: 'sale' });
    return Object.entries(fields)
      .filter(([, v]) => !(Array.isArray(v) && v.length === 0))
      .map(([k, v]) => [FIELD_LABELS[k] ?? k, typeof v === 'object' ? JSON.stringify(v) : String(v)] as const);
  }, [text]);

  return (
    <View style={styles.card}>
      <Txt size={fontSize.captionLg} weight="bold" color={colors.muted}>
        পার্সার পরীক্ষা (লিখে দেখুন)
      </Txt>
      <TextInput
        value={text}
        onChangeText={setText}
        accessibilityLabel="কমান্ড লিখুন"
        placeholder="লিখে দিন…"
        placeholderTextColor={colors.muted}
        style={styles.input}
      />
      {rows.map(([k, v]) => (
        <View key={k} style={styles.row}>
          <Txt size={fontSize.body} weight="medium" color={colors.ink2}>
            {k}
          </Txt>
          <Txt size={fontSize.body} weight="bold" style={styles.value}>
            {v}
          </Txt>
        </View>
      ))}
    </View>
  );
}

/** Debug: confirms the SQLite schema migrated on this phone. */
function DbStatus() {
  const db = useSQLiteContext();
  const [status, setStatus] = useState('ডাটাবেস দেখছি…');
  useEffect(() => {
    let alive = true;
    (async () => {
      const v = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
      const t = await db.getFirstAsync<{ n: number }>(
        "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
      );
      if (!alive) return;
      const ok = v?.user_version === SCHEMA_VERSION;
      setStatus(
        `${ok ? 'ডাটাবেস ঠিক আছে' : 'ডাটাবেস সমস্যা'} · সংস্করণ ${toBanglaDigits(v?.user_version ?? 0)} · ${toBanglaDigits(t?.n ?? 0)}টি টেবিল`,
      );
    })().catch((e: unknown) => alive && setStatus(`ডাটাবেস সমস্যা: ${String(e)}`));
    return () => {
      alive = false;
    };
  }, [db]);
  return (
    <Txt size={fontSize.caption} weight="medium" color={colors.muted} style={styles.dbStatus}>
      {status}
    </Txt>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  body: { paddingHorizontal: spacing.screen, paddingBottom: spacing.xl, gap: spacing.lg },
  micArea: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl },
  mic: {
    width: size.mic,
    height: size.mic,
    borderRadius: radius.pill,
    borderWidth: size.micRing,
    borderColor: colors.micRing,
    backgroundColor: colors.sale,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.6,
  },
  card: { backgroundColor: colors.surface, borderRadius: radius.card, padding: spacing.lg, gap: spacing.xs },
  input: {
    height: size.iconButton,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: radius.icon,
    paddingHorizontal: spacing.lg,
    fontFamily: fonts.medium,
    fontSize: fontSize.label,
    color: colors.ink,
    backgroundColor: colors.surface,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  value: { flexShrink: 1, textAlign: 'right' },
  dbStatus: { textAlign: 'center' },
});
