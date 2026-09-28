/**
 * S-06 팩트 검토 — POST /interviews/{id}/extract → 카테고리·민감도 수정 → POST /interviews/{id}/commit
 * 추천된 민감도는 저장 전 반드시 보인다(F-03).
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import {
  CATEGORIES,
  errorMessage,
  isApiError,
  randomId,
  useCommitInterview,
  useExtractInterview,
  useTemplates,
  type Category,
  type FactCandidate,
  type Sensitivity,
} from '../../../api';
import {
  Button,
  Card,
  Checkbox,
  ChipGroup,
  EmptyState,
  ErrorState,
  InlineBanner,
  Screen,
  SensitivityBadge,
  SensitivitySegment,
  SkeletonList,
  TextField,
} from '../../../components';
import { CATEGORY_META } from '../../../copy/labels';
import { Text } from '../../../theme';

interface Row extends FactCandidate {
  /** What the server/LLM recommended — kept visible even after the user changes it. */
  suggested: Sensitivity;
  include: boolean;
  editing: boolean;
}

export default function ReviewScreen() {
  const { id, templateId } = useLocalSearchParams<{ id: string; templateId?: string }>();
  const templates = useTemplates();
  const extract = useExtractInterview();
  const commit = useCommitInterview();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [name, setName] = useState('');
  const [blocked, setBlocked] = useState<string[]>([]);
  const [commitError, setCommitError] = useState<{ message: string; index?: number } | null>(null);
  const idemKey = useRef(randomId()).current;

  const runExtract = () =>
    extract.mutate(id, {
      onSuccess: (res) => {
        setRows(res.candidates.map((c) => ({ ...c, suggested: c.sensitivity, include: true, editing: false })));
        setBlocked(res.blocked.map((b) => b.reason));
        const tpl = templates.data?.find((x) => x.id === templateId);
        setName((n) => n || tpl?.persona_defaults.name || '새 페르소나');
      },
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(runExtract, [id]);

  const update = (i: number, patch: Partial<Row>) => setRows((r) => r && r.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const selected = rows?.filter((r) => r.include && r.body.trim()) ?? [];

  async function save() {
    if (!rows) return;
    setCommitError(null);
    const tpl = templates.data?.find((x) => x.id === templateId);
    try {
      const { persona } = await commit.mutateAsync({
        id,
        idempotencyKey: idemKey,
        body: {
          persona: {
            name: name.trim() || '새 페르소나',
            icon: tpl?.persona_defaults.icon,
            description: tpl?.persona_defaults.description,
          },
          facts: selected.map((r) => ({ category: r.category, body: r.body.trim(), sensitivity: r.sensitivity })),
        },
      });
      router.dismissAll();
      router.replace({ pathname: '/personas/[id]', params: { id: persona.id } });
    } catch (e) {
      // server reports the offending item as field "facts.3.body"
      const m = isApiError(e) ? /facts[.[](\d+)/.exec(e.field ?? '') : null;
      const selIndex = m ? Number(m[1]) : undefined;
      const rowIndex = selIndex != null ? rows.indexOf(selected[selIndex]) : undefined;
      setCommitError({ message: errorMessage(e), index: rowIndex });
      if (rowIndex != null && rowIndex >= 0) update(rowIndex, { editing: true });
    }
  }

  if (extract.isPending || (!rows && !extract.isError))
    return (
      <Screen>
        <Text variant="title">답변을 팩트로 정리하고 있어요</Text>
        <SkeletonList rows={4} />
      </Screen>
    );
  if (extract.isError) return <Screen><ErrorState message={errorMessage(extract.error)} onRetry={runExtract} /></Screen>;
  if (!rows || rows.length === 0)
    return (
      <Screen>
        <EmptyState
          icon="file-text"
          title="만들 팩트가 없어요"
          body="답변이 없거나 너무 짧았어요. 질문에 조금 더 답해 보세요."
          actionLabel="템플릿 다시 고르기"
          onAction={() => router.replace('/onboarding/templates')}
        />
      </Screen>
    );

  return (
    <Screen
      footer={<Button label={`팩트 ${selected.length}개로 페르소나 저장`} disabled={selected.length === 0 || !name.trim()} loading={commit.isPending} onPress={save} />}
    >
      <Text variant="title" accessibilityRole="header">
        이렇게 정리했어요
      </Text>
      <Text variant="body" tone="secondary">
        AI가 추천한 민감도를 확인하고, 맞지 않으면 바꿔 주세요. 체크를 끄면 저장하지 않아요.
      </Text>
      {commitError ? <InlineBanner tone="error" message={commitError.message} /> : null}
      {blocked.length > 0 ? (
        <InlineBanner tone="warning" message={`답변 ${blocked.length}개는 저장하지 않았어요. ${blocked[0]}`} />
      ) : null}
      <TextField label="페르소나 이름" value={name} onChangeText={setName} maxLength={30} />
      {rows.map((r, i) => (
        <Card key={r.id} style={{ gap: 12, opacity: r.include ? 1 : 0.55 }}>
          <Checkbox checked={r.include} onChange={(v) => update(i, { include: v })} label={r.body || '(빈 팩트)'} />
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <SensitivityBadge value={r.suggested} prefix="추천" />
            <Text variant="label" tone="secondary">
              {CATEGORY_META[r.category].label}
            </Text>
          </View>
          {r.editing ? (
            <View style={{ gap: 12 }}>
              <TextField
                label="내용"
                value={r.body}
                onChangeText={(v) => update(i, { body: v })}
                maxLength={500}
                showCount
                multiline
                error={commitError?.index === i ? commitError.message : null}
              />
              <ChipGroup<Category>
                label="카테고리"
                value={r.category}
                onChange={(v) => update(i, { category: v })}
                options={CATEGORIES.map((c) => ({ value: c, label: CATEGORY_META[c].label }))}
              />
              <SensitivitySegment value={r.sensitivity} onChange={(v) => update(i, { sensitivity: v })} />
              <Button variant="secondary" label="편집 마치기" onPress={() => update(i, { editing: false })} />
            </View>
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <SensitivityBadge value={r.sensitivity} prefix="저장 등급" />
              <Button variant="ghost" fullWidth={false} label="내용·등급 바꾸기" onPress={() => update(i, { editing: true })} disabled={!r.include} />
            </View>
          )}
        </Card>
      ))}
    </Screen>
  );
}
