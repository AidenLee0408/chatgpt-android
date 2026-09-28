import { Feather } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, Share, View } from 'react-native';
import { errorMessage, useConnectGuides, type ConnectGuide } from '../../api';
import { Button, Card, EmptyState, ErrorState, Screen, SectionHeader, SkeletonList, useToast } from '../../components';
import { Text, useTheme } from '../../theme';
import { ClientLogo } from './ClientLogo';
import { CLIENT_APPS, clientKey } from './format';

/** S-12 새 연결 가이드: AI 선택 → 단계 → MCP URL 복사 → 앱 열기 / PC에서 연결하기 */
export function ConnectGuideScreen() {
  const params = useLocalSearchParams<{ client?: string }>();
  const q = useConnectGuides();
  const [picked, setPicked] = useState<string | undefined>(params.client);

  const header = <Stack.Screen options={{ title: '새 연결' }} />;
  if (q.isPending) {
    return (
      <Screen>
        {header}
        <View accessibilityLabel="연결 가이드 불러오는 중">
          <SkeletonList rows={3} />
        </View>
      </Screen>
    );
  }
  if (q.isError) {
    return (
      <Screen>
        {header}
        <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
      </Screen>
    );
  }
  if (q.data.length === 0) {
    return (
      <Screen>
        {header}
        <EmptyState icon="compass" title="연결 가이드를 준비 중이에요" body="잠시 후 다시 확인해 주세요." actionLabel="다시 불러오기" onAction={() => q.refetch()} />
      </Screen>
    );
  }
  const guide = q.data.find((g) => clientKey(g.client) === clientKey(picked ?? '') || clientKey(g.name) === clientKey(picked ?? ''));
  return (
    <>
      {header}
      {guide ? <GuideSteps guide={guide} onBack={() => setPicked(undefined)} /> : <ClientPicker guides={q.data} onPick={setPicked} />}
    </>
  );
}

function ClientPicker({ guides, onPick }: { guides: ConnectGuide[]; onPick: (c: string) => void }) {
  const t = useTheme();
  return (
    <Screen>
      <Text variant="title" accessibilityRole="header">
        어떤 AI와 연결할까요?
      </Text>
      <Text variant="body" tone="secondary">
        처음엔 가장 좁은 범위로 연결돼요. 볼 수 있는 페르소나는 연결 후에 언제든 바꿀 수 있어요.
      </Text>
      {guides.map((g) => (
        <Card key={g.client} onPress={() => onPick(g.client)} accessibilityLabel={`${g.name} 연결하기`}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <ClientLogo name={g.name} />
            <Text variant="headline" style={{ flex: 1 }}>
              {g.name}
            </Text>
            <Feather name="chevron-right" size={20} color={t.color.text.secondary} />
          </View>
        </Card>
      ))}
    </Screen>
  );
}

function GuideSteps({ guide, onBack }: { guide: ConnectGuide; onBack: () => void }) {
  const t = useTheme();
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const app = CLIENT_APPS[clientKey(guide.client)] ?? CLIENT_APPS[clientKey(guide.name)];

  const copy = async (text: string, msg: string) => {
    await Clipboard.setStringAsync(text);
    toast.show(msg);
  };
  const copyUrl = async () => {
    await copy(guide.mcp_url, '주소를 복사했어요');
    setCopied(true);
  };
  const openApp = async () => {
    if (!app) return;
    try {
      await Linking.openURL(app.scheme);
    } catch {
      try {
        await Linking.openURL(app.web);
      } catch {
        toast.show(`${guide.name} 앱을 열지 못했어요`);
      }
    }
  };
  const sendToPc = async () => {
    try {
      await Share.share({
        title: `${guide.name} 연결하기`,
        message: `PC에서 ${guide.name} 설정 > 커넥터에 아래 주소를 추가하세요. 계정 단위 연결이라 휴대폰에도 그대로 적용돼요.\n\n${guide.mcp_url}`,
      });
    } catch {
      toast.show('공유하지 못했어요');
    }
  };

  return (
    <Screen
      footer={
        <>
          {app ? (
            <Button label={`${guide.name} 앱 열기`} icon="external-link" onPress={openApp} variant={copied ? 'primary' : 'secondary'} />
          ) : null}
          <Button label="PC에서 연결하기" variant="ghost" icon="monitor" onPress={sendToPc} accessibilityHint="이메일이나 메신저로 연결 주소를 보내요" />
        </>
      }
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <ClientLogo name={guide.name} />
        <Text variant="title" accessibilityRole="header" style={{ flex: 1 }}>
          {guide.name} 연결하기
        </Text>
        <Button label="다른 AI" variant="ghost" fullWidth={false} onPress={onBack} accessibilityLabel="다른 AI 선택" />
      </View>

      <Card>
        <View style={{ gap: 8 }}>
          <Text variant="label" tone="secondary">
            연결 주소 (MCP URL)
          </Text>
          <Text variant="body" selectable accessibilityLabel={`연결 주소 ${guide.mcp_url}`}>
            {guide.mcp_url}
          </Text>
          <Button label={copied ? '복사됨' : '주소 복사'} icon={copied ? 'check' : 'copy'} variant="secondary" onPress={copyUrl} />
        </View>
      </Card>

      <SectionHeader title="이렇게 연결해요" />
      {guide.steps.length === 0 ? (
        <Text variant="body" tone="secondary">
          단계 안내를 준비 중이에요. 주소를 복사해 {guide.name}의 커넥터 설정에 붙여 넣어 주세요.
        </Text>
      ) : (
        guide.steps.map((s, i) => (
          <View key={i} style={{ flexDirection: 'row', gap: 12 }} accessible accessibilityLabel={`${s.n ?? i + 1}단계. ${s.text}`}>
            <View
              style={{
                width: 28,
                height: 28,
                borderRadius: 14,
                backgroundColor: t.color.brand.primary,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text variant="label" style={{ color: t.color.brand.onPrimary }}>
                {i + 1}
              </Text>
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <Text variant="body">{s.text}</Text>
            </View>
          </View>
        ))
      )}
      <Text variant="caption" tone="secondary">
        동의를 마치면 앱으로 돌아와 연결을 확인할 수 있어요.
      </Text>
    </Screen>
  );
}
