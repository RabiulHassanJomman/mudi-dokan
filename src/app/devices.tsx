import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { ConfirmSheet } from '../components/ConfirmSheet';
import { Icon } from '../components/Icon';
import { Txt } from '../components/Txt';
import { addDeviceEvent, deviceEvents, deviceRows } from '../db/devices';
import { getDevice, writer } from '../device';
import {
  STATE_BN,
  actionDone,
  actionQuestion,
  adminIds,
  canClaimAdmin,
  canLogOut,
  canRemoveAdmin,
  deviceCards,
  devicesReadout,
  seenWords,
  type DeviceAction,
  type DeviceCard,
  type DeviceRow,
} from '../domain/devices';
import { nav } from '../lib/nav';
import { speak, stopSpeaking } from '../lib/speak';
import { useDataVersion, useSyncStatus } from '../sync/app';
import { colors, fontSize, radius, size, spacing } from '../theme/tokens';

const DANGER_INK = '#B3261E';
const DANGER_TINT = '#FBE9E7';

interface Ask {
  action: DeviceAction | 'claim';
  card: DeviceCard | null;
}

/**
 * ⚙ › ফোনগুলো: every phone that uses the shop (name, model, signed in or out, last seen).
 * অ্যাডমিন can make another phone admin, remove an admin (not the last one) and log a phone
 * out; nobody is admin until one phone says "আমি অ্যাডমিন হব". Every action asks first.
 */
export default function DevicesScreen() {
  const db = useSQLiteContext();
  const version = useDataVersion();
  const status = useSyncStatus();
  const meId = getDevice().id;
  const [cards, setCards] = useState<DeviceCard[]>([]);
  const [rows, setRows] = useState<DeviceRow[]>([]);
  const [admins, setAdmins] = useState<Set<string>>(new Set());
  const [ask, setAsk] = useState<Ask | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await deviceRows(db);
    const e = await deviceEvents(db);
    setRows(r);
    setAdmins(adminIds(e));
    setCards(deviceCards(r, e, meId));
  }, [db, meId]);

  useFocusEffect(
    useCallback(() => {
      void load();
      return () => stopSpeaking();
    }, [load, version]),
  );

  const meAdmin = admins.has(meId);
  const claimable = canClaimAdmin(admins);
  const signedIn = !!status?.email;

  const open = (action: Ask['action'], card: DeviceCard | null) => {
    // the sheet reads the question aloud and listens for হ্যাঁ / না
    setAsk({ action, card });
  };

  const doIt = async () => {
    if (!ask) return;
    setBusy(true);
    try {
      // the state may have changed by sync while the sheet was up: check again
      const now = adminIds(await deviceEvents(db));
      const target = ask.card?.id ?? meId;
      const w = writer();
      if (ask.action === 'claim') {
        if (!canClaimAdmin(now)) throw new Error('someone is admin already');
        await addDeviceEvent(db, w, { target: meId, action: 'admin_on' });
      } else {
        if (!now.has(meId)) throw new Error('not admin');
        if (ask.action === 'admin_off' && !canRemoveAdmin(now, target)) throw new Error('last admin');
        const session = ask.action === 'logout' ? (rows.find((r) => r.id === target)?.session_id ?? null) : null;
        if (ask.action === 'logout' && !session) throw new Error('no session');
        await addDeviceEvent(db, w, { target, action: ask.action, targetSession: session });
      }
      void speak(actionDone(ask.action, ask.card?.name ?? ''));
      setAsk(null);
      await load();
    } catch (e) {
      console.warn('device action failed', e);
      void speak('করা গেল না। আবার দেখুন।');
      setAsk(null);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const readScreen = () => {
    void speak(devicesReadout(cards, meAdmin, claimable) + (signedIn ? '' : ' এই ফোন Google অ্যাকাউন্টে ঢোকা নেই, তাই অন্য ফোনের খবর আসবে না।'));
  };

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="ফিরে যান" onPress={() => nav.back()} style={styles.back}>
          <Icon name="back" size={26} color={colors.ink} strokeWidth={2.2} />
        </Pressable>
        <Txt accessibilityRole="header" size={fontSize.headingLg} weight="bold" style={styles.flex}>
          ফোনগুলো
        </Txt>
        <Pressable accessibilityRole="button" accessibilityLabel="শুনুন" onPress={readScreen} style={styles.listen}>
          <Icon name="speaker" size={26} color={colors.onColor} strokeWidth={2} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {!signedIn && (
          <View style={[styles.note, { backgroundColor: colors.bakiTint }]}>
            <Txt wrap size={fontSize.body} weight="semibold" color={colors.bakiInk}>
              এই ফোন Google অ্যাকাউন্টে ঢোকা নেই: অন্য ফোনের খবর আসবে না, এখানে যা করবেন তা-ও যাবে না।
            </Txt>
          </View>
        )}

        {claimable ? (
          <View style={styles.claimBox}>
            <Txt wrap size={fontSize.body} weight="semibold" color={colors.ink2}>
              এখনো কেউ অ্যাডমিন নয়। অ্যাডমিন সব ফোন দেখে, অন্যকে অ্যাডমিন বানায় আর লগ আউট করায়।
            </Txt>
            <Pressable accessibilityRole="button" onPress={() => open('claim', null)} style={({ pressed }) => [styles.claim, pressed && styles.pressed]}>
              <Icon name="person" size={28} color={colors.onColor} />
              <Txt size={fontSize.label} weight="bold" color={colors.onColor}>
                আমি অ্যাডমিন হব
              </Txt>
            </Pressable>
          </View>
        ) : (
          <Txt wrap size={fontSize.captionLg} weight="semibold" color={colors.muted} style={styles.hint}>
            {meAdmin ? 'আপনি অ্যাডমিন: নিচের বোতাম দিয়ে অ্যাডমিন বানান, সরান বা লগ আউট করান।' : 'শুধু অ্যাডমিন বদলাতে পারেন।'}
          </Txt>
        )}

        {cards.map((c) => (
          <PhoneCard key={c.id} card={c} meAdmin={meAdmin} canDropAdmin={canRemoveAdmin(admins, c.id)} onAction={(a) => open(a, c)} />
        ))}
      </ScrollView>

      <ConfirmSheet
        visible={ask !== null}
        busy={busy}
        text={ask ? actionQuestion(ask.action, ask.card?.name ?? '') : ''}
        onYes={() => void doIt()}
        onNo={() => setAsk(null)}
      />
    </SafeAreaView>
  );
}

function PhoneCard({ card: c, meAdmin, canDropAdmin, onAction }: { card: DeviceCard; meAdmin: boolean; canDropAdmin: boolean; onAction: (a: DeviceAction) => void }) {
  const stateColor = c.state === 'in' ? colors.saleDark : c.state === 'leaving' ? colors.bakiInk : colors.muted;
  const showAdminOn = meAdmin && !c.isAdmin && c.state !== 'unknown';
  const showAdminOff = meAdmin && c.isAdmin && canDropAdmin;
  const showLogout = meAdmin && canLogOut(c);
  return (
    <View style={[styles.card, c.isMe && styles.cardMe]}>
      <View style={styles.cardHead}>
        <View style={[styles.badge, { backgroundColor: c.state === 'in' ? colors.saleTint : colors.neutralTint }]}>
          <Icon name="phone" size={28} color={c.state === 'in' ? colors.sale : colors.muted} />
        </View>
        <View style={styles.flex}>
          <Txt wrap size={fontSize.label} weight="bold">
            {c.name}
          </Txt>
          <Txt wrap size={fontSize.captionLg} weight="medium" color={colors.muted}>
            {[c.model, `শেষ দেখা ${seenWords(c.seenAt, Date.now())}`].filter(Boolean).join(' · ')}
          </Txt>
        </View>
      </View>
      <View style={styles.tags}>
        {c.isMe && <Tag text="এই ফোন" ink={colors.stock} tint={colors.stockTint} />}
        {c.isAdmin && <Tag text="অ্যাডমিন" ink={colors.onColor} tint={colors.sale} />}
        <Txt wrap size={fontSize.body} weight="bold" color={stateColor} style={styles.flex}>
          {STATE_BN[c.state]}
        </Txt>
      </View>
      {(showAdminOn || showAdminOff || showLogout) && (
        <View style={styles.actions}>
          {showAdminOn && <ActionButton text="অ্যাডমিন বানান" ink={colors.saleDark} tint={colors.saleTint} onPress={() => onAction('admin_on')} />}
          {showAdminOff && <ActionButton text={c.isMe ? 'অ্যাডমিন ছাড়ুন' : 'অ্যাডমিন সরান'} ink={colors.bakiInk} tint={colors.bakiTint} onPress={() => onAction('admin_off')} />}
          {showLogout && <ActionButton text="লগ আউট করুন" ink={DANGER_INK} tint={DANGER_TINT} onPress={() => onAction('logout')} />}
        </View>
      )}
    </View>
  );
}

function Tag({ text, ink, tint }: { text: string; ink: string; tint: string }) {
  return (
    <View style={[styles.tag, { backgroundColor: tint }]}>
      <Txt size={fontSize.caption} weight="bold" color={ink}>
        {text}
      </Txt>
    </View>
  );
}

function ActionButton({ text, ink, tint, onPress }: { text: string; ink: string; tint: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.action, { backgroundColor: tint }, pressed && styles.pressed]}>
      <Txt size={fontSize.body} weight="bold" color={ink}>
        {text}
      </Txt>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: spacing.screen, gap: spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingTop: spacing.xl },
  flex: { flex: 1 },
  back: { width: size.iconButton, height: size.iconButton, borderRadius: radius.icon, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  listen: { width: size.iconButton, height: size.iconButton, borderRadius: radius.pill, backgroundColor: colors.dark, alignItems: 'center', justifyContent: 'center' },
  body: { gap: spacing.md, paddingBottom: spacing.xl },
  note: { borderRadius: radius.card, padding: spacing.lg },
  hint: { paddingHorizontal: spacing.xs },
  claimBox: { backgroundColor: colors.surface, borderRadius: radius.card, padding: spacing.lg, gap: spacing.md },
  claim: { minHeight: 64, borderRadius: radius.card, backgroundColor: colors.sale, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  card: { backgroundColor: colors.surface, borderRadius: radius.card, padding: spacing.lg, gap: spacing.sm, borderWidth: 3, borderColor: colors.surface },
  cardMe: { borderColor: colors.stockTint },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  badge: { width: 52, height: 52, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  tags: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexWrap: 'wrap' },
  tag: { borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xxs },
  actions: { flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' },
  action: { flexGrow: 1, flexBasis: '45%', minHeight: 56, borderRadius: radius.icon, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.sm },
  pressed: { opacity: 0.85 },
});
