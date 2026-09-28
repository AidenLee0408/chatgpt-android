import { Feather } from '@expo/vector-icons';
import { View } from 'react-native';
import type { IconName } from '../copy/labels';
import { Text, useTheme } from '../theme';
import { Button } from './Button';

export interface EmptyStateProps {
  icon?: IconName;
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
}

/** Used for 빈 상태 and (with icon="wifi-off") 에러 상태. */
export function EmptyState({ icon = 'inbox', title, body, actionLabel, onAction, secondaryLabel, onSecondary }: EmptyStateProps) {
  const t = useTheme();
  return (
    <View style={{ alignItems: 'center', paddingVertical: 48, paddingHorizontal: 24, gap: 12 }}>
      <View
        style={{
          width: 72,
          height: 72,
          borderRadius: 36,
          backgroundColor: t.color.persona[1],
          alignItems: 'center',
          justifyContent: 'center',
        }}
        importantForAccessibility="no"
      >
        <Feather name={icon} size={32} color={t.color.personaOn[1]} />
      </View>
      <Text variant="headline" style={{ textAlign: 'center' }} accessibilityRole="header">
        {title}
      </Text>
      {body ? (
        <Text variant="body" tone="secondary" style={{ textAlign: 'center' }}>
          {body}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <View style={{ alignSelf: 'stretch', marginTop: 8 }}>
          <Button label={actionLabel} onPress={onAction} />
        </View>
      ) : null}
      {secondaryLabel && onSecondary ? (
        <View style={{ alignSelf: 'stretch' }}>
          <Button variant="ghost" label={secondaryLabel} onPress={onSecondary} />
        </View>
      ) : null}
    </View>
  );
}

/** Standard error state: server message + retry. */
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <EmptyState icon="wifi-off" title="불러오지 못했어요" body={message} actionLabel={onRetry ? '다시 불러오기' : undefined} onAction={onRetry} />
  );
}
