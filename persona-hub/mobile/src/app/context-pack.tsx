/** S-10 컨텍스트 팩 복사 — 페르소나 선택, 길이, 민감 포함, 미리보기, 복사·공유 */
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Share, View } from 'react-native';
import { errorMessage, isApiError, useCreateContextPack, usePersonas, type PackLength } from '../api';
import { Button, Card, Checkbox, ChipGroup, EmptyState, ErrorState, InlineBanner, PersonaCard, Screen, SectionHeader, Skeleton, SkeletonList, useToast } from '../components';
import { Text } from '../theme';

const LENGTHS: { value: PackLength; label: string }[] = [
  { value: 'short', label: '짧게(300자)' },
  { value: 'normal', label: '보통' },
  { value: 'detailed', label: '자세히' },
];

export default function ContextPackScreen() {
  const { personaId } = useLocalSearchParams<{ personaId?: string }>();
  const toast = useToast();
  const personas = usePersonas(false);
  const pack = useCreateContextPack();
  const [selected, setSelected] = useState<string[]>(personaId ? [personaId] : []);
  const [length, setLength] = useState<PackLength>('short');
  const [includeSensitive, setIncludeSensitive] = useState(false);

  // Regenerate the preview whenever options change (debounced).
  useEffect(() => {
    if (selected.length === 0) {
      pack.reset();
      return;
    }
    const h = setTimeout(() => {
      pack.mutate(
        { persona_ids: selected, length, include_sensitive: includeSensitive, language: 'ko' },
        {
          onError: (e) => {
            // Biometric cancelled → fall back to excluding sensitive facts.
            if (isApiError(e) && e.code === 'step_up_cancelled') setIncludeSensitive(false);
          },
        },
      );
    }, 300);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected.join(','), length, includeSensitive]);

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const text = pack.data?.text ?? '';

  async function copy() {
    await Clipboard.setStringAsync(text);
    toast.show('복사했어요. AI 대화창에 붙여넣으세요.');
  }
  async function share() {
    try {
      await Share.share({ message: text });
    } catch {
      toast.show('공유하지 못했어요. 복사해서 붙여넣어 주세요.');
    }
  }

  return (
    <Screen
      footer={
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Button label="복사하기" icon="copy" disabled={!text || pack.isPending} onPress={copy} />
          </View>
          <View style={{ flex: 1 }}>
            <Button variant="secondary" label="공유하기" icon="share" disabled={!text || pack.isPending} onPress={share} />
          </View>
        </View>
      }
    >
      <Text variant="body" tone="secondary">
        연결할 수 없는 AI에게는 이 텍스트를 붙여넣으세요. 비공개 정보는 절대 포함되지 않아요.
      </Text>

      <SectionHeader title="페르소나" />
      {personas.isPending ? (
        <SkeletonList rows={2} grid />
      ) : personas.isError ? (
        <ErrorState message={errorMessage(personas.error)} onRetry={() => personas.refetch()} />
      ) : personas.data.length === 0 ? (
        <EmptyState icon="user-plus" title="아직 페르소나가 없어요" body="페르소나를 만들면 여기서 복사할 수 있어요." />
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
          {personas.data.map((p) => (
            <View key={p.id} style={{ width: '47%' }}>
              <PersonaCard persona={p} state={selected.includes(p.id) ? 'selected' : 'default'} onPress={() => toggle(p.id)} />
            </View>
          ))}
        </View>
      )}

      <SectionHeader title="길이" />
      <ChipGroup label="길이" options={LENGTHS} value={length} onChange={setLength} />
      <Checkbox
        checked={includeSensitive}
        onChange={setIncludeSensitive}
        label="민감 정보 포함"
        description="건강·가족 같은 민감 등급 팩트도 넣어요. 켜면 본인 확인을 거쳐요."
      />

      <SectionHeader title="미리보기" />
      {selected.length === 0 ? (
        <Card>
          <Text variant="body" tone="secondary">
            페르소나를 하나 이상 골라 주세요.
          </Text>
        </Card>
      ) : pack.isPending ? (
        <Card style={{ gap: 8 }}>
          <Skeleton />
          <Skeleton width="85%" />
          <Skeleton width="60%" />
        </Card>
      ) : pack.isError ? (
        <InlineBanner tone="error" message={errorMessage(pack.error)} />
      ) : text ? (
        <Card style={{ gap: 8 }}>
          <Text variant="body" selectable>
            {text}
          </Text>
          <Text variant="caption" tone="secondary">
            {text.length}자{pack.data?.fact_count != null ? ` · 팩트 ${pack.data.fact_count}개` : ''}
          </Text>
        </Card>
      ) : (
        <Card>
          <Text variant="body" tone="secondary">
            복사할 팩트가 없어요. 페르소나에 팩트를 먼저 추가해 주세요.
          </Text>
        </Card>
      )}
    </Screen>
  );
}
