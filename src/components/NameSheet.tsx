import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { speak, stopSpeaking } from '../lib/speak';
import { useVoiceOnce } from '../lib/useVoiceOnce';
import { colors, fonts, fontSize, radius, size, spacing } from '../theme/tokens';
import { Icon } from './Icon';
import { Txt } from './Txt';

interface Props {
  visible: boolean;
  /** "মালের নাম" */
  title: string;
  initial: string;
  /** Known names closest to what is typed (best first). */
  suggest: (text: string) => string[];
  onDone: (name: string) => void;
  onClose: () => void;
}

/**
 * A name typed or said (🎤), not only picked from chips: the confirm card's product name
 * (a new product, or a known one by another spelling). Closest known names as chips.
 */
export function NameSheet({ visible, title, initial, suggest, onDone, onClose }: Props) {
  const [text, setText] = useState(initial);
  const voice = useVoiceOnce();
  useEffect(() => {
    if (visible) setText(initial);
  }, [visible, initial]);
  useEffect(() => {
    if (!visible) voice.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const say = async () => {
    stopSpeaking();
    const heard = await voice.listen();
    if (heard?.[0]) setText(heard[0]);
    else void speak('শুনতে পাইনি। আবার বলুন বা লিখুন।');
  };
  const chips = text.trim() ? suggest(text).filter((n) => n !== text.trim()).slice(0, 4) : [];
  const done = (n: string) => {
    voice.stop();
    if (n.trim()) onDone(n.trim());
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.top}>
            <Txt size={fontSize.label} weight="bold" style={styles.flex}>
              {title}
            </Txt>
            <Pressable accessibilityRole="button" accessibilityLabel="বন্ধ" onPress={onClose} style={styles.close}>
              <Icon name="close" size={26} color={colors.ink} strokeWidth={2.4} />
            </Pressable>
          </View>
          <View style={styles.row}>
            <TextInput
              value={text}
              onChangeText={setText}
              onSubmitEditing={() => done(text)}
              returnKeyType="done"
              autoFocus={false}
              accessibilityLabel={title}
              placeholder="নাম লিখুন"
              placeholderTextColor={colors.muted}
              style={styles.input}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="নাম বলুন"
              onPress={() => (voice.listening ? voice.stop() : void say())}
              style={[styles.mic, voice.listening && styles.micOn]}
            >
              <Icon name="mic" size={28} color={colors.onColor} />
            </Pressable>
          </View>
          {voice.listening && (
            <Txt size={fontSize.body} weight="bold" color={colors.saleDark}>
              শুনছি… নাম বলুন
            </Txt>
          )}
          {chips.length > 0 && (
            <View style={styles.chips}>
              {chips.map((n) => (
                <Pressable key={n} accessibilityRole="button" onPress={() => done(n)} style={({ pressed }) => [styles.chip, pressed && styles.pressed]}>
                  <Txt size={fontSize.body} weight="bold">
                    {n}
                  </Txt>
                </Pressable>
              ))}
            </View>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !text.trim() }}
            onPress={() => done(text)}
            style={({ pressed }) => [styles.ok, !text.trim() && styles.off, pressed && styles.pressed]}
          >
            <Icon name="check" size={30} color={colors.onColor} strokeWidth={2.6} />
            <Txt size={fontSize.button} weight="bold" color={colors.onColor}>
              {text.trim() ? `“${text.trim()}” রাখুন` : 'ঠিক আছে'}
            </Txt>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.hero,
    borderTopRightRadius: radius.hero,
    padding: spacing.screen,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
  close: {
    width: size.iconButton,
    height: size.iconButton,
    borderRadius: radius.icon,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  input: {
    flex: 1,
    height: 60,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: radius.icon,
    paddingHorizontal: spacing.lg,
    paddingVertical: 0,
    backgroundColor: colors.surface,
    fontFamily: fonts.bold,
    fontSize: fontSize.button,
    color: colors.ink,
  },
  mic: {
    width: 60,
    height: 60,
    borderRadius: radius.pill,
    backgroundColor: colors.sale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micOn: { backgroundColor: colors.saleDark, borderWidth: 4, borderColor: colors.micRing },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    minHeight: 52,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.stock,
    backgroundColor: colors.surface,
    justifyContent: 'center',
  },
  ok: {
    height: 72,
    borderRadius: radius.button,
    backgroundColor: colors.sale,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  off: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
});
