import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { errorMessage, useConnections } from '../../api';
import { Button, EmptyState, ErrorState, Screen, SkeletonList } from '../../components';
import { Text } from '../../theme';
import { ConnectionCard } from './ConnectionCard';
import { clientKey } from './format';

/** S-11 연결 목록 */
export function ConnectionsListScreen() {
  const router = useRouter();
  const q = useConnections();
  const openGuide = (client?: string) =>
    router.push(client ? { pathname: '/connections/new', params: { client } } : '/connections/new');

  if (q.isPending) {
    return (
      <Screen>
        <View accessibilityLabel="연결 목록 불러오는 중">
          <SkeletonList rows={3} />
        </View>
      </Screen>
    );
  }
  if (q.isError) {
    return (
      <Screen>
        <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
      </Screen>
    );
  }
  // Revoked connections are history; the list shows live ones first.
  const items = [...q.data].sort((a, b) => order(a.status) - order(b.status));
  if (items.length === 0) {
    return (
      <Screen>
        <EmptyState
          icon="link-2"
          title="아직 연결한 AI가 없어요"
          body="AI를 연결하면 더 이상 자기소개를 반복하지 않아도 돼요."
          actionLabel="새 연결"
          onAction={() => openGuide()}
        />
      </Screen>
    );
  }
  return (
    <Screen
      refreshing={q.isRefetching}
      onRefresh={() => q.refetch()}
      footer={<Button label="새 연결" icon="plus" onPress={() => openGuide()} />}
    >
      <Text variant="caption" tone="secondary">
        연결된 AI는 허용한 페르소나만 볼 수 있어요.
      </Text>
      {items.map((c) => (
        <ConnectionCard
          key={c.id}
          connection={c}
          onPress={() => router.push({ pathname: '/connections/[id]', params: { id: c.id } })}
          onReconnect={() => openGuide(clientKey(c.client_id ?? c.client_name))}
        />
      ))}
    </Screen>
  );
}

const order = (s: string) => (s === 'expired' ? 0 : s === 'active' ? 1 : 2);
