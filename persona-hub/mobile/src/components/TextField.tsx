import { forwardRef } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { Text, useTheme } from '../theme';

export interface TextFieldProps extends TextInputProps {
  label: string;
  helper?: string;
  /** Shown in red under the field; also sets accessibility error state. */
  error?: string | null;
  showCount?: boolean;
}

export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { label, helper, error, showCount, maxLength, value, multiline, style, ...rest },
  ref,
) {
  const t = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text variant="label" tone="secondary">
        {label}
      </Text>
      <TextInput
        ref={ref}
        accessibilityLabel={label}
        accessibilityHint={error ?? helper}
        value={value}
        maxLength={maxLength}
        multiline={multiline}
        placeholderTextColor={t.color.text.secondary}
        allowFontScaling
        style={[
          t.type.body,
          styles.input,
          {
            color: t.color.text.primary,
            backgroundColor: t.color.bg.surface,
            borderColor: error ? t.color.danger : t.color.border,
            borderRadius: t.radius.button,
            minHeight: multiline ? 120 : t.layout.minTouch,
            textAlignVertical: multiline ? 'top' : 'center',
          },
          style,
        ]}
        {...rest}
      />
      <View style={styles.footer}>
        <View style={{ flex: 1 }}>
          {error ? (
            <Text variant="caption" tone="danger" accessibilityLiveRegion="polite" accessibilityRole="alert">
              {error}
            </Text>
          ) : helper ? (
            <Text variant="caption" tone="secondary">
              {helper}
            </Text>
          ) : null}
        </View>
        {showCount && maxLength ? (
          <Text variant="caption" tone="secondary">
            {(value ?? '').length}/{maxLength}
          </Text>
        ) : null}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  input: { borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12 },
  footer: { flexDirection: 'row', gap: 8 },
});
