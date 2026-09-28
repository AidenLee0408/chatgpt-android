/** S-08 페르소나 상세 — 한 줄 설명, 선호 지시문, 팩트(카테고리별), 이 페르소나를 보는 AI */
import { Feather } from '@expo/vector-icons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import {
  CATEGORIES,
  errorMessage,
  isApiError,
  useConnections,
  useDeleteFact,
  useDeletePersona,
  useFacts,
  usePersona,
  useUpdatePersona,
  type Fact,
} from '../../../api';
import {
  BottomSheet,
  Button,
  Card,
  ConfirmSheet,
  EmptyState,
  ErrorState,
  FactRow,
  InlineBanner,
  PersonaAvatar,
  Screen,
  SectionHeader,
  SensitivityBadge,
  Skeleton,
  SkeletonList,
  TextField,
  useToast,
} from '../../../components';
import { CATEGORY_META } from '../../../copy/labels';
import { Text, useTheme } from '../../../theme';

type EditField = 'name' | 'description' | 'instructions';
const FIELD_LABEL: Record<EditField, string> = { name: '이름', description: '한 줄 설명', instructions: '선호 지시문' };

export default function PersonaDetailScreen() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const toast = useToast();
  const persona = usePersona(id);
  const facts = useFacts(id);
  const connections = useConnections();
  const updatePersona = useUpdatePersona();
  const deletePersona = useDeletePersona();
  const deleteFact = useDeleteFact(id);

  const [edit, setEdit] = useState<{ field: EditField; value: string } | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'fact'; fact: Fact } | { kind: 'persona' } | null>(null);
  const [menu, setMenu] = useState(false);

  const grouped = useMemo(() => {
    const m = new Map<Fact['category'], Fact[]>();
    for (const f of facts.data ?? []) m.set(f.category, [...(m.get(f.category) ?? []), f]);
    return CATEGORIES.filter((c) => m.has(c)).map((c) => ({ category: c, items: m.get(c)! }));
  }, [facts.data]);

  const viewers = useMemo(
    () => (connections.data ?? []).filter((c) => c.status !== 'revoked' && c.persona_ids.includes(id)),
    [connections.data, id],
  );

  if (persona.isPending)
    return (
      <Screen>
        <Skeleton width={56} height={56} radius={20} />
        <Skeleton width="60%" height={24} />
        <SkeletonList rows={3} />
      </Screen>
    );
  if (persona.isError)
    return (
      <Screen>
        <ErrorState message={errorMessage(persona.error)} onRetry={() => persona.refetch()} />
      </Screen>
    );
  const p = persona.data;

  async function saveEdit() {
    if (!edit) return;
    try {
      await updatePersona.mutateAsync({ id: p.id, version: p.version, body: { [edit.field]: edit.value.trim() } });
      setEdit(null);
      toast.show(`${FIELD_LABEL[edit.field]}을 저장했어요`);
    } catch (e) {
      if (isApiError(e) && e.is('version_conflict')) {
        setEdit(null);
        toast.show('다른 기기에서 먼저 수정했어요. 최신 내용을 불러왔어요.');
      }
    }
  }

  async function toggleArchive() {
    setMenu(false);
    try {
      await updatePersona.mutateAsync({ id: p.id, version: p.version, body: { archived: !p.archived } });
      toast.show(p.archived ? '페르소나를 다시 꺼냈어요' : '페르소나를 보관했어요. 연결된 AI는 더 이상 볼 수 없어요.');
    } catch (e) {
      toast.show(errorMessage(e));
    }
  }

  async function onConfirm() {
    if (!confirm) return;
    try {
      if (confirm.kind === 'fact') {
        await deleteFact.mutateAsync(confirm.fact.id);
        toast.show('팩트를 삭제했어요');
        setConfirm(null);
      } else {
        await deletePersona.mutateAsync(p.id);
        setConfirm(null);
        toast.show(`${p.name} 페르소나를 삭제했어요`);
        router.back();
      }
    } catch (e) {
      setConfirm(null);
      toast.show(errorMessage(e));
    }
  }

  const openFactEditor = (factId?: string) =>
    router.push({ pathname: '/facts/edit', params: factId ? { personaId: p.id, factId } : { personaId: p.id } });

  return (
    <>
      <Stack.Screen
        options={{
          title: p.name,
          headerRight: () => (
            <Button variant="ghost" fullWidth={false} icon="more-horizontal" label="더보기" accessibilityLabel="페르소나 메뉴" onPress={() => setMenu(true)} />
          ),
        }}
      />
      <Screen refreshing={persona.isRefetching || facts.isRefetching} onRefresh={() => { persona.refetch(); facts.refetch(); connections.refetch(); }}>
        {p.archived ? <InlineBanner tone="warning" message="보관된 페르소나예요. 어떤 AI도 볼 수 없어요." actionLabel="다시 꺼내기" onAction={toggleArchive} /> : null}

        <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
          <PersonaAvatar id={p.id} icon={p.icon} color={p.color} size={56} />
          <View style={{ flex: 1 }}>
            <Text variant="title" accessibilityRole="header">
              {p.name}
            </Text>
            <Text variant="caption" tone="secondary">
              팩트 {facts.data?.length ?? p.fact_count ?? 0}개
            </Text>
          </View>
        </View>

        <EditableCard label="한 줄 설명" value={p.description} placeholder="이 페르소나를 한 줄로 설명해 주세요" onEdit={() => setEdit({ field: 'description', value: p.description ?? '' })} />
        <EditableCard
          label="선호 지시문"
          value={p.instructions}
          placeholder={'AI에게 바라는 답변 방식을 적어 주세요. 예: "존댓말, 결론 먼저"'}
          onEdit={() => setEdit({ field: 'instructions', value: p.instructions ?? '' })}
        />

        <SectionHeader title="이 페르소나를 보는 AI" />
        {connections.isPending ? (
          <Skeleton height={48} />
        ) : connections.isError ? (
          <InlineBanner tone="error" message="연결 정보를 불러오지 못했어요." actionLabel="다시 불러오기" onAction={() => connections.refetch()} />
        ) : viewers.length === 0 ? (
          <Card>
            <Text variant="body" tone="secondary">
              아직 이 페르소나를 보는 AI가 없어요.
            </Text>
            <Button variant="ghost" fullWidth={false} label="AI 연결하러 가기" onPress={() => router.push('/connections')} />
          </Card>
        ) : (
          <Card style={{ gap: 8 }}>
            {viewers.map((c) => (
              <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 40 }} accessible accessibilityLabel={`${c.client_name}, ${c.status === 'expired' ? '만료됨' : '연결됨'}, 최대 ${c.max_sensitivity === 'sensitive' ? '민감' : '일반'} 등급까지`}>
                <Feather name={c.status === 'expired' ? 'alert-circle' : 'link-2'} size={16} color={c.status === 'expired' ? t.color.sensitivity.sensitive : t.color.text.secondary} />
                <Text variant="body" style={{ flex: 1 }}>
                  {c.client_name}
                  {c.status === 'expired' ? ' · 만료됨' : ''}
                </Text>
                <SensitivityBadge value={c.max_sensitivity} prefix="최대" />
              </View>
            ))}
          </Card>
        )}

        <SectionHeader title="팩트" action={<Button variant="ghost" fullWidth={false} icon="plus" label="팩트 추가" onPress={() => openFactEditor()} />} />
        {facts.isPending ? (
          <SkeletonList rows={2} />
        ) : facts.isError ? (
          <ErrorState message={errorMessage(facts.error)} onRetry={() => facts.refetch()} />
        ) : grouped.length === 0 ? (
          <EmptyState icon="file-plus" title="아직 팩트가 없어요" body="AI가 알면 좋을 나에 대한 정보를 한 줄씩 적어 보세요." actionLabel="팩트 추가" onAction={() => openFactEditor()} />
        ) : (
          grouped.map((g) => (
            <Card key={g.category} style={{ paddingVertical: 4 }}>
              <Text variant="label" tone="secondary" style={{ paddingTop: 12 }}>
                {CATEGORY_META[g.category].label}
              </Text>
              {g.items.map((f) => (
                <FactRow key={f.id} fact={f} onEdit={() => openFactEditor(f.id)} onDelete={() => setConfirm({ kind: 'fact', fact: f })} />
              ))}
            </Card>
          ))
        )}

        <Button variant="secondary" icon="copy" label="이 페르소나로 컨텍스트 팩 복사" onPress={() => router.push({ pathname: '/context-pack', params: { personaId: p.id } })} />
      </Screen>

      <BottomSheet visible={!!edit} onClose={() => setEdit(null)} title={edit ? `${FIELD_LABEL[edit.field]} 수정` : undefined}>
        {edit ? (
          <>
            {updatePersona.isError && !(isApiError(updatePersona.error) && updatePersona.error.is('version_conflict')) ? (
              <InlineBanner tone="error" message={errorMessage(updatePersona.error)} />
            ) : null}
            <TextField
              label={FIELD_LABEL[edit.field]}
              value={edit.value}
              onChangeText={(v) => setEdit({ ...edit, value: v })}
              multiline={edit.field === 'instructions'}
              maxLength={edit.field === 'instructions' ? 1000 : edit.field === 'description' ? 100 : 30}
              showCount
              autoFocus
            />
            <Button label={`${FIELD_LABEL[edit.field]} 저장`} loading={updatePersona.isPending} disabled={edit.field === 'name' && !edit.value.trim()} onPress={saveEdit} />
          </>
        ) : null}
      </BottomSheet>

      <BottomSheet visible={menu} onClose={() => setMenu(false)} title={p.name}>
        <Button variant="secondary" icon="edit-3" label="이름 바꾸기" onPress={() => { setMenu(false); setEdit({ field: 'name', value: p.name }); }} />
        <Button variant="secondary" icon="archive" label={p.archived ? '보관 해제하기' : '페르소나 보관하기'} onPress={toggleArchive} />
        <Button variant="danger" icon="trash-2" label="페르소나 삭제" onPress={() => { setMenu(false); setConfirm({ kind: 'persona' }); }} />
      </BottomSheet>

      <ConfirmSheet
        visible={!!confirm}
        title={confirm?.kind === 'persona' ? `${p.name} 페르소나를 삭제할까요?` : '이 팩트를 삭제할까요?'}
        body={
          confirm?.kind === 'persona'
            ? `팩트 ${facts.data?.length ?? 0}개가 함께 지워지고, 연결된 AI는 즉시 이 페르소나를 볼 수 없게 돼요. 되돌릴 수 없어요.`
            : confirm?.kind === 'fact'
              ? `"${confirm.fact.body}" — 삭제하면 어떤 AI도 이 팩트를 볼 수 없어요.`
              : undefined
        }
        confirmLabel={confirm?.kind === 'persona' ? '페르소나 삭제' : '팩트 삭제'}
        loading={deleteFact.isPending || deletePersona.isPending}
        onConfirm={onConfirm}
        onCancel={() => setConfirm(null)}
      />
    </>
  );
}

function EditableCard({ label, value, placeholder, onEdit }: { label: string; value?: string; placeholder: string; onEdit: () => void }) {
  return (
    <Card onPress={onEdit} accessibilityLabel={`${label}: ${value || '비어 있음'}`} accessibilityHint="눌러서 수정" style={{ gap: 4 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text variant="label" tone="secondary">
          {label}
        </Text>
        <Text variant="label" tone="brand">
          수정
        </Text>
      </View>
      <Text variant="body" tone={value ? 'primary' : 'secondary'}>
        {value || placeholder}
      </Text>
    </Card>
  );
}
