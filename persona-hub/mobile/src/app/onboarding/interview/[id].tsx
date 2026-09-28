/**
 * S-05 인터뷰 질문 — 한 화면 한 질문, 진행 바, 건너뛰기.
 * Each answer is POSTed immediately, so leaving mid-way keeps progress ("여기까지로 만들기").
 * Skipping = not answering (the server has no skip marker).
 */
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { errorMessage, isApiError, useAnswerInterview, useTemplates } from '../../../api';
import { Button, EmptyState, ErrorState, InlineBanner, ProgressBar, Screen, SkeletonList, TextField } from '../../../components';
import { Text } from '../../../theme';

export default function InterviewScreen() {
  const { id, templateId } = useLocalSearchParams<{ id: string; templateId: string }>();
  const templates = useTemplates();
  const answer = useAnswerInterview();
  const template = useMemo(() => templates.data?.find((x) => x.id === templateId), [templates.data, templateId]);
  const [index, setIndex] = useState(0);
  /** Local copy of answers — kept even when the network fails. */
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [answeredCount, setAnsweredCount] = useState(0);
  const [netError, setNetError] = useState<string | null>(null);

  if (templates.isPending) return <Screen><SkeletonList rows={1} /></Screen>;
  if (templates.isError) return <Screen><ErrorState message={errorMessage(templates.error)} onRetry={() => templates.refetch()} /></Screen>;
  if (!template || template.questions.length === 0)
    return (
      <Screen>
        <EmptyState icon="help-circle" title="질문을 찾지 못했어요" body="템플릿을 다시 골라 주세요." actionLabel="템플릿 다시 고르기" onAction={() => router.back()} />
      </Screen>
    );

  const questions = template.questions;
  const q = questions[index];
  const value = drafts[q.id] ?? '';
  const isLast = index === questions.length - 1;

  const goReview = () => router.replace({ pathname: '/onboarding/review/[id]', params: { id, templateId } });

  const advance = () => (isLast ? (answeredCount > 0 ? goReview() : router.back()) : setIndex(index + 1));

  async function submit(skipped: boolean) {
    setNetError(null);
    if (skipped) return advance();
    try {
      await answer.mutateAsync({ id, answer: { question_id: q.id, text: value.trim() } });
      setAnsweredCount((c) => c + 1);
      if (isLast) goReview();
      else setIndex(index + 1);
    } catch (e) {
      setNetError(
        isApiError(e) && e.code === 'network_error'
          ? '연결이 불안정해요. 저장하지 못한 내용은 기기에 보관해 뒀어요.'
          : errorMessage(e),
      );
    }
  }

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () =>
            answeredCount > 0 ? (
              <Button variant="ghost" fullWidth={false} label="여기까지로 만들기" onPress={goReview} />
            ) : null,
        }}
      />
      <Screen
        footer={
          <>
            <Button label={isLast ? '답변 마치고 팩트 보기' : '다음 질문'} disabled={!value.trim()} loading={answer.isPending} onPress={() => submit(false)} />
            <Button variant="ghost" label="이 질문 건너뛰기" disabled={answer.isPending} onPress={() => submit(true)} />
          </>
        }
      >
        <View style={{ gap: 8 }}>
          <ProgressBar value={(index + 1) / questions.length} label={`질문 ${questions.length}개 중 ${index + 1}번째`} />
          <Text variant="caption" tone="secondary">
            {index + 1} / {questions.length}
          </Text>
        </View>
        <Text variant="display" accessibilityRole="header">
          {q.text}
        </Text>
        {netError ? <InlineBanner tone="error" message={netError} actionLabel="다시 저장" onAction={() => submit(false)} /> : null}
        <TextField
          key={q.id}
          label="내 답변"
          value={value}
          onChangeText={(v) => setDrafts({ ...drafts, [q.id]: v })}
          multiline
          maxLength={2000}
          placeholder={q.hint || '편하게 적어 주세요'}
          helper="모르는 건 건너뛰어도 괜찮아요."
          autoFocus
        />
      </Screen>
    </>
  );
}
