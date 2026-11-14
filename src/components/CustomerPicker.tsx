import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { customerStatus, suggestCustomers } from '../domain/customers';
import { colors, fonts, fontSize, radius, spacing } from '../theme/tokens';
import { Icon } from './Icon';
import { Txt } from './Txt';

interface Props {
  /** "কার বাকি?", "কার জমা?" */
  label: string;
  name: string | null;
  /** In the list, or confirmed as new. */
  ok: boolean;
  /** Known customer names, most owed first. */
  known: readonly string[];
  onChange: (name: string, ok: boolean) => void;
}

/**
 * Who: a name box; a name we don't know shows the closest known names and
 * "নতুন ক্রেতা" — nothing on credit is saved for a name nobody confirmed.
 */
export function CustomerPicker({ label, name, ok, known, onChange }: Props) {
  const [text, setText] = useState(name ?? '');
  useEffect(() => setText(name ?? ''), [name]);
  const status = customerStatus(text, known);
  const suggestions = status === 'unknown' ? suggestCustomers(text, known, 3) : [];
  const choose = (n: string) => {
    setText(n);
    onChange(n, true);
  };

  return (
    <View style={styles.box}>
      <View style={styles.row}>
        <Txt size={fontSize.label} weight="bold" color={colors.bakiInk}>
          {label}
        </Txt>
        <TextInput
          value={text}
          onChangeText={(t) => {
            setText(t);
            onChange(t, customerStatus(t, known) === 'known');
          }}
          accessibilityLabel="ক্রেতার নাম"
          placeholder="নাম"
          placeholderTextColor={colors.muted}
          style={[styles.input, status === 'unknown' && !ok && styles.inputWarn]}
        />
        {status === 'known' && <Icon name="check" size={28} color={colors.sale} strokeWidth={2.8} />}
      </View>

      {status === 'missing' && known.length > 0 && (
        <View style={styles.chips}>
          {known.slice(0, 6).map((k) => (
            <Chip key={k} label={k} onPress={() => choose(k)} />
          ))}
        </View>
      )}

      {status === 'unknown' && !ok && (
        <View style={styles.warn}>
          <Txt wrap size={fontSize.body} weight="bold" color={colors.bakiInk}>
            “{text.trim()}” নামে কাউকে চিনি না। কে?
          </Txt>
          <View style={styles.chips}>
            {suggestions.map((k) => (
              <Chip key={k} label={k} onPress={() => choose(k)} />
            ))}
            <Pressable accessibilityRole="button" onPress={() => onChange(text, true)} style={[styles.chip, styles.chipNew]}>
              <Icon name="plus" size={20} color={colors.stock} strokeWidth={2.4} />
              <Txt size={fontSize.body} weight="bold" color={colors.stock}>
                নতুন ক্রেতা: {text.trim()}
              </Txt>
            </Pressable>
          </View>
        </View>
      )}
      {status === 'unknown' && ok && (
        <Txt size={fontSize.captionLg} weight="bold" color={colors.stock}>
          নতুন ক্রেতা — রাখলে তালিকায় যোগ হবে
        </Txt>
      )}
    </View>
  );
}

function Chip({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.chip, pressed && { opacity: 0.85 }]}>
      <Txt size={fontSize.body} weight="bold" color={colors.ink}>
        {label}
      </Txt>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: { gap: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  input: {
    flex: 1,
    height: 56,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: radius.icon,
    paddingHorizontal: spacing.lg,
    paddingVertical: 0,
    backgroundColor: colors.surface,
    fontFamily: fonts.bold,
    fontSize: fontSize.label,
    color: colors.ink,
  },
  inputWarn: { borderColor: colors.baki },
  warn: { backgroundColor: colors.bakiTint, borderRadius: radius.card, padding: spacing.md, gap: spacing.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    minHeight: 52,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
  },
  chipNew: { borderColor: colors.stock, backgroundColor: colors.stockTint },
});
