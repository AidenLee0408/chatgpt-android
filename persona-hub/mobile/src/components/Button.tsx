import { Feather } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, View, type PressableProps } from 'react-native';
import type { IconName } from '../copy/labels';
import { Text, useTheme } from '../theme';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

export interface ButtonProps extends Omit<PressableProps, 'children' | 'style'> {
  /** Say the result ("연결 끊기", "페르소나 허용") — never "확인". */
  label: string;
  variant?: ButtonVariant;
  loading?: boolean;
  icon?: IconName;
  fullWidth?: boolean;
}

export function Button({ label, variant = 'primary', loading, disabled, icon, fullWidth = true, accessibilityLabel, ...rest }: ButtonProps) {
  const t = useTheme();
  const inactive = disabled || loading;
  const palette = {
    primary: { bg: t.color.brand.primary, fg: t.color.brand.onPrimary, border: 'transparent' },
    secondary: { bg: t.color.bg.surface, fg: t.color.text.primary, border: t.color.border },
    danger: { bg: t.color.danger, fg: t.scheme === 'dark' ? '#1A0000' : '#FFFFFF', border: 'transparent' },
    ghost: { bg: 'transparent', fg: t.color.brand.primary, border: 'transparent' },
  }[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      disabled={inactive}
      hitSlop={4}
      style={({ pressed }) => [
        styles.base,
        {
          minHeight: t.layout.minTouch,
          borderRadius: t.radius.button,
          backgroundColor: palette.bg,
          borderColor: palette.border,
          opacity: inactive ? 0.45 : pressed ? 0.8 : 1,
          alignSelf: fullWidth ? 'stretch' : 'flex-start',
        },
      ]}
      {...rest}
    >
      <View style={styles.row}>
        {loading ? (
          <ActivityIndicator color={palette.fg} />
        ) : icon ? (
          <Feather name={icon} size={18} color={palette.fg} />
        ) : null}
        <Text variant="headline" style={{ color: palette.fg }}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { borderWidth: 1, paddingHorizontal: 20, paddingVertical: 12, justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
});
