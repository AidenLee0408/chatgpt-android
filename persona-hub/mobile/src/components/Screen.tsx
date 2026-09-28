import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, RefreshControl, ScrollView, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { useTheme } from '../theme';

export interface ScreenProps {
  children: ReactNode;
  /** Sticky bottom area (primary action). */
  footer?: ReactNode;
  scroll?: boolean;
  edges?: Edge[];
  refreshing?: boolean;
  onRefresh?: () => void;
  contentStyle?: StyleProp<ViewStyle>;
}

/** Page scaffold: safe area, bg.base, 20px side margins, keyboard avoidance, optional sticky footer. */
export function Screen({ children, footer, scroll = true, edges = ['bottom'], refreshing, onRefresh, contentStyle }: ScreenProps) {
  const t = useTheme();
  const pad = { paddingHorizontal: t.layout.screenPadding, paddingVertical: t.spacing.lg, gap: t.spacing.lg };
  return (
    <SafeAreaView edges={edges} style={{ flex: 1, backgroundColor: t.color.bg.base }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {scroll ? (
          <ScrollView
            contentContainerStyle={[pad, { flexGrow: 1 }, contentStyle]}
            keyboardShouldPersistTaps="handled"
            refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} /> : undefined}
          >
            {children}
          </ScrollView>
        ) : (
          <View style={[pad, { flex: 1 }, contentStyle]}>{children}</View>
        )}
        {footer ? (
          <View
            style={{
              paddingHorizontal: t.layout.screenPadding,
              paddingVertical: 12,
              gap: 8,
              borderTopWidth: 1,
              borderTopColor: t.color.border,
              backgroundColor: t.color.bg.base,
            }}
          >
            {footer}
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
