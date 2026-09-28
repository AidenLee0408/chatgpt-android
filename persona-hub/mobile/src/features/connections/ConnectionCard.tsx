import { View } from 'react-native';
import type { Connection } from '../../api/types';
import { Button, Card } from '../../components';
import { Text, useTheme } from '../../theme';
import { ClientLogo } from './ClientLogo';
import { STATUS_META, relativeTime } from './format';
import { StatusBadge } from './StatusBadge';

export function ConnectionCard({ connection, onPress, onReconnect }: { connection: Connection; onPress: () => void; onReconnect: () => void }) {
  const t = useTheme();
  const c = connection;
  const last = c.last_accessed_at ? `마지막 조회 ${relativeTime(c.last_accessed_at)}` : '아직 조회 없음';
  // Reconnect sits outside the pressable card so screen readers can reach it separately.
  return (
    <View style={{ gap: 8 }}>
    <Card
      onPress={onPress}
      accessibilityLabel={`${c.client_name}, ${STATUS_META[c.status].label}, 페르소나 ${c.persona_ids.length}개, ${last}`}
      accessibilityHint="연결 상세를 열어요"
    >
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
        <ClientLogo name={c.client_name} />
        <View style={{ flex: 1, gap: 4 }}>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Text variant="headline">{c.client_name}</Text>
            <StatusBadge status={c.status} />
          </View>
          <Text variant="caption" tone="secondary">
            페르소나 {c.persona_ids.length}개 · {last}
          </Text>
        </View>
      </View>
    </Card>
      {c.status === 'expired' ? (
        <View style={{ gap: 8, paddingHorizontal: t.spacing.xs }}>
          <Text variant="caption" tone="secondary">
            {c.client_name} 연결이 만료됐어요. 다시 연결하면 바로 이어서 쓸 수 있어요.
          </Text>
          <Button label="재연결" variant="secondary" icon="refresh-cw" onPress={onReconnect} accessibilityLabel={`${c.client_name} 재연결`} />
        </View>
      ) : null}
    </View>
  );
}
