import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, View } from 'react-native';
import { errorMessage, useAccessLogs, useConnections, usePersonas, type AccessLog, type Persona } from '../../api';
import { ChipGroup, EmptyState, ErrorState, InlineBanner, Screen, SkeletonList } from '../../components';
import { Text, useTheme } from '../../theme';
import { formatDate, formatTime, personaNames } from '../connections/format';
import { logSentence } from './logCopy';

type Range = 'all' | 'today' | '7d' | '30d';
const RANGES: { value: Range; label: string }[] = [
  { value: 'all', label: '전체 기간' },
  { value: 'today', label: '오늘' },
  { value: '7d', label: '7일' },
  { value: '30d', label: '30일' },
];

function rangeFrom(r: Range): string | undefined {
  if (r === 'all') return undefined;
  const d = new Date();
  if (r === 'today') d.setHours(0, 0, 0, 0);
  else d.setDate(d.getDate() - (r === '7d' ? 7 : 30));
  return d.toISOString();
}

type Row = { kind: 'day'; key: string; label: string } | { kind: 'log'; key: string; log: AccessLog };

/** S-14 활동 로그 */
export function ActivityScreen() {
  const t = useTheme();
  const params = useLocalSearchParams<{ connection_id?: string }>();
  const [connectionId, setConnectionId] = useState<string>(params.connection_id ?? '');
  const [range, setRange] = useState<Range>('all');
  // Deep links from 연결 상세 ("전체 활동 보기") arrive while this tab is already mounted.
  useEffect(() => {
    if (params.connection_id !== undefined) setConnectionId(params.connection_id);
  }, [params.connection_id]);
  // Memo the "from" so the query key is stable while the filter is unchanged.
  const from = useMemo(() => rangeFrom(range), [range]);
  const logs = useAccessLogs({ connection_id: connectionId || undefined, from });
  const connections = useConnections();
  const personas = usePersonas();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    let day = '';
    for (const l of logs.data?.pages.flatMap((p) => p.items) ?? []) {
      const d = formatDate(l.created_at);
      if (d !== day) {
        day = d;
        out.push({ kind: 'day', key: `d-${d}`, label: d === formatDate(new Date().toISOString()) ? '오늘' : d });
      }
      out.push({ kind: 'log', key: l.id, log: l });
    }
    return out;
  }, [logs.data]);

  const filters = (
    <View style={{ gap: 8, paddingBottom: 8 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} accessibilityLabel="연결 필터">
        {[{ id: '', client_name: '모든 AI' }, ...(connections.data ?? [])].map((c) => (
          <FilterChip key={c.id || 'all'} label={c.client_name} selected={connectionId === c.id} onPress={() => setConnectionId(c.id)} />
        ))}
      </ScrollView>
      <ChipGroup<Range> label="기간 필터" options={RANGES} value={range} onChange={setRange} />
    </View>
  );

  let body: React.ReactNode;
  if (logs.isPending) {
    body = (
      <View accessibilityLabel="활동 기록 불러오는 중">
        <SkeletonList rows={4} />
      </View>
    );
  } else if (logs.isError) {
    body = <ErrorState message={errorMessage(logs.error)} onRetry={() => logs.refetch()} />;
  } else if (rows.length === 0) {
    const noConnections = connections.data?.length === 0;
    const filtered = !!connectionId || range !== 'all';
    body = noConnections ? (
      <EmptyState icon="link-2" title="아직 연결한 AI가 없어요" body="AI를 연결하면 더 이상 자기소개를 반복하지 않아도 돼요." />
    ) : filtered ? (
      <EmptyState icon="filter" title="이 조건에 맞는 기록이 없어요" actionLabel="필터 초기화" onAction={() => { setConnectionId(''); setRange('all'); }} />
    ) : (
      <EmptyState icon="activity" title="아직 조회가 없어요" body="연결은 됐지만 아직 조회가 없어요. AI에게 '내 페르소나 보고 답해줘'라고 말해 보세요." />
    );
  }

  return (
    <Screen scroll={false} contentStyle={{ paddingBottom: 0 }}>
      {body ? (
        <View style={{ flex: 1, gap: 16 }}>
          {filters}
          {body}
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.key}
          ListHeaderComponent={filters}
          refreshing={logs.isRefetching && !logs.isFetchingNextPage}
          onRefresh={() => logs.refetch()}
          onEndReachedThreshold={0.4}
          onEndReached={() => logs.hasNextPage && !logs.isFetchingNextPage && logs.fetchNextPage()}
          ListFooterComponent={
            logs.isFetchingNextPage ? (
              <ActivityIndicator style={{ margin: 16 }} color={t.color.brand.primary} accessibilityLabel="더 불러오는 중" />
            ) : logs.isFetchNextPageError ? (
              <InlineBanner tone="error" message="더 불러오지 못했어요." actionLabel="다시 시도" onAction={() => logs.fetchNextPage()} />
            ) : null
          }
          renderItem={({ item }) =>
            item.kind === 'day' ? (
              <Text variant="label" tone="secondary" accessibilityRole="header" style={{ marginTop: 16, marginBottom: 8 }}>
                {item.label}
              </Text>
            ) : (
              <LogRow
                log={item.log}
                personas={personas.data}
                expanded={expanded.has(item.log.id)}
                onToggle={() =>
                  setExpanded((s) => {
                    const n = new Set(s);
                    if (n.has(item.log.id)) n.delete(item.log.id);
                    else n.add(item.log.id);
                    return n;
                  })
                }
              />
            )
          }
        />
      )}
    </Screen>
  );
}

function FilterChip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${label} 기록만 보기`}
      style={{
        minHeight: t.layout.minTouch,
        paddingHorizontal: 16,
        justifyContent: 'center',
        borderRadius: t.radius.button,
        borderWidth: 1,
        borderColor: selected ? t.color.brand.primary : t.color.border,
        backgroundColor: selected ? t.color.brand.primary : t.color.bg.surface,
      }}
    >
      <Text variant="body" style={{ color: selected ? t.color.brand.onPrimary : t.color.text.primary }}>
        {label}
      </Text>
    </Pressable>
  );
}

const TOOL_LABEL: Record<string, string> = {
  list_personas: '페르소나 목록 조회',
  get_persona: '페르소나 읽기',
  search_facts: '팩트 검색',
};

function LogRow({ log, personas, expanded, onToggle }: { log: AccessLog; personas: Persona[] | undefined; expanded: boolean; onToggle: () => void }) {
  const t = useTheme();
  const sentence = logSentence(log, personas);
  const names = personaNames(log.persona_ids, personas);
  return (
    <View style={{ flexDirection: 'row', gap: 12 }}>
      {/* timeline rail */}
      <View style={{ alignItems: 'center', width: 12 }}>
        <View style={{ width: 10, height: 10, borderRadius: 5, marginTop: 19, backgroundColor: t.color.brand.primary }} />
        <View style={{ flex: 1, width: 2, backgroundColor: t.color.border }} />
      </View>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${formatTime(log.created_at)}, ${sentence}`}
        accessibilityHint={expanded ? '자세한 내용 접기' : '읽은 팩트 수와 페르소나 보기'}
        style={({ pressed }) => ({
          flex: 1,
          minHeight: t.layout.minTouch,
          padding: 12,
          marginBottom: 8,
          borderRadius: t.radius.card,
          borderWidth: 1,
          borderColor: t.color.border,
          backgroundColor: t.color.bg.surface,
          opacity: pressed ? 0.85 : 1,
          gap: 6,
        })}
      >
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="body">{sentence}</Text>
            <Text variant="caption" tone="secondary">
              {formatTime(log.created_at)}
            </Text>
          </View>
          <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={20} color={t.color.text.secondary} />
        </View>
        {expanded ? (
          <View style={{ gap: 4, paddingTop: 6, borderTopWidth: 1, borderTopColor: t.color.border }}>
            <Text variant="caption" tone="secondary">
              도구: {TOOL_LABEL[log.tool] ?? log.tool}
            </Text>
            <Text variant="caption" tone="secondary">
              읽은 팩트: {log.fact_count}개
            </Text>
            <Text variant="caption" tone="secondary">
              페르소나: {names.length ? names.join(', ') : '없음'}
            </Text>
          </View>
        ) : null}
      </Pressable>
    </View>
  );
}
