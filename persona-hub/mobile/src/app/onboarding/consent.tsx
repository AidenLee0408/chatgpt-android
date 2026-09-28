/**
 * S-03 개인정보 동의 — 필수 / 선택 / 민감정보 분리.
 * 필수(terms) is recorded by the server at signup (consents.terms); the checkbox
 * here is the explicit UI confirmation. 선택 → marketing, 민감 → sensitive_data via PATCH /me/consents.
 */
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { errorMessage, useMe, usePatchConsents } from '../../api';
import { Button, Card, Checkbox, ErrorState, InlineBanner, Screen, SkeletonList } from '../../components';
import { useSession } from '../../state/session';
import { Text } from '../../theme';

export default function ConsentScreen() {
  const me = useMe();
  const patch = usePatchConsents();
  const { setOnboardingPending } = useSession();
  const [required, setRequired] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [sensitive, setSensitive] = useState(false);

  useEffect(() => {
    if (me.data?.consents) {
      setMarketing(!!me.data.consents.marketing);
      setSensitive(!!me.data.consents.sensitive_data);
    }
  }, [me.data]);

  if (me.isPending) return <Screen><SkeletonList rows={3} /></Screen>;
  if (me.isError) return <Screen><ErrorState message={errorMessage(me.error)} onRetry={() => me.refetch()} /></Screen>;

  async function submit() {
    try {
      await patch.mutateAsync({ marketing, sensitive_data: sensitive });
      setOnboardingPending(false);
      router.replace('/onboarding/templates');
    } catch {
      /* banner */
    }
  }

  return (
    <Screen footer={<Button label="동의하고 계속하기" disabled={!required} loading={patch.isPending} onPress={submit} />}>
      <Text variant="display" accessibilityRole="header">
        정보를 이렇게 다뤄요
      </Text>
      <Text variant="body" tone="secondary">
        필수 항목만 동의해도 쓸 수 있어요. 선택·민감정보 동의는 설정에서 언제든 바꿀 수 있어요.
      </Text>
      {patch.isError ? <InlineBanner tone="error" message={errorMessage(patch.error)} /> : null}
      <Card style={{ gap: 4 }}>
        <Text variant="label" tone="secondary">필수</Text>
        <Checkbox
          checked={required}
          onChange={setRequired}
          label="[필수] 이용약관 및 개인정보 수집·이용"
          description="계정, 내가 입력한 페르소나와 팩트를 저장하고, 내가 허용한 AI에게만 전달해요."
        />
      </Card>
      <Card style={{ gap: 4 }}>
        <Text variant="label" tone="secondary">선택</Text>
        <Checkbox checked={marketing} onChange={setMarketing} label="[선택] 새 기능·소식 알림" description="새 기능과 서비스 소식을 알려 드려요." />
      </Card>
      <Card style={{ gap: 4 }}>
        <Text variant="label" tone="secondary">민감정보</Text>
        <Checkbox
          checked={sensitive}
          onChange={setSensitive}
          label="[선택] 민감정보 처리"
          description="건강·가족 같은 민감 등급 팩트를 저장해요. 동의하지 않으면 민감 등급 팩트는 저장할 수 없어요. 민감 정보는 '민감 포함'을 켠 연결에만 보여요."
        />
      </Card>
      <Text variant="caption" tone="secondary">
        비공개 정보는 어떤 AI에게도 전달되지 않아요. 연결은 언제든 앱에서 끊을 수 있어요.
      </Text>
    </Screen>
  );
}
