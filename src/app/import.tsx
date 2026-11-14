import { useCallback, useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';

import { ConfirmSheet } from '../components/ConfirmSheet';
import { Icon } from '../components/Icon';
import { Txt } from '../components/Txt';
import { customerCandidates, importCustomers, type Db } from '../db/repo';
import { customerSpec, importReadback, parseBdPhone, type CustomerLine } from '../domain/customerImport';
import {
  classifyRows,
  editRow,
  importCounts,
  includedRows,
  parseImportText,
  toggleRow,
  type Candidate,
  type ImportRow,
  type ImportSpec,
  type RowStatus,
} from '../domain/importer';
import type { MatchHow } from '../domain/names';
import { writer } from '../device';
import { formatNumber, toBnDigits } from '../lib/bn';
import { speak } from '../lib/speak';
import { colors, fonts, fontSize, radius, size, spacing } from '../theme/tokens';

/**
 * What can be imported. Customers now; products later get their own spec (name, unit,
 * buy price, sell price per line), candidates (with product_aliases) and save.
 */
interface Kind<T> {
  title: string;
  /** "ক্রেতা" — for "১২ জন ক্রেতা যোগ করব". */
  what: string;
  hint: string[];
  spec: ImportSpec<T>;
  candidates(db: Db): Promise<Candidate[]>;
  save(db: Db, rows: T[]): Promise<number>;
  /** Second line of a row (phone, note…). */
  details(v: T): string;
}

const customers: Kind<CustomerLine> = {
  title: 'ক্রেতার তালিকা আনুন',
  what: 'ক্রেতা',
  hint: ['প্রতি লাইনে একজন: নাম, তারপর ফোন (না থাকলেও চলবে)।', 'যেমন: করিম ভাই 01711-123456'],
  spec: customerSpec,
  candidates: customerCandidates,
  save: (db, rows) => importCustomers(db, writer(), rows),
  details: (v) => [v.phone ? toBnDigits(v.phone) : null, v.note].filter(Boolean).join(' · '),
};

const KINDS: Record<string, Kind<CustomerLine>> = { customers };

const STATUS: Record<RowStatus, { label: string; bg: string; ink: string }> = {
  new: { label: 'নতুন', bg: colors.saleTint, ink: colors.saleDark },
  exists: { label: 'আগে থেকে আছে', bg: colors.neutralTint, ink: colors.ink2 },
  maybe: { label: 'সম্ভবত একই', bg: colors.bakiTint, ink: colors.bakiInk },
  invalid: { label: 'নাম নেই', bg: colors.bakiTint, ink: colors.bakiInk },
};
const HOW: Record<MatchHow, string> = {
  exact: 'একই নাম',
  alias: 'অন্য বানান',
  phone: 'একই ফোন',
  phonetic: 'শুনতে একই',
  fuzzy: 'কাছাকাছি নাম',
};

/** Settings → "ক্রেতার তালিকা আনুন": a .txt file → preview → হ্যাঁ → saved. */
export default function ImportScreen() {
  const db = useSQLiteContext();
  const kind = KINDS[useLocalSearchParams<{ kind?: string }>().kind ?? 'customers'] ?? customers;
  const [rows, setRows] = useState<ImportRow<CustomerLine>[] | null>(null);
  const [existing, setExisting] = useState<Candidate[]>([]);
  const [fileName, setFileName] = useState('');
  const [warning, setWarning] = useState<string | null>(null);
  const [editing, setEditing] = useState<ImportRow<CustomerLine> | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  const counts = useMemo(() => (rows ? importCounts(rows) : null), [rows]);

  const summary = useCallback(() => {
    if (!rows || !counts) return `${kind.title}। ${kind.hint.join(' ')} ফাইল বেছে নিন চাপুন।`;
    return (
      `${formatNumber(rows.length)}টি লাইন। নতুন ${formatNumber(counts.new)}, আগে থেকে আছে ${formatNumber(counts.exists)}, ` +
      `সম্ভবত একই ${formatNumber(counts.maybe)}${counts.invalid ? `, নাম নেই ${formatNumber(counts.invalid)}` : ''}। ` +
      `যোগ হবে ${formatNumber(counts.included)} জন।`
    );
  }, [rows, counts, kind]);

  async function pickFile() {
    const res = await DocumentPicker.getDocumentAsync({ type: ['text/plain', 'text/*'], copyToCacheDirectory: true, multiple: false });
    if (res.canceled || !res.assets[0]) return;
    const asset = res.assets[0];
    let text: string;
    try {
      text = await new File(asset.uri).text();
    } catch (e) {
      setWarning(`ফাইল পড়া গেল না (${e instanceof Error ? e.message : String(e)})`);
      return;
    }
    const cands = await kind.candidates(db);
    const next = classifyRows(parseImportText(text, kind.spec), cands, kind.spec);
    setExisting(cands);
    setFileName(asset.name);
    // a non-UTF-8 file (e.g. ANSI/Bijoy) decodes into replacement characters
    setWarning(text.includes('�') ? 'কিছু লেখা ভাঙা দেখাচ্ছে — ফাইলটি UTF-8 এ সেভ করুন।' : next.length ? null : 'ফাইলে কোনো নাম নেই।');
    setRows(next);
    const c = importCounts(next);
    void speak(`${formatNumber(next.length)}টি লাইন পেয়েছি। নতুন ${formatNumber(c.new)} জন।`);
  }

  async function save() {
    if (!rows) return;
    setSaving(true);
    try {
      const n = await kind.save(db, includedRows(rows).map((r) => r.value));
      void speak(`${formatNumber(n)} জন ${kind.what} যোগ হয়েছে।`);
      router.back();
    } catch (e) {
      setSaving(false);
      setConfirming(false);
      void speak('রাখা গেল না।');
      console.warn('import save failed', e);
    }
  }

  const speakRow = (r: ImportRow<CustomerLine>) =>
    void speak(
      `${r.value.name || 'নাম নেই'}। ${STATUS[r.status].label}${r.match ? `, ${r.match.candidate.name} এর সাথে ${HOW[r.match.how]}` : ''}। ` +
        (r.include ? 'যোগ হবে।' : 'বাদ।'),
    );

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.top}>
        <Pressable accessibilityRole="button" accessibilityLabel="ফিরে যান" onPress={() => router.back()} style={styles.back}>
          <Icon name="back" size={26} color={colors.ink} strokeWidth={2.2} />
        </Pressable>
        <Txt accessibilityRole="header" size={fontSize.heading} weight="bold" style={styles.flex}>
          {kind.title}
        </Txt>
        <Pressable accessibilityRole="button" accessibilityLabel="শুনুন" onPress={() => void speak(summary())} style={styles.speaker}>
          <Icon name="speaker" size={26} color={colors.onColor} strokeWidth={2} />
        </Pressable>
      </View>

      {!rows ? (
        <View style={styles.pickBox}>
          {kind.hint.map((h) => (
            <Txt key={h} wrap size={fontSize.body} weight="medium" color={colors.ink2} style={styles.center}>
              {h}
            </Txt>
          ))}
          <Pressable accessibilityRole="button" onPress={() => void pickFile()} style={({ pressed }) => [styles.bigButton, pressed && styles.pressed]}>
            <Icon name="list" size={30} color={colors.onColor} />
            <Txt size={fontSize.listAmount} weight="bold" color={colors.onColor}>
              ফাইল বেছে নিন (.txt)
            </Txt>
          </Pressable>
          {warning && (
            <Txt wrap size={fontSize.body} weight="bold" color={colors.bakiInk} style={styles.center}>
              {warning}
            </Txt>
          )}
        </View>
      ) : (
        <>
          <View style={styles.summary}>
            <Txt size={fontSize.captionLg} weight="bold" color={colors.ink2}>
              {fileName}
            </Txt>
            <Txt wrap size={fontSize.captionLg} weight="medium" color={colors.ink2}>
              নতুন {formatNumber(counts!.new)} · আগে থেকে আছে {formatNumber(counts!.exists)} · সম্ভবত একই {formatNumber(counts!.maybe)}
              {counts!.invalid ? ` · নাম নেই ${formatNumber(counts!.invalid)}` : ''}
            </Txt>
            {warning && (
              <Txt wrap size={fontSize.captionLg} weight="bold" color={colors.bakiInk}>
                {warning}
              </Txt>
            )}
          </View>
          <FlatList
            data={rows}
            keyExtractor={(r) => String(r.line)}
            contentContainerStyle={styles.list}
            renderItem={({ item: r }) => (
              <View style={[styles.row, !r.include && styles.rowSkipped]}>
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityLabel={`${r.value.name || 'নাম নেই'} যোগ করুন`}
                  accessibilityState={{ checked: r.include, disabled: r.status === 'invalid' }}
                  onPress={() => setRows(toggleRow(rows, r.line))}
                  style={[styles.check, r.include && styles.checkOn]}
                >
                  {r.include && <Icon name="check" size={28} color={colors.onColor} strokeWidth={2.8} />}
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityHint="নাম ঠিক করুন" onPress={() => setEditing(r)} style={styles.flex}>
                  <Txt wrap size={fontSize.bodyLg} weight="bold">
                    {r.value.name || `(${r.raw})`}
                  </Txt>
                  {!!kind.details(r.value) && (
                    <Txt wrap size={fontSize.caption} weight="medium" color={colors.muted}>
                      {kind.details(r.value)}
                    </Txt>
                  )}
                  {r.match && (
                    <Txt wrap size={fontSize.caption} weight="semibold" color={colors.bakiInk}>
                      {HOW[r.match.how]}: {r.match.candidate.name} ({r.match.candidate.label})
                    </Txt>
                  )}
                  {r.problems.includes('bad_phone') && (
                    <Txt size={fontSize.caption} weight="semibold" color={colors.bakiInk}>
                      ফোন নম্বর ঠিক নেই
                    </Txt>
                  )}
                </Pressable>
                <Pressable accessibilityRole="button" onPress={() => speakRow(r)} style={[styles.status, { backgroundColor: STATUS[r.status].bg }]}>
                  <Txt size={fontSize.caption} weight="bold" color={STATUS[r.status].ink}>
                    {STATUS[r.status].label}
                  </Txt>
                </Pressable>
              </View>
            )}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !counts!.included }}
            disabled={!counts!.included}
            onPress={() => setConfirming(true)}
            style={({ pressed }) => [styles.bigButton, !counts!.included && styles.disabled, pressed && styles.pressed]}
          >
            <Icon name="check" size={30} color={colors.onColor} strokeWidth={2.6} />
            <Txt size={fontSize.listAmount} weight="bold" color={colors.onColor}>
              সব যোগ করুন ({formatNumber(counts!.included)} জন)
            </Txt>
          </Pressable>
        </>
      )}

      <EditSheet
        row={editing}
        onClose={() => setEditing(null)}
        onDone={(value) => {
          if (rows && editing) setRows(editRow(rows, editing.line, value, existing, kind.spec));
          setEditing(null);
        }}
      />
      <ConfirmSheet
        visible={confirming}
        text={importReadback(counts?.included ?? 0, kind.what)}
        busy={saving}
        onYes={() => void save()}
        onNo={() => setConfirming(false)}
      />
    </SafeAreaView>
  );
}

/** Fix a row: name and phone (the note stays). */
function EditSheet({ row, onClose, onDone }: { row: ImportRow<CustomerLine> | null; onClose: () => void; onDone: (v: CustomerLine) => void }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [bad, setBad] = useState(false);
  const [shownFor, setShownFor] = useState<number | null>(null);
  if (row && shownFor !== row.line) {
    setShownFor(row.line);
    setName(row.value.name);
    setPhone(row.value.phone ?? '');
    setBad(false);
  }
  if (!row && shownFor !== null) setShownFor(null);

  const done = () => {
    const p = phone.trim() ? parseBdPhone(phone) : null;
    if (phone.trim() && !p) {
      setBad(true);
      void speak('ফোন নম্বর ঠিক নেই।');
      return;
    }
    onDone({ name: name.trim(), phone: p, note: row?.value.note ?? null });
  };

  return (
    <Modal visible={!!row} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetBack}>
        <View style={styles.sheet}>
          <Txt size={fontSize.label} weight="bold">
            নাম ঠিক করুন
          </Txt>
          <TextInput value={name} onChangeText={setName} placeholder="নাম" accessibilityLabel="নাম" style={styles.input} autoFocus />
          <TextInput
            value={phone}
            onChangeText={(t) => {
              setPhone(t);
              setBad(false);
            }}
            placeholder="ফোন (না থাকলে খালি)"
            accessibilityLabel="ফোন"
            keyboardType="phone-pad"
            style={[styles.input, bad && styles.inputBad]}
          />
          <View style={styles.sheetButtons}>
            <Pressable accessibilityRole="button" onPress={onClose} style={styles.sheetNo}>
              <Txt size={fontSize.button} weight="bold">
                বাতিল
              </Txt>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={done} style={styles.sheetYes}>
              <Txt size={fontSize.button} weight="bold" color={colors.onColor}>
                ঠিক আছে
              </Txt>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: spacing.screen, paddingTop: spacing.screenTop, paddingBottom: spacing.lg, gap: spacing.md },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  back: { width: size.iconButton, height: size.iconButton, borderRadius: radius.icon, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  speaker: { width: size.iconButton, height: size.iconButton, borderRadius: radius.pill, backgroundColor: colors.dark, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  center: { textAlign: 'center' },
  pickBox: { flex: 1, justifyContent: 'center', gap: spacing.lg },
  bigButton: {
    minHeight: 84,
    borderRadius: radius.section,
    backgroundColor: colors.sale,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.4 },
  summary: { backgroundColor: colors.surface, borderRadius: radius.card, padding: spacing.md, gap: 2 },
  list: { gap: spacing.xs, paddingBottom: spacing.md },
  row: { backgroundColor: colors.surface, borderRadius: radius.card, padding: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowSkipped: { opacity: 0.6 },
  check: {
    width: size.iconButton,
    height: size.iconButton,
    borderRadius: radius.icon,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: colors.sale, borderColor: colors.sale },
  status: { minHeight: size.iconButton, borderRadius: radius.pill, paddingHorizontal: 12, justifyContent: 'center' },
  sheetBack: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.section, borderTopRightRadius: radius.section, padding: spacing.lg, gap: spacing.md },
  input: {
    minHeight: 56,
    borderRadius: radius.icon,
    borderWidth: 2,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 0,
    fontSize: fontSize.label,
    fontFamily: fonts.semibold,
    color: colors.ink,
  },
  inputBad: { borderColor: colors.baki },
  sheetButtons: { flexDirection: 'row', gap: spacing.sm },
  sheetNo: { flex: 1, minHeight: 64, borderRadius: radius.button, backgroundColor: colors.neutralTint, alignItems: 'center', justifyContent: 'center' },
  sheetYes: { flex: 1.6, minHeight: 64, borderRadius: radius.button, backgroundColor: colors.sale, alignItems: 'center', justifyContent: 'center' },
});
