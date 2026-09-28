/** S-07 페르소나 목록(홈) — 카드 그리드, 새로 만들기, 요금제 한도 처리 */
import { router, Stack } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import {
  errorMessage,
  isApiError,
  randomId,
  useConnections,
  useCreatePersona,
  useMe,
  usePersonas,
  type Persona,
} from '../../../api';
import {
  BottomSheet,
  Button,
  ChipGroup,
  EmptyState,
  ErrorState,
  InlineBanner,
  PersonaCard,
  Screen,
  SkeletonList,
  TextField,
} from '../../../components';
import { Text } from '../../../theme';

const LIMIT_COPY = '무료 플랜은 페르소나를 3개까지 만들 수 있어요. 안 쓰는 페르소나를 보관하거나 삭제해 주세요.';

export default function PersonaListScreen() {
  const [archived, setArchived] = useState<'active' | 'archived'>('active');
  const personas = usePersonas(archived === 'archived');
  const me = useMe();
  const connections = useConnections();
  const create = useCreatePersona();
  const [sheet, setSheet] = useState<'closed' | 'choose' | 'blank'>('closed');
  const [name, setName] = useState('');
  const [limitHit, setLimitHit] = useState(false);
  const idem = useRef(randomId());

  /** persona_id → number of active connections that can see it. */
  const connCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of connections.data ?? []) {
      if (c.status !== 'active') continue;
      for (const pid of c.persona_ids) m.set(pid, (m.get(pid) ?? 0) + 1);
    }
    return m;
  }, [connections.data]);

  const activeCount = archived === 'active' ? personas.data?.length ?? 0 : undefined;
  const limit = me.data?.limits?.max_personas;
  const atLimit = limit != null && activeCount != null && activeCount >= limit;

  function openCreate() {
    if (atLimit) {
      setLimitHit(true);
      return;
    }
    setSheet('choose');
  }

  async function createBlank() {
    try {
      const p = await create.mutateAsync({ body: { name: name.trim() }, idempotencyKey: idem.current });
      idem.current = randomId();
      setSheet('closed');
      setName('');
      router.push({ pathname: '/personas/[id]', params: { id: p.id } });
    } catch (e) {
      if (isApiError(e) && e.is('plan_limit_reached')) {
        setSheet('closed');
        setLimitHit(true);
      }
    }
  }

  const header = <Stack.Screen options={{ headerRight: () => <Button variant="ghost" fullWidth={false} icon="plus" label="새로 만들기" onPress={openCreate} /> }} />;

  let body: React.ReactNode;
  if (personas.isPending) body = <SkeletonList rows={4} grid />;
  else if (personas.isError) body = <ErrorState message={errorMessage(personas.error)} onRetry={() => personas.refetch()} />;
  else if (personas.data.length === 0)
    body =
      archived === 'archived' ? (
        <EmptyState icon="archive" title="보관한 페르소나가 없어요" />
      ) : (
        <EmptyState
          icon="user-plus"
          title="아직 페르소나가 없어요"
          body="3분 인터뷰로 첫 번째 나를 만들어 보세요."
          actionLabel="인터뷰로 만들기"
          onAction={() => router.push('/onboarding/templates')}
        />
      );
  else body = <Grid items={personas.data} connCount={connections.isSuccess ? connCount : undefined} />;

  return (
    <Screen refreshing={personas.isRefetching} onRefresh={() => personas.refetch()}>
      {header}
      {limitHit ? <InlineBanner tone="warning" message={LIMIT_COPY} actionLabel="닫기" onAction={() => setLimitHit(false)} /> : null}
      <ChipGroup
        label="보기"
        value={archived}
        onChange={setArchived}
        options={[
          { value: 'active', label: '사용 중' },
          { value: 'archived', label: '보관됨' },
        ]}
      />
      {body}
      {personas.data && personas.data.length > 0 && archived === 'active' ? (
        <Button variant="secondary" icon="copy" label="컨텍스트 팩 복사" onPress={() => router.push('/context-pack')} />
      ) : null}

      <BottomSheet visible={sheet === 'choose'} onClose={() => setSheet('closed')} title="새 페르소나 만들기">
        <Button label="인터뷰로 만들기 (3분)" icon="message-circle" onPress={() => { setSheet('closed'); router.push('/onboarding/templates'); }} />
        <Button variant="secondary" label="빈 페르소나 만들기" icon="edit-3" onPress={() => setSheet('blank')} />
      </BottomSheet>
      <BottomSheet visible={sheet === 'blank'} onClose={() => setSheet('closed')} title="빈 페르소나 만들기">
        {create.isError && !(isApiError(create.error) && create.error.is('plan_limit_reached')) ? (
          <InlineBanner tone="error" message={errorMessage(create.error)} />
        ) : null}
        <TextField label="이름" placeholder="예: 업무의 나" value={name} onChangeText={setName} maxLength={30} autoFocus />
        <Button label="페르소나 만들기" disabled={!name.trim()} loading={create.isPending} onPress={createBlank} />
      </BottomSheet>
    </Screen>
  );
}

function Grid({ items, connCount }: { items: Persona[]; connCount?: Map<string, number> }) {
  const rows: Persona[][] = [];
  for (let i = 0; i < items.length; i += 2) rows.push(items.slice(i, i + 2));
  return (
    <View style={{ gap: 12 }}>
      {rows.map((row, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 12 }}>
          {row.map((p) => (
            <PersonaCard
              key={p.id}
              persona={p}
              connectionCount={connCount?.get(p.id)}
              onPress={() => router.push({ pathname: '/personas/[id]', params: { id: p.id } })}
            />
          ))}
          {row.length === 1 ? <View style={{ flex: 1 }} /> : null}
        </View>
      ))}
      <Text variant="caption" tone="secondary" style={{ textAlign: 'center' }}>
        페르소나 {items.length}개
      </Text>
    </View>
  );
}
