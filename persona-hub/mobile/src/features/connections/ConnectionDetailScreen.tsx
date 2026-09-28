import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import {
  errorMessage,
  isApiError,
  performStepUp,
  useAccessLogs,
  useConnection,
  useDeleteConnection,
  usePersonas,
  useUpdateConnection,
} from '../../api';
import {
  Button,
  Card,
  ConfirmSheet,
  ErrorState,
  InlineBanner,
  PersonaAvatar,
  Screen,
  SectionHeader,
  SensitivityBadge,
  Skeleton,
  SkeletonList,
  useToast,
} from '../../components';
import { Text } from '../../theme';
import { logSentence } from '../activity/logCopy';
import { ClientLogo } from './ClientLogo';
import { clientKey, formatDate, relativeTime } from './format';
import { ScopeSheet, type ScopeValue } from './ScopeSheet';
import { StatusBadge } from './StatusBadge';

/** S-13 연결 상세 */
export function ConnectionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const q = useConnection(id);
  const personas = usePersonas();
  const logs = useAccessLogs({ connection_id: id });
  const update = useUpdateConnection();
  const del = useDeleteConnection();
  const [scopeOpen, setScopeOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const title = q.data?.client_name ?? '연결';
  const header = <Stack.Screen options={{ title }} />;

  if (q.isPending) {
    return (
      <Screen>
        {header}
        <View accessibilityLabel="연결 정보 불러오는 중" style={{ gap: 12 }}>
          <Skeleton height={56} />
          <SkeletonList rows={3} />
        </View>
      </Screen>
    );
  }
  if (q.isError) {
    return (
      <Screen>
        {header}
        <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
      </Screen>
    );
  }
  const c = q.data;
  const allPersonas = personas.data ?? [];
  const granted = allPersonas.filter((p) => c.persona_ids.includes(p.id));
  const recent = (logs.data?.pages.flatMap((p) => p.items) ?? []).slice(0, 5);
  const live = c.status !== 'revoked';

  const save = async (v: ScopeValue, widening: boolean) => {
    try {
      if (widening) await performStepUp('연결 범위를 넓히려면 본인 확인이 필요해요');
      await update.mutateAsync({ id: c.id, version: c.version, body: v });
      setScopeOpen(false);
      toast.show('범위를 바꿨어요. 다음 조회부터 적용돼요.');
    } catch (e) {
      if (isApiError(e) && e.code === 'version_conflict') {
        setScopeOpen(false);
        toast.show('다른 기기에서 먼저 수정했어요. 최신 범위를 불러왔어요.');
      } else toast.show(errorMessage(e));
    }
  };
  const disconnect = async () => {
    try {
      await del.mutateAsync(c.id);
      setConfirmOpen(false);
      toast.show(`${c.client_name} 연결을 끊었어요`);
      router.back();
    } catch (e) {
      toast.show(errorMessage(e));
    }
  };

  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => { q.refetch(); logs.refetch(); }}>
      {header}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <ClientLogo name={c.client_name} size={56} />
        <View style={{ flex: 1, gap: 4 }}>
          <Text variant="title" accessibilityRole="header">
            {c.client_name}
          </Text>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <StatusBadge status={c.status} />
            <Text variant="caption" tone="secondary">
              {formatDate(c.created_at)} 연결
            </Text>
          </View>
        </View>
      </View>

      {c.status === 'expired' ? (
        <InlineBanner
          tone="warning"
          message={`${c.client_name} 연결이 만료됐어요. 다시 연결하면 바로 이어서 쓸 수 있어요.`}
          actionLabel="재연결"
          onAction={() => router.push({ pathname: '/connections/new', params: { client: clientKey(c.client_id ?? c.client_name) } })}
        />
      ) : null}
      {c.status === 'revoked' ? <InlineBanner message="해제된 연결이에요. 이 AI는 더 이상 페르소나를 볼 수 없어요." /> : null}

      <SectionHeader
        title="볼 수 있는 범위"
        action={
          live ? (
            <Button
              label="변경"
              variant="ghost"
              fullWidth={false}
              onPress={() => setScopeOpen(true)}
              disabled={personas.isPending}
              accessibilityLabel="볼 수 있는 범위 변경"
            />
          ) : undefined
        }
      />
      <Card>
        <View style={{ gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text variant="body" tone="secondary">
              최대 등급
            </Text>
            <SensitivityBadge value={c.max_sensitivity} />
          </View>
          {personas.isPending ? (
            <Skeleton height={40} />
          ) : c.persona_ids.length === 0 ? (
            <Text variant="body" tone="secondary">
              허용한 페르소나가 없어요. {c.client_name}는 아무것도 볼 수 없어요.
            </Text>
          ) : (
            granted.map((p) => (
              <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 }}>
                <PersonaAvatar id={p.id} icon={p.icon} color={p.color} size={36} />
                <Text variant="body" style={{ flex: 1 }}>
                  {p.name}
                </Text>
              </View>
            ))
          )}
        </View>
      </Card>

      <SectionHeader title="최근 조회" />
      {logs.isPending ? (
        <SkeletonList rows={2} />
      ) : logs.isError ? (
        <InlineBanner tone="error" message={errorMessage(logs.error)} actionLabel="다시 시도" onAction={() => logs.refetch()} />
      ) : recent.length === 0 ? (
        <Text variant="body" tone="secondary">
          연결은 됐지만 아직 조회가 없어요. AI에게 '내 페르소나 보고 답해줘'라고 말해 보세요.
        </Text>
      ) : (
        <Card>
          <View style={{ gap: 12 }}>
            {recent.map((l) => (
              <View key={l.id} accessible style={{ gap: 2 }}>
                <Text variant="body">{logSentence(l, allPersonas)}</Text>
                <Text variant="caption" tone="secondary">
                  {relativeTime(l.created_at)} · 팩트 {l.fact_count}개
                </Text>
              </View>
            ))}
            <Button
              label="전체 활동 보기"
              variant="ghost"
              onPress={() => router.push({ pathname: '/activity', params: { connection_id: c.id } })}
            />
          </View>
        </Card>
      )}

      {live ? (
        <View style={{ marginTop: 16 }}>
          <Button label="연결 끊기" variant="danger" icon="x-circle" onPress={() => setConfirmOpen(true)} />
        </View>
      ) : null}

      {live ? (
        <ScopeSheet
          visible={scopeOpen}
          connection={c}
          personas={allPersonas}
          saving={update.isPending}
          onClose={() => setScopeOpen(false)}
          onSave={save}
        />
      ) : null}
      <ConfirmSheet
        visible={confirmOpen}
        title={`${c.client_name} 연결을 끊을까요?`}
        body={`${c.client_name}는 즉시 페르소나를 볼 수 없게 돼요.`}
        confirmLabel="연결 끊기"
        loading={del.isPending}
        onConfirm={disconnect}
        onCancel={() => setConfirmOpen(false)}
      />
    </Screen>
  );
}
