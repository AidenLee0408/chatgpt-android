import { Pressable, View, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import type { ReactNode } from 'react';
import { useTheme } from '../theme';

export interface CardProps {
  children: ReactNode;
  onPress?: PressableProps['onPress'];
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
  selected?: boolean;
}

/** Surface with 16 radius, 16 padding and a 1px / 8% border (no shadows). */
export function Card({ children, onPress, style, selected, accessibilityLabel, accessibilityHint }: CardProps) {
  const t = useTheme();
  const base: ViewStyle = {
    backgroundColor: t.color.bg.surface,
    borderRadius: t.radius.card,
    borderWidth: selected ? 2 : t.border.width,
    borderColor: selected ? t.color.brand.primary : t.color.border,
    padding: t.layout.cardPadding - (selected ? 1 : 0),
  };
  if (!onPress) return <View style={[base, style]}>{children}</View>;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ selected: !!selected }}
      style={({ pressed }) => [base, { opacity: pressed ? 0.85 : 1, minHeight: t.layout.minTouch }, style]}
    >
      {children}
    </Pressable>
  );
}
