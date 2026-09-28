/**
 * S-09 팩트 추가·편집 — 카테고리, 본문(≤500), 민감도 세그먼트, 비공개 패턴 경고(필드 아래 빨간 도움말 + 저장 차단).
 * Params: personaId (required), factId (edit mode).
 */
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  CATEGORIES,
  errorMessage,
  isApiError,
  randomId,
  useCreateFact,
  useFacts,
  useMe,
  useUpdateFact,
  type Category,
  type Sensitivity,
} from '../../api';
import { Button, ChipGroup, EmptyState, ErrorState, InlineBanner, Screen, SkeletonList, TextField, SensitivitySegment, useToast } from '../../components';
import { CATEGORY_META } from '../../copy/labels';
import { detectPrivatePattern } from '../../lib/privatePattern';
import { Text } from '../../theme';

const MAX = 500;

export default function FactEditScreen() {
  const { personaId, factId } = useLocalSearchParams<{ personaId: string; factId?: string }>();
  const toast = useToast();
  const facts = useFacts(factId ? personaId : undefined);
  const me = useMe();
  const createFact = useCreateFact(personaId);
  const updateFact = useUpdateFact(personaId);
  const existing = factId ? facts.data?.find((f) => f.id === factId) : undefined;

  const [category, setCategory] = useState<Category>('profile');
  const [body, setBody] = useState('');
  const [sensitivity, setSensitivity] = useState<Sensitivity>('normal');
  /** Error from the server for the exact body it rejected. */
  const [serverError, setServerError] = useState<{ body: string; message: string } | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const loaded = useRef(false);
  const idem = useRef(randomId()).current;

  useEffect(() => {
    if (existing && !loaded.current) {
      loaded.current = true;
      setCategory(existing.category);
      setBody(existing.body);
      setSensitivity(existing.sensitivity);
    }
  }, [existing]);

  const localError = detectPrivatePattern(body);
  const fieldError = localError ?? (serverError && serverError.body === body ? serverError.message : null);
  const sensitiveBlocked = sensitivity === 'sensitive' && me.data?.consents && !me.data.consents.sensitive_data;
  const saving = createFact.isPending || updateFact.isPending;
  const canSave = body.trim().length > 0 && body.length <= MAX && !fieldError && !sensitiveBlocked && !saving;

  async function save() {
    setBanner(null);
    const payload = { category, body: body.trim(), sensitivity };
    try {
      if (existing) await updateFact.mutateAsync({ id: existing.id, version: existing.version, body: payload });
      else await createFact.mutateAsync({ body: payload, idempotencyKey: idem });
      toast.show(existing ? '팩트를 저장했어요' : '팩트를 추가했어요');
      router.back();
    } catch (e) {
      if (!isApiError(e)) return setBanner(errorMessage(e));
      if (e.code === 'fact_private_pattern' || (e.code === 'validation_failed' && e.field === 'body')) {
        setServerError({ body, message: e.message });
      } else if (e.code === 'network_error') {
        setBanner('연결이 불안정해요. 저장하지 못한 내용은 기기에 보관해 뒀어요.');
      } else if (e.code === 'version_conflict') {
        loaded.current = false;
        setBanner('다른 기기에서 먼저 수정했어요. 최신 내용을 불러왔어요. 확인 후 다시 저장해 주세요.');
      } else {
        setBanner(errorMessage(e));
      }
    }
  }

  if (factId && facts.isPending) return <Screen><SkeletonList rows={2} /></Screen>;
  if (factId && facts.isError) return <Screen><ErrorState message={errorMessage(facts.error)} onRetry={() => facts.refetch()} /></Screen>;
  if (factId && !existing)
    return (
      <Screen>
        <EmptyState icon="file" title="팩트를 찾을 수 없어요" body="이미 삭제됐을 수 있어요." actionLabel="돌아가기" onAction={() => router.back()} />
      </Screen>
    );

  return (
    <>
      <Stack.Screen options={{ title: existing ? '팩트 편집' : '팩트 추가' }} />
      <Screen footer={<Button label={existing ? '팩트 저장' : '팩트 추가'} disabled={!canSave} loading={saving} onPress={save} />}>
        {banner ? <InlineBanner tone="error" message={banner} /> : null}
        <Text variant="label" tone="secondary">
          카테고리
        </Text>
        <ChipGroup<Category>
          label="카테고리"
          value={category}
          onChange={setCategory}
          options={CATEGORIES.map((c) => ({ value: c, label: CATEGORY_META[c].label }))}
        />
        <TextField
          label="내용"
          placeholder="예: 핀테크 스타트업 백엔드 개발자, Kotlin·Spring 주력"
          value={body}
          onChangeText={setBody}
          maxLength={MAX}
          showCount
          multiline
          error={fieldError}
          helper="한 줄에 한 가지 정보만 적어 주세요."
        />
        <Text variant="label" tone="secondary">
          민감도
        </Text>
        <SensitivitySegment value={sensitivity} onChange={setSensitivity} />
        {sensitiveBlocked ? (
          <InlineBanner tone="warning" message="민감정보 처리에 동의해야 민감 등급 팩트를 저장할 수 있어요. 설정에서 동의를 바꿀 수 있어요." />
        ) : sensitivity === 'sensitive' ? (
          <Text variant="caption" tone="secondary">
            민감 등급은 저장할 때 본인 확인(생체 인증)을 거쳐요.
          </Text>
        ) : null}
      </Screen>
    </>
  );
}
