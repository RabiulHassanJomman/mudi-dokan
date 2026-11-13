import { useEffect, useRef } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { classifyAnswer } from '../domain/confirmWords';
import { speak, stopSpeaking } from '../lib/speak';
import { useVoiceOnce } from '../lib/useVoiceOnce';
import { colors, fontSize, radius, size, spacing } from '../theme/tokens';
import { Icon } from './Icon';
import { Txt } from './Txt';

interface Props {
  visible: boolean;
  /** Read aloud when it opens; ends with "ঠিক আছে?". */
  text: string;
  onYes: () => void;
  onNo: () => void;
  busy?: boolean;
}

/**
 * "ঠিক আছে?" before a save that is not a sale (Setup, later খরচ/জমা…): reads the text
 * aloud, then listens for হ্যাঁ / না; big না (✕) and হ্যাঁ (✓, wider) buttons as on the confirm card.
 */
export function ConfirmSheet({ visible, text, onYes, onNo, busy }: Props) {
  const voice = useVoiceOnce();
  const decided = useRef(false);
  const handlers = useRef({ onYes, onNo });
  handlers.current = { onYes, onNo };

  useEffect(() => {
    if (!visible) return;
    decided.current = false;
    let alive = true;
    void (async () => {
      await speak(text);
      if (!alive || decided.current) return;
      const heard = await voice.listen();
      if (!alive || decided.current || !heard) return;
      const a = heard.map(classifyAnswer);
      if (a.includes('no')) answer(false);
      else if (a.includes('yes')) answer(true);
    })();
    return () => {
      alive = false;
      stopSpeaking();
      voice.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, text]);

  function answer(yes: boolean) {
    if (decided.current) return;
    decided.current = true;
    stopSpeaking();
    voice.stop();
    if (yes) handlers.current.onYes();
    else handlers.current.onNo();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => answer(false)}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Txt wrap size={fontSize.label} weight="bold" style={styles.center}>
            {text}
          </Txt>
          {voice.listening && (
            <View style={styles.hearing}>
              <Icon name="mic" size={22} color={colors.sale} />
              <Txt size={fontSize.captionLg} weight="semibold" color={colors.sale}>
                “হ্যাঁ” বা “না” বলুন
              </Txt>
            </View>
          )}
          <View style={styles.row}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="না"
              disabled={busy}
              onPress={() => answer(false)}
              style={({ pressed }) => [styles.btn, styles.no, pressed && styles.pressed]}
            >
              <Icon name="close" size={30} color={colors.bakiInk} strokeWidth={2.6} />
              <Txt size={fontSize.button} weight="bold" color={colors.bakiInk}>
                না
              </Txt>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="হ্যাঁ"
              disabled={busy}
              onPress={() => answer(true)}
              style={({ pressed }) => [styles.btn, styles.yes, pressed && styles.pressed, busy && styles.busy]}
            >
              <Icon name="check" size={32} color={colors.onColor} strokeWidth={2.6} />
              <Txt size={fontSize.button} weight="bold" color={colors.onColor}>
                হ্যাঁ
              </Txt>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(24,32,28,0.55)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.hero,
    borderTopRightRadius: radius.hero,
    padding: spacing.screen,
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
  },
  center: { textAlign: 'center' },
  hearing: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
  row: { flexDirection: 'row', gap: spacing.sm },
  btn: {
    height: size.bigAction,
    borderRadius: radius.button,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  no: { flex: 1, backgroundColor: colors.bakiTint, borderWidth: 3, borderColor: colors.bakiBorder },
  yes: { flex: 1.6, backgroundColor: colors.sale },
  pressed: { opacity: 0.85 },
  busy: { opacity: 0.6 },
});
