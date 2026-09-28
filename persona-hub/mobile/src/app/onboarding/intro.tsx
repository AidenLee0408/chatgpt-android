/** S-02 가치 소개 3장 */
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Button, Screen } from '../../components';
import type { IconName } from '../../copy/labels';
import { Text, useTheme, type PersonaColorIndex } from '../../theme';

const SLIDES: { icon: IconName; color: PersonaColorIndex; title: string; body: string }[] = [
  { icon: 'repeat', color: 1, title: '한 번 입력, 모든 AI', body: 'Claude, ChatGPT에게 매번 자기소개하지 않아도 돼요. 한 번 적어 두면 AI가 필요할 때 읽어 가요.' },
  { icon: 'layers', color: 2, title: '페르소나로 나눠요', body: '업무의 나, 건강한 나를 따로 만들어요. 업무용 AI에게 건강 정보가 새지 않아요.' },
  { icon: 'shield', color: 4, title: '내가 통제해요', body: '어떤 AI가 무엇을 읽었는지 언제든 보고, 범위를 줄이거나 연결을 끊을 수 있어요.' },
];

export default function IntroScreen() {
  const t = useTheme();
  const [i, setI] = useState(0);
  const s = SLIDES[i];
  const last = i === SLIDES.length - 1;
  return (
    <Screen
      edges={['top', 'bottom']}
      footer={
        <>
          <Button label={last ? '동의하고 시작하기' : '다음'} onPress={() => (last ? router.push('/onboarding/consent') : setI(i + 1))} />
          {!last ? <Button variant="ghost" label="건너뛰기" onPress={() => router.push('/onboarding/consent')} /> : null}
        </>
      }
    >
      <View style={{ flex: 1, justifyContent: 'center', gap: 24 }} accessibilityLiveRegion="polite">
        <View
          importantForAccessibility="no"
          style={{ width: 96, height: 96, borderRadius: 32, backgroundColor: t.color.persona[s.color], alignItems: 'center', justifyContent: 'center' }}
        >
          <Feather name={s.icon} size={44} color={t.color.personaOn[s.color]} />
        </View>
        <Text variant="display" accessibilityRole="header">
          {s.title}
        </Text>
        <Text variant="body" tone="secondary">
          {s.body}
        </Text>
        <View style={{ flexDirection: 'row', gap: 6 }} accessible accessibilityLabel={`${SLIDES.length}장 중 ${i + 1}번째`}>
          {SLIDES.map((_, k) => (
            <View key={k} style={{ width: k === i ? 20 : 6, height: 6, borderRadius: 3, backgroundColor: k === i ? t.color.brand.primary : t.color.skeleton }} />
          ))}
        </View>
      </View>
    </Screen>
  );
}
