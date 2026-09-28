import { Feather } from '@expo/vector-icons';
import { View } from 'react-native';
import type { IconName } from '../copy/labels';
import { Text, useTheme } from '../theme';
import { Button } from './Button';

export type BannerTone = 'info' | 'warning' | 'error';

export function InlineBanner({ tone = 'info', message, actionLabel, onAction }: { tone?: BannerTone; message: string; actionLabel?: string; onAction?: () => void }) {
  const t = useTheme();
  const c = tone === 'error' ? t.color.danger : tone === 'warning' ? t.color.sensitivity.sensitive : t.color.brand.primary;
  const icon: IconName = tone === 'error' ? 'wifi-off' : tone === 'warning' ? 'alert-triangle' : 'info';
  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={{
        flexDirection: 'row',
        gap: 10,
        alignItems: 'center',
        padding: 12,
        borderRadius: t.radius.button,
        borderWidth: 1,
        borderColor: c,
        backgroundColor: t.color.bg.surface,
      }}
    >
      <Feather name={icon} size={18} color={c} />
      <Text variant="caption" style={{ flex: 1 }}>
        {message}
      </Text>
      {actionLabel && onAction ? <Button variant="ghost" fullWidth={false} label={actionLabel} onPress={onAction} /> : null}
    </View>
  );
}
