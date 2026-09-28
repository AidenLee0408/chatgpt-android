/** S-04 템플릿 선택 — GET /templates → POST /interviews */
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { errorMessage, useStartInterview, useTemplates } from '../../api';
import { Button, Card, EmptyState, ErrorState, InlineBanner, PersonaAvatar, Screen, SkeletonList } from '../../components';
import { Text, useTheme } from '../../theme';

export default function TemplatesScreen() {
  const t = useTheme();
  const templates = useTemplates();
  const start = useStartInterview();
  const [selected, setSelected] = useState<string | null>(null);

  async function begin() {
    if (!selected) return;
    try {
      const iv = await start.mutateAsync({ templateId: selected });
      router.push({ pathname: '/onboarding/interview/[id]', params: { id: iv.id, templateId: selected } });
    } catch {
      /* banner */
    }
  }

  return (
    <Screen
      footer={
        <>
          <Button label="이 템플릿으로 인터뷰 시작" disabled={!selected} loading={start.isPending} onPress={begin} />
          <Button variant="ghost" label="나중에 만들게요" onPress={() => router.replace('/personas')} />
        </>
      }
    >
      <Text variant="display" accessibilityRole="header">
        어떤 나부터 만들까요?
      </Text>
      <Text variant="body" tone="secondary">
        질문 5~7개에 답하면 3분 안에 첫 번째 페르소나가 만들어져요.
      </Text>
      {start.isError ? <InlineBanner tone="error" message={errorMessage(start.error)} /> : null}
      {templates.isPending ? (
        <SkeletonList rows={3} />
      ) : templates.isError ? (
        <ErrorState message={errorMessage(templates.error)} onRetry={() => templates.refetch()} />
      ) : templates.data.length === 0 ? (
        <EmptyState icon="file-text" title="준비된 템플릿이 없어요" body="빈 페르소나로 시작할 수 있어요." actionLabel="페르소나 목록으로 가기" onAction={() => router.replace('/personas')} />
      ) : (
        <View style={{ gap: 12 }}>
          {templates.data.map((tpl) => {
            const isSel = selected === tpl.id;
            return (
              <Card
                key={tpl.id}
                selected={isSel}
                onPress={() => setSelected(tpl.id)}
                accessibilityLabel={`${tpl.name}. ${tpl.description}. 질문 ${tpl.questions.length}개${isSel ? ', 선택됨' : ''}`}
                style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}
              >
                <PersonaAvatar id={tpl.id} icon={tpl.icon} size={48} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="headline">{tpl.name}</Text>
                  <Text variant="caption" tone="secondary">
                    {tpl.description}
                  </Text>
                  <Text variant="label" tone="secondary">
                    질문 {tpl.questions.length}개
                  </Text>
                </View>
                {isSel ? <Feather name="check-circle" size={22} color={t.color.brand.primary} /> : null}
              </Card>
            );
          })}
        </View>
      )}
    </Screen>
  );
}
