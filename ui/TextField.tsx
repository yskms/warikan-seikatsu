// ラベルと、失敗の文言つきの1行入力。エラーは入力欄の下に出す（直す場所を示す。ボタンの上に出す規則は、押下で
// 押し上げられる文言のこと。docs/screens.md 2章）。
import type { Ref } from 'react';
import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

import { useColors } from './useColors.ts';

interface TextFieldProps
  extends Pick<
    TextInputProps,
    'value' | 'onChangeText' | 'placeholder' | 'maxLength' | 'autoFocus' | 'returnKeyType' | 'onSubmitEditing' | 'submitBehavior'
  > {
  label: string;
  error?: string;
  editable?: boolean;
  /** 次の欄へフォーカスを移すときなど、入力欄を直接操作するための ref */
  inputRef?: Ref<TextInput>;
}

export function TextField({ label, error, editable = true, inputRef, ...input }: TextFieldProps) {
  const colors = useColors();
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>
      <TextInput
        {...input}
        ref={inputRef}
        accessibilityLabel={label}
        editable={editable}
        autoCorrect={false}
        placeholderTextColor={colors.textSecondary}
        style={[
          styles.input,
          {
            color: colors.textPrimary,
            backgroundColor: colors.surface,
            borderColor: error ? colors.error : colors.border,
          },
          !editable && styles.dimmed,
        ]}
      />
      {error ? (
        <Text style={[styles.error, { color: colors.error }]} accessibilityRole="alert" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 6 },
  label: { fontSize: 14, fontWeight: '600' },
  input: {
    height: 50,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    fontSize: 17,
  },
  error: { fontSize: 13, lineHeight: 18 },
  dimmed: { opacity: 0.5 },
});
