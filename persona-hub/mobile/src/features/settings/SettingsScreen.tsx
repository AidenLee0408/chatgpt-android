import { Feather } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Linking, Pressable, Share, Switch, View } from 'react-native';
import {
  errorMessage,
  isApiError,
  performStepUp,
  tokenStore,
  useCreateExport,
  useDeleteAccount,
  useExportJob,
  useLogout,
  useMe,
} from '../../api';
import type { IconName } from '../../copy/labels';
import { Button, Card, ConfirmSheet, ErrorState, InlineBanner, Screen, SectionHeader, Skeleton, useToast } from '../../components';
import { Text, useTheme } from '../../theme';
import { authenticate, biometricAvailability, setAppLockEnabled, useAppLockSetting } from './appLock';

const PLAN_LABEL: Record<string, string> = { free: '무료', pro: '프로' };

/** S-15 설정 */
export function SettingsScreen() {
  const me = useMe();
  const toast = useToast();
  const logout = useLogout();
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const del = useDeleteAccount();

  const doLogout = () =>
    logout.mutate(undefined, {
      onSettled: () => setLogoutOpen(false),
    });
  const doDelete = async () => {
    try {
      await performStepUp('계정을 삭제하려면 본인 확인이 필요해요');
      await del.mutateAsync();
      setDeleteOpen(false);
      await tokenStore.clear();
    } catch (e) {
      if (!(isApiError(e) && e.code === 'step_up_cancelled')) toast.show(errorMessage(e));
    }
  };

  return (
    <Screen refreshing={me.isRefetching} onRefresh={() => me.refetch()}>
      <SectionHeader title="계정" />
      {me.isPending ? (
        <View accessibilityLabel="계정 정보 불러오는 중">
          <Skeleton height={72} radius={16} />
        </View>
      ) : me.isError ? (
        <ErrorState message={errorMessage(me.error)} onRetry={() => me.refetch()} />
      ) : (
        <Card>
          <View style={{ gap: 12 }}>
            <View accessible style={{ gap: 2 }}>
              <Text variant="headline">{me.data.display_name || '이름 없음'}</Text>
              <Text variant="caption" tone="secondary">
                요금제 · {PLAN_LABEL[me.data.plan] ?? me.data.plan}
                {` (페르소나 ${me.data.limits.max_personas}개까지)`}
              </Text>
            </View>
          </View>
        </Card>
      )}

      <SectionHeader title="보안" />
      <BiometricRow />

      <SectionHeader title="내 데이터" />
      <ExportCard />

      <View style={{ gap: 8, marginTop: 16 }}>
        <Button label="로그아웃" variant="secondary" icon="log-out" onPress={() => setLogoutOpen(true)} />
        <Button label="계정 삭제" variant="ghost" icon="trash-2" onPress={() => setDeleteOpen(true)} accessibilityHint="본인 확인 후 계정을 삭제해요" />
      </View>

      <ConfirmSheet
        visible={logoutOpen}
        title="로그아웃할까요?"
        body="이 기기에서만 로그아웃돼요. AI 연결은 그대로 유지돼요."
        confirmLabel="로그아웃"
        danger={false}
        loading={logout.isPending}
        onConfirm={doLogout}
        onCancel={() => setLogoutOpen(false)}
      />
      <ConfirmSheet
        visible={deleteOpen}
        title="계정을 삭제할까요?"
        body="모든 AI 연결이 즉시 끊기고, 페르소나와 팩트는 30일 안에 완전히 파기돼요. 되돌릴 수 없어요."
        confirmLabel="본인 확인 후 계정 삭제"
        loading={del.isPending}
        onConfirm={doDelete}
        onCancel={() => setDeleteOpen(false)}
      />
    </Screen>
  );
}

function BiometricRow() {
  const t = useTheme();
  const toast = useToast();
  const enabled = useAppLockSetting();
  const [avail, setAvail] = useState<{ ok: boolean; reason?: string; label: string } | null>(null);
  useEffect(() => {
    biometricAvailability()
      .then(setAvail)
      .catch(() => setAvail({ ok: false, reason: '생체 인증 상태를 확인하지 못했어요', label: '생체 인증' }));
  }, []);

  const toggle = async (v: boolean) => {
    // Turning the lock on or off both require proving presence.
    const ok = await authenticate(v ? '생체 잠금을 켜려면 본인 확인이 필요해요' : '생체 잠금을 끄려면 본인 확인이 필요해요');
    if (!ok) return toast.show('본인 확인을 취소했어요');
    await setAppLockEnabled(v);
    toast.show(v ? '생체 잠금을 켰어요' : '생체 잠금을 껐어요');
  };
  const label = `${avail?.label ?? '생체'} 잠금`;
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: t.layout.minTouch }}>
        <Feather name="lock" size={20} color={t.color.text.secondary} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="body">{label}</Text>
          <Text variant="caption" tone="secondary">
            {avail && !avail.ok ? avail.reason : '앱을 열 때마다 본인 확인을 해요'}
          </Text>
        </View>
        {enabled === null || avail === null ? (
          <Skeleton width={48} height={28} radius={14} />
        ) : (
          <Switch
            value={enabled}
            onValueChange={toggle}
            disabled={!avail.ok && !enabled}
            accessibilityLabel={label}
            trackColor={{ true: t.color.brand.primary, false: t.color.skeleton }}
            style={{ minHeight: t.layout.minTouch }}
          />
        )}
      </View>
    </Card>
  );
}

function ExportCard() {
  const t = useTheme();
  const toast = useToast();
  const create = useCreateExport();
  const [jobId, setJobId] = useState<string>();
  const job = useExportJob(jobId);

  const start = () =>
    create.mutate(undefined, {
      onSuccess: (j) => setJobId(j.id),
      onError: (e) => {
        if (!(isApiError(e) && e.code === 'step_up_cancelled')) toast.show(errorMessage(e));
      },
    });
  const url = job.data?.status === 'ready' ? job.data.download_url : null;
  const open = async () => {
    if (!url) return;
    try {
      await Linking.openURL(url);
    } catch {
      toast.show('파일을 열지 못했어요');
    }
  };
  const share = async () => {
    if (!url) return;
    try {
      await Share.share({ url, message: url, title: '페르소나 허브 내보내기' });
    } catch {
      toast.show('공유하지 못했어요');
    }
  };

  const pending = create.isPending || (jobId && (job.isPending || job.data?.status === 'pending'));
  let status: React.ReactNode = null;
  if (pending) status = <InlineBanner message="내보낼 파일을 만들고 있어요. 잠시만 기다려 주세요." />;
  else if (job.isError || job.data?.status === 'failed')
    status = (
      <InlineBanner
        tone="error"
        message={job.isError ? errorMessage(job.error) : '파일을 만들지 못했어요.'}
        actionLabel="다시 시도"
        onAction={() => {
          setJobId(undefined);
          start();
        }}
      />
    );
  else if (url)
    status = (
      <View style={{ gap: 8 }}>
        <Text variant="caption" tone="secondary">
          다운로드 링크는 10분 동안만 열 수 있어요.
        </Text>
        <Button label="파일 열기" icon="download" onPress={open} />
        <Button label="공유" variant="secondary" icon="share" onPress={share} />
      </View>
    );

  return (
    <Card>
      <View style={{ gap: 12 }}>
        <Row icon="file-text" title="JSON 내보내기" body="페르소나와 팩트 전체를 파일로 받아요. 본인 확인이 필요해요." />
        {status}
        {!url && !pending ? (
          <Button label={jobId ? '다시 내보내기' : '내보내기'} variant="secondary" onPress={() => { setJobId(undefined); start(); }} />
        ) : null}
        {url ? (
          <Pressable
            onPress={() => { setJobId(undefined); start(); }}
            accessibilityRole="button"
            accessibilityLabel="새로 내보내기"
            style={{ minHeight: t.layout.minTouch, justifyContent: 'center', alignItems: 'center' }}
          >
            <Text variant="caption" tone="brand">
              새로 내보내기
            </Text>
          </Pressable>
        ) : null}
      </View>
    </Card>
  );
}

function Row({ icon, title, body }: { icon: IconName; title: string; body: string }) {
  const t = useTheme();
  return (
    <View accessible style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
      <Feather name={icon} size={20} color={t.color.text.secondary} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="body">{title}</Text>
        <Text variant="caption" tone="secondary">
          {body}
        </Text>
      </View>
    </View>
  );
}
