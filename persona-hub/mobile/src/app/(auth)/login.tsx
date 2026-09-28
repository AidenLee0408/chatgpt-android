/** S-01 스플래시·로그인 */
import { View } from 'react-native';
import { DEV_LOGIN, errorMessage, tokenStore, useLogin, type LoginProvider } from '../../api';
import { Button, InlineBanner, Screen, useToast } from '../../components';
import { Text, useTheme } from '../../theme';
import { useState } from 'react';
import { Feather } from '@expo/vector-icons';

const PROVIDERS: { id: Exclude<LoginProvider, 'dev'>; label: string }[] = [
  { id: 'kakao', label: '카카오로 시작하기' },
  { id: 'apple', label: 'Apple로 시작하기' },
  { id: 'google', label: 'Google로 시작하기' },
];

export default function LoginScreen() {
  const t = useTheme();
  const toast = useToast();
  const login = useLogin();
  const [pending, setPending] = useState<string | null>(null);

  async function onPress(provider: (typeof PROVIDERS)[number]['id']) {
    if (!DEV_LOGIN) {
      // Real Kakao/Apple/Google SDKs are not wired yet (MVP task).
      toast.show('준비 중이에요. 곧 로그인할 수 있어요.');
      return;
    }
    setPending(provider);
    try {
      const id_token = await tokenStore.getDeviceId();
      await login.mutateAsync({ provider: 'dev', id_token });
      // AuthGate routes onward: new user → onboarding, returning user → tabs.
    } catch {
      // error shown via login.error
    } finally {
      setPending(null);
    }
  }

  return (
    <Screen edges={['top', 'bottom']} scroll>
      <View style={{ flex: 1, justifyContent: 'center', gap: 16, paddingTop: 48 }}>
        <View
          style={{ width: 64, height: 64, borderRadius: 20, backgroundColor: t.color.persona[1], alignItems: 'center', justifyContent: 'center' }}
          importantForAccessibility="no"
        >
          <Feather name="users" size={32} color={t.color.personaOn[1]} />
        </View>
        <Text variant="display" accessibilityRole="header">
          페르소나 허브
        </Text>
        <Text variant="body" tone="secondary">
          한 번 입력하면, 모든 AI가 나를 알아봐요. 무엇을 보여줄지는 내가 정해요.
        </Text>
      </View>
      <View style={{ gap: 12 }}>
        {login.isError ? <InlineBanner tone="error" message={errorMessage(login.error)} /> : null}
        {PROVIDERS.map((p) => (
          <Button
            key={p.id}
            label={p.label}
            variant={p.id === 'kakao' ? 'primary' : 'secondary'}
            loading={pending === p.id}
            disabled={pending !== null && pending !== p.id}
            onPress={() => onPress(p.id)}
          />
        ))}
        {DEV_LOGIN ? (
          <Text variant="caption" tone="secondary" style={{ textAlign: 'center' }}>
            개발 모드: 이 기기 전용 테스트 계정으로 로그인해요.
          </Text>
        ) : null}
        <Text variant="caption" tone="secondary" style={{ textAlign: 'center' }}>
          시작하면 이용약관과 개인정보 처리방침을 확인하게 돼요.
        </Text>
      </View>
    </Screen>
  );
}
