// 画面の主な操作のボタン（アクセントの塗り）。押せない・進行中のあいだは、押しても何も起きない。
// ログイン画面のボタン（各社の指定がある）とは別。
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';

import { useColors } from './useColors.ts';

interface PrimaryButtonProps {
  label: string;
  onPress(): void;
  /** 進行中。ラベルの代わりにインジケーターを出し、押せなくする */
  busy?: boolean;
  disabled?: boolean;
  /** 塗らない、控えめな見た目（取り消せない操作の隣など）。`destructive` は、取り消せない削除（エラーの色の枠と文字） */
  variant?: 'primary' | 'secondary' | 'destructive';
  /** 小さい見た目（カードの中の操作など）。高さは、押しやすさのために44以上を保つ */
  compact?: boolean;
}

export function PrimaryButton({ label, onPress, busy = false, disabled = false, variant = 'primary', compact = false }: PrimaryButtonProps) {
  const colors = useColors();
  const inactive = disabled || busy;
  const primary = variant === 'primary';
  const textColor = primary ? colors.onAccent : variant === 'destructive' ? colors.error : colors.textPrimary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inactive, busy }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        compact && styles.compact,
        primary
          ? { backgroundColor: colors.accent, borderColor: colors.accent }
          : { backgroundColor: colors.surface, borderColor: variant === 'destructive' ? colors.error : colors.border },
        disabled && !busy && styles.dimmed,
        pressed && styles.pressed,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={textColor} />
      ) : (
        <Text style={[styles.label, compact && styles.labelCompact, { color: textColor }]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    height: 50,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compact: { height: 44, borderRadius: 10 },
  label: { fontSize: 17, fontWeight: '600' },
  labelCompact: { fontSize: 15 },
  dimmed: { opacity: 0.5 },
  pressed: { opacity: 0.8 },
});
