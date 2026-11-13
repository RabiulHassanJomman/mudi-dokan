import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';

import { Icon } from '../components/Icon';
import { Txt } from '../components/Txt';
import { classifyAnswer } from '../domain/confirmWords';
import {
  canSave,
  diffDrafts,
  draftFromParse,
  readback,
  stepQuantity,
  withCredit,
  withCustomer,
  withPrice,
  type SaleDraft,
} from '../domain/saleDraft';
import { createVoiceLog, findProduct, getVoiceLog, knownNames, saveSale, setOutcome, setParsed } from '../db/repo';
import { getDevice, writer } from '../device';
import { UNIT_BN, formatNumber, formatQty, formatTaka, parseTakaInput } from '../lib/bn';
import { speak, stopSpeaking } from '../lib/speak';
import { parseCommand } from '../parser';
import type { Intent } from '../parser/types';
import { colors, fonts, fontSize, productTiles, radius, size, spacing } from '../theme/tokens';

type State =
  | { kind: 'loading' }
  | { kind: 'unsupported'; transcript: string; intent: Intent }
  | { kind: 'ready'; transcript: string };

const INTENT_BN: Record<Intent, string> = {
  sale: 'বিক্রি',
  purchase: 'মাল কেনা',
  baki: 'বাকি',
  joma: 'জমা',
  expense: 'খরচ',
  owner_withdrawal: 'মালিক নিল',
  stock_query: 'স্টক জানা',
  profit_query: 'লাভ জানা',
  unknown: 'বুঝিনি',
};

/** নিশ্চিত করুন: nothing is saved until হ্যাঁ (button or voice). */
export default function ConfirmScreen() {
  const db = useSQLiteContext();
  const params = useLocalSearchParams<{ logId?: string; text?: string; tab?: string }>();
  const tab = params.tab ?? 'sale';

  const [state, setState] = useState<State>({ kind: 'loading' });
  const [draft, setDraft] = useState<SaleDraft | null>(null);
  const [answering, setAnswering] = useState(false);
  const [saving, setSaving] = useState(false);

  const logId = useRef<string | null>(null);
  const first = useRef<SaleDraft | null>(null);
  const latest = useRef<SaleDraft | null>(null);
  const decided = useRef(false);
  latest.current = draft;

  // ── voice হ্যাঁ / না ───────────────────────────────────────────
  const listenForAnswer = useCallback(async () => {
    const perm = await ExpoSpeechRecognitionModule.getPermissionsAsync();
    if (!perm.granted || decided.current) return;
    setAnswering(true);
    ExpoSpeechRecognitionModule.start({ lang: 'bn-BD', interimResults: false, maxAlternatives: 3, continuous: false });
  }, []);

  const stopListening = useCallback(() => {
    setAnswering(false);
    ExpoSpeechRecognitionModule.abort();
  }, []);

  const sayAndListen = useCallback(
    async (d: SaleDraft) => {
      stopListening();
      await speak(readback(d));
      if (canSave(d) && !decided.current) void listenForAnswer();
    },
    [listenForAnswer, stopListening],
  );

  useSpeechRecognitionEvent('result', (e) => {
    if (!e.isFinal) return;
    const answers = e.results.map((r) => classifyAnswer(r.transcript));
    if (answers.includes('no')) void onNo();
    else if (answers.includes('yes')) void onYes();
  });
  useSpeechRecognitionEvent('end', () => setAnswering(false));

  // ── load: log row → parse → product → draft ────────────────────
  useEffect(() => {
    let alive = true;
    (async () => {
      const w = writer();
      const device = getDevice();
      let transcript = '';
      if (params.logId) {
        logId.current = params.logId;
        transcript = (await getVoiceLog(db, params.logId))?.transcript ?? '';
      } else {
        transcript = params.text ?? '';
        logId.current = await createVoiceLog(db, w, { transcript, source: 'typed', contextTab: tab });
      }
      const names = await knownNames(db);
      const parsed = parseCommand(transcript, {
        tab: tab === 'sale' ? 'sale' : undefined,
        knownProducts: names.products,
        knownCustomers: names.customers,
        deviceRole: device.role ?? undefined,
        deviceName: device.name,
      });
      await setParsed(db, w, logId.current, parsed);
      if (!alive) return;

      if (parsed.intent !== 'sale') {
        await setOutcome(db, w, logId.current, 'unsupported');
        decided.current = true;
        setState({ kind: 'unsupported', transcript, intent: parsed.intent });
        void speak('এখন শুধু বিক্রি রাখা যায়।');
        return;
      }
      const product = parsed.product ? await findProduct(db, parsed.product) : null;
      const d = draftFromParse(parsed, product);
      first.current = d;
      setDraft(d);
      setState({ kind: 'ready', transcript });
      void sayAndListen(d);
    })();
    return () => {
      alive = false;
    };
    // load once per screen
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // leaving without a decision counts as না
  useEffect(
    () => () => {
      stopSpeaking();
      ExpoSpeechRecognitionModule.abort();
      if (!decided.current && logId.current) void setOutcome(db, writer(), logId.current, 'cancelled');
    },
    [db],
  );

  // ── actions ────────────────────────────────────────────────────
  const leave = () => (router.canGoBack() ? router.back() : router.replace('/'));

  async function onYes() {
    const d = latest.current;
    if (!d || !logId.current || decided.current || saving) return;
    stopListening();
    if (!canSave(d)) {
      void speak(readback(d));
      return;
    }
    setSaving(true);
    decided.current = true;
    try {
      await saveSale(db, writer(), d, logId.current, first.current ? diffDrafts(first.current, d) : []);
      void speak('রাখা হয়েছে।');
      leave();
    } catch (e) {
      decided.current = false;
      setSaving(false);
      void speak('রাখা গেল না।');
      console.warn('saveSale failed', e);
    }
  }

  async function onNo() {
    if (decided.current || !logId.current) return;
    stopListening();
    decided.current = true;
    await setOutcome(db, writer(), logId.current, 'cancelled');
    void speak('বাতিল।');
    leave();
  }

  const edit = (next: SaleDraft) => {
    stopListening();
    setDraft(next);
  };

  const again = () => {
    decided.current = true;
    if (logId.current) void setOutcome(db, writer(), logId.current, 'cancelled');
    router.replace({ pathname: '/listening', params: { tab } });
  };

  // ── render ─────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.top}>
        <Pressable accessibilityRole="button" accessibilityLabel="ফিরে যান" onPress={() => void onNo()} style={styles.back}>
          <Icon name="back" size={26} color={colors.ink} strokeWidth={2.2} />
        </Pressable>
        {draft && (
          <Pressable
            accessibilityRole="button"
            onPress={() => void sayAndListen(draft)}
            style={({ pressed }) => [styles.listen, pressed && styles.pressed]}
          >
            <Icon name="speaker" size={26} color={colors.onColor} strokeWidth={2} />
            <Txt size={fontSize.body} weight="semibold" color={colors.onColor}>
              আবার শুনুন
            </Txt>
          </Pressable>
        )}
      </View>

      {state.kind === 'loading' && (
        <Txt size={fontSize.label} weight="bold" style={styles.center}>
          বুঝছি…
        </Txt>
      )}

      {state.kind === 'unsupported' && (
        <Unsupported transcript={state.transcript} intent={state.intent} onAgain={again} onClose={leave} />
      )}

      {state.kind === 'ready' && draft && (
        <>
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <Heard text={state.transcript} />
            {draft.problems.includes('no_product') ? (
              <View style={styles.card}>
                <Txt size={fontSize.headingLg} weight="bold" style={styles.center}>
                  মালের নাম বুঝিনি
                </Txt>
                <BigButton label="আবার বলুন" icon="mic" bg={colors.sale} ink={colors.onColor} onPress={again} />
              </View>
            ) : (
              <SaleCard draft={draft} onEdit={edit} />
            )}
          </ScrollView>

          {answering && (
            <Txt size={fontSize.body} weight="bold" color={colors.saleDark} style={styles.center}>
              বলুন: হ্যাঁ / না
            </Txt>
          )}
          <View style={styles.decide}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="না"
              onPress={() => void onNo()}
              style={({ pressed }) => [styles.no, pressed && styles.pressed]}
            >
              <Icon name="close" size={36} color={colors.ink} strokeWidth={2.6} />
              <Txt size={fontSize.button} weight="bold">
                না
              </Txt>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="হ্যাঁ"
              accessibilityState={{ disabled: !canSave(draft) || saving }}
              onPress={() => void onYes()}
              style={({ pressed }) => [
                styles.yes,
                (!canSave(draft) || saving) && styles.disabled,
                pressed && styles.pressed,
              ]}
            >
              <Icon name="check" size={40} color={colors.onColor} strokeWidth={2.8} />
              <Txt size={fontSize.button} weight="bold" color={colors.onColor}>
                {saving ? 'রাখছি…' : 'হ্যাঁ'}
              </Txt>
            </Pressable>
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

function Heard({ text }: { text: string }) {
  return (
    <Txt wrap size={fontSize.captionLg} weight="medium" color={colors.muted} style={styles.center}>
      শুনেছি: “{text}”
    </Txt>
  );
}

function SaleCard({ draft, onEdit }: { draft: SaleDraft; onEdit: (d: SaleDraft) => void }) {
  const [priceText, setPriceText] = useState('');
  const [customerText, setCustomerText] = useState(draft.customerName ?? '');
  // decided once: if the card opened without a price, the price field stays while typing
  const [askPrice] = useState(() => draft.problems.includes('no_price'));
  const tile = (draft.productName && productTiles[draft.productName]) || colors.neutralTint;

  return (
    <>
      <View style={styles.card}>
        <View style={[styles.productTile, { backgroundColor: tile }]}>
          <Icon name="box" size={64} color={colors.ink} strokeWidth={1.4} />
        </View>
        <View style={styles.nameRow}>
          <Txt size={fontSize.amount} weight="bold">
            {draft.productName}
          </Txt>
          {!draft.product && (
            <View style={styles.newBadge}>
              <Txt size={fontSize.caption} weight="bold" color={colors.stock}>
                নতুন মাল
              </Txt>
            </View>
          )}
        </View>

        <View style={styles.stepper}>
          <StepButton icon="minus" label="কমান" onPress={() => onEdit(stepQuantity(draft, -1))} />
          <Txt size={fontSize.amountLg} weight="bold" style={styles.qty}>
            {draft.quantity ? formatQty(draft.quantity, draft.unit) : `? ${UNIT_BN[draft.unit]}`}
          </Txt>
          <StepButton icon="plus" label="বাড়ান" onPress={() => onEdit(stepQuantity(draft, 1))} />
        </View>

        {askPrice && (
          <View style={styles.inputRow}>
            <Txt size={fontSize.label} weight="bold">
              প্রতি {UNIT_BN[draft.unit]} দাম ৳
            </Txt>
            <TextInput
              value={priceText}
              onChangeText={(t) => {
                setPriceText(t);
                const v = parseTakaInput(t);
                if (v) onEdit(withPrice(draft, v));
              }}
              keyboardType="numeric"
              accessibilityLabel={`প্রতি ${UNIT_BN[draft.unit]} দাম`}
              placeholder="০"
              placeholderTextColor={colors.muted}
              style={[styles.input, styles.priceInput]}
            />
          </View>
        )}
        {draft.amountPoisha !== null && draft.pricePoisha !== null && (
          <Txt size={fontSize.hero} weight="bold" color={colors.sale}>
            {formatTaka(draft.amountPoisha)}
          </Txt>
        )}
        {draft.pricePoisha !== null && draft.quantity !== null && draft.quantity !== 1 && (
          <Txt size={fontSize.captionLg} weight="medium" color={colors.muted}>
            প্রতি {UNIT_BN[draft.unit]} {formatNumber(draft.pricePoisha / 100)} টাকা
          </Txt>
        )}
        {draft.problems.includes('unit_mismatch') && (
          <Txt wrap size={fontSize.body} weight="bold" color={colors.bakiInk} style={styles.center}>
            {draft.productName} {UNIT_BN[draft.unit]}-এ বিক্রি হয়। পরিমাণ ঠিক করুন।
          </Txt>
        )}
      </View>

      <View accessibilityRole="radiogroup" accessibilityLabel="নগদ না বাকি" style={styles.toggleRow}>
        <Toggle
          label="নগদ"
          icon="cash"
          active={!draft.credit}
          activeBorder={colors.sale}
          activeBg={colors.saleTint}
          ink={colors.saleDark}
          onPress={() => onEdit(withCredit(draft, false))}
        />
        <Toggle
          label="বাকি"
          icon="book"
          active={draft.credit}
          activeBorder={colors.baki}
          activeBg={colors.bakiTint}
          ink={colors.bakiInk}
          onPress={() => onEdit(withCredit(draft, true))}
        />
      </View>

      {draft.credit && (
        <View style={styles.inputRow}>
          <Txt size={fontSize.label} weight="bold" color={colors.bakiInk}>
            কার বাকি?
          </Txt>
          <TextInput
            value={customerText}
            onChangeText={(t) => {
              setCustomerText(t);
              onEdit(withCustomer(draft, t));
            }}
            accessibilityLabel="ক্রেতার নাম"
            placeholder="নাম"
            placeholderTextColor={colors.muted}
            style={[styles.input, styles.flex]}
          />
        </View>
      )}
    </>
  );
}

function StepButton({ icon, label, onPress }: { icon: 'plus' | 'minus'; label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.step, pressed && styles.pressed]}
    >
      <Icon name={icon} size={30} color={colors.ink} strokeWidth={2.6} />
    </Pressable>
  );
}

function Toggle(props: {
  label: string;
  icon: 'cash' | 'book';
  active: boolean;
  activeBorder: string;
  activeBg: string;
  ink: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: props.active }}
      onPress={props.onPress}
      style={[
        styles.toggle,
        props.active
          ? { borderColor: props.activeBorder, backgroundColor: props.activeBg }
          : { borderColor: colors.divider, backgroundColor: colors.surface },
      ]}
    >
      <Icon name={props.icon} size={36} color={props.ink} />
      <Txt size={21} weight="bold" color={props.ink}>
        {props.label}
      </Txt>
    </Pressable>
  );
}

function BigButton(props: { label: string; icon: 'mic' | 'close'; bg: string; ink: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={props.onPress}
      style={({ pressed }) => [styles.bigButton, { backgroundColor: props.bg }, pressed && styles.pressed]}
    >
      <Icon name={props.icon} size={30} color={props.ink} />
      <Txt size={fontSize.button} weight="bold" color={props.ink}>
        {props.label}
      </Txt>
    </Pressable>
  );
}

function Unsupported(props: { transcript: string; intent: Intent; onAgain: () => void; onClose: () => void }) {
  return (
    <View style={styles.body}>
      <Heard text={props.transcript} />
      <View style={styles.card}>
        <Txt wrap size={fontSize.headingLg} weight="bold" style={styles.center}>
          এখন শুধু বিক্রি রাখা যায়
        </Txt>
        <Txt wrap size={fontSize.body} weight="medium" color={colors.muted} style={styles.center}>
          এটা মনে হলো: {INTENT_BN[props.intent]}। এই কাজ পরের ধাপে আসবে।
        </Txt>
      </View>
      <BigButton label="আবার বলুন" icon="mic" bg={colors.sale} ink={colors.onColor} onPress={props.onAgain} />
      <BigButton label="বন্ধ" icon="close" bg={colors.surface} ink={colors.ink} onPress={props.onClose} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, padding: spacing.screen, paddingBottom: 18, gap: spacing.lg },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  back: {
    width: size.iconButton,
    height: size.iconButton,
    borderRadius: radius.icon,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listen: {
    height: size.iconButton,
    paddingHorizontal: 16,
    borderRadius: radius.pill,
    backgroundColor: colors.dark,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  body: { gap: spacing.lg, paddingBottom: spacing.md },
  center: { textAlign: 'center' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.hero,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.screen,
    alignItems: 'center',
    gap: spacing.md,
  },
  productTile: {
    width: 112,
    height: 112,
    borderRadius: radius.productHero,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  newBadge: { backgroundColor: colors.stockTint, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 2 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  step: {
    width: size.stepper,
    height: size.stepper,
    borderRadius: radius.card,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qty: { minWidth: 120, textAlign: 'center' },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  input: {
    height: size.iconButton,
    // Android's default input padding clips tall Bangla vowel signs (ি looks like া)
    paddingVertical: 0,
    textAlignVertical: 'center',
    includeFontPadding: true,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: radius.icon,
    paddingHorizontal: spacing.lg,
    fontFamily: fonts.bold,
    fontSize: fontSize.listAmount,
    color: colors.ink,
    backgroundColor: colors.surface,
  },
  priceInput: { width: 120, textAlign: 'center' },
  flex: { flex: 1 },
  toggleRow: { flexDirection: 'row', gap: spacing.sm },
  toggle: {
    flex: 1,
    height: 92,
    borderRadius: radius.button,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  decide: { flexDirection: 'row', gap: spacing.md },
  no: {
    flex: 1,
    height: size.bigActionLg,
    borderRadius: radius.section,
    borderWidth: 3,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  yes: {
    flex: 1.6,
    height: size.bigActionLg,
    borderRadius: radius.section,
    backgroundColor: colors.sale,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  bigButton: {
    height: 72,
    borderRadius: radius.button,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    alignSelf: 'stretch',
  },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.85 },
});
