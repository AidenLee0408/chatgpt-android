/**
 * React Query hooks, one group per resource. Query keys live in `qk` so
 * mutations can invalidate precisely. Every mutation invalidates what it touches.
 */
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { api } from './endpoints';
import type {
  AccessLogQuery,
  CommitRequest,
  ConnectionPatch,
  ConsentsPatch,
  ContextPackRequest,
  Fact,
  FactCreate,
  FactPatch,
  InterviewAnswer,
  LoginRequest,
  PersonaCreate,
  PersonaPatch,
} from './types';

export const qk = {
  me: ['me'] as const,
  personas: (archived = false) => ['personas', { archived }] as const,
  personasAll: ['personas'] as const,
  persona: (id: string) => ['persona', id] as const,
  facts: (personaId: string) => ['facts', personaId] as const,
  templates: ['templates'] as const,
  connections: ['connections'] as const,
  connection: (id: string) => ['connection', id] as const,
  connectGuides: ['connect-guides'] as const,
  accessLogs: (q: AccessLogQuery = {}) => ['access-logs', q] as const,
  accessLogsAll: ['access-logs'] as const,
  exportJob: (id: string) => ['export', id] as const,
};

// ---------- auth / me ----------
export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: LoginRequest) => api.auth.login(b),
    onSuccess: (res) => {
      qc.clear();
      qc.setQueryData(qk.me, res.user);
    },
  });
}
export function useLogout() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => api.auth.logout(), onSettled: () => qc.clear() });
}
export function useMe(enabled = true) {
  return useQuery({ queryKey: qk.me, queryFn: api.me.get, enabled });
}
export function usePatchConsents() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: ConsentsPatch) => api.me.patchConsents(b),
    onSuccess: (me) => qc.setQueryData(qk.me, me),
  });
}
export function useDeleteAccount() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => api.me.delete(), onSuccess: () => qc.clear() });
}

// ---------- personas ----------
export function usePersonas(archived = false) {
  return useQuery({
    queryKey: qk.personas(archived),
    queryFn: async () => (await api.personas.list({ archived })).items,
  });
}
export function usePersona(id: string | undefined) {
  return useQuery({ queryKey: qk.persona(id ?? ''), queryFn: () => api.personas.get(id!), enabled: !!id });
}
export function useCreatePersona() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { body: PersonaCreate; idempotencyKey?: string }) => api.personas.create(v.body, v.idempotencyKey),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.personasAll }),
  });
}
export function useUpdatePersona() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; version: number; body: PersonaPatch }) => api.personas.patch(v.id, v.body, v.version),
    onSuccess: (p) => {
      qc.setQueryData(qk.persona(p.id), p);
      qc.invalidateQueries({ queryKey: qk.personasAll });
    },
    onError: (_e, v) => qc.invalidateQueries({ queryKey: qk.persona(v.id) }),
  });
}
export function useDeletePersona() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.personas.delete(id),
    onSuccess: (_d, id) => {
      qc.removeQueries({ queryKey: qk.persona(id) });
      qc.invalidateQueries({ queryKey: qk.personasAll });
      qc.invalidateQueries({ queryKey: qk.connections });
    },
  });
}

// ---------- facts ----------
/**
 * Lists all facts of a persona. The server requires step-up when sensitive
 * facts are included; the client triggers biometric automatically on 401.
 */
export function useFacts(personaId: string | undefined) {
  return useQuery({
    queryKey: qk.facts(personaId ?? ''),
    queryFn: async () => {
      const all: Fact[] = [];
      let cursor: string | null = null;
      do {
        const page = await api.facts.list(personaId!, { cursor, limit: 100 });
        all.push(...page.items);
        cursor = page.next_cursor;
      } while (cursor);
      return all;
    },
    enabled: !!personaId,
  });
}
function invalidateFactScope(qc: QueryClient, personaId: string) {
  qc.invalidateQueries({ queryKey: qk.facts(personaId) });
  qc.invalidateQueries({ queryKey: qk.persona(personaId) });
  qc.invalidateQueries({ queryKey: qk.personasAll });
}
export function useCreateFact(personaId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { body: FactCreate; idempotencyKey?: string }) => api.facts.create(personaId, v.body, v.idempotencyKey),
    onSuccess: () => invalidateFactScope(qc, personaId),
  });
}
export function useUpdateFact(personaId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; version: number; body: FactPatch }) => api.facts.patch(v.id, v.body, v.version),
    onSettled: () => invalidateFactScope(qc, personaId),
  });
}
export function useDeleteFact(personaId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.facts.delete(id),
    onSuccess: () => invalidateFactScope(qc, personaId),
  });
}

// ---------- templates / interviews ----------
export function useTemplates() {
  return useQuery({ queryKey: qk.templates, queryFn: async () => (await api.templates.list()).items, staleTime: 10 * 60_000 });
}
export function useStartInterview() {
  return useMutation({ mutationFn: (v: { templateId: string; personaId?: string }) => api.interviews.start(v.templateId, v.personaId) });
}
export function useAnswerInterview() {
  return useMutation({
    mutationFn: (v: { id: string; answer: Pick<InterviewAnswer, 'question_id' | 'text'> }) => api.interviews.answer(v.id, v.answer),
  });
}
export function useExtractInterview() {
  return useMutation({ mutationFn: (id: string) => api.interviews.extract(id) });
}
export function useCommitInterview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; body: CommitRequest; idempotencyKey?: string }) =>
      api.interviews.commit(v.id, v.body, v.idempotencyKey),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.personasAll }),
  });
}

// ---------- context packs ----------
export function useCreateContextPack() {
  return useMutation({ mutationFn: (b: ContextPackRequest) => api.contextPacks.create(b) });
}

// ---------- connections (연결 탭) ----------
export function useConnections() {
  return useQuery({ queryKey: qk.connections, queryFn: async () => (await api.connections.list()).items });
}
export function useConnection(id: string | undefined) {
  return useQuery({ queryKey: qk.connection(id ?? ''), queryFn: () => api.connections.get(id!), enabled: !!id });
}
export function useUpdateConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; version: number; body: ConnectionPatch }) => api.connections.patch(v.id, v.body, v.version),
    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: qk.connection(v.id) });
      qc.invalidateQueries({ queryKey: qk.connections });
      qc.invalidateQueries({ queryKey: qk.personasAll });
    },
  });
}
export function useDeleteConnection() {
  const qc = useQueryClient();
  return useMutation({
    /** Pass the id, or { id, version } to send If-Match. */
    mutationFn: (v: string | { id: string; version?: number }) =>
      typeof v === 'string' ? api.connections.delete(v) : api.connections.delete(v.id, v.version),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.connections });
      qc.invalidateQueries({ queryKey: qk.personasAll });
    },
  });
}
export function useConnectGuides() {
  return useQuery({ queryKey: qk.connectGuides, queryFn: async () => (await api.connectGuides.list()).items });
}

// ---------- access logs (활동 탭) ----------
export function useAccessLogs(q: AccessLogQuery = {}) {
  return useInfiniteQuery({
    queryKey: qk.accessLogs(q),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api.accessLogs.list({ ...q, cursor: pageParam, limit: 20 }),
    getNextPageParam: (last) => last.next_cursor,
  });
}

// ---------- exports (설정 탭) ----------
export function useCreateExport() {
  return useMutation({ mutationFn: () => api.exports.create() });
}
export function useExportJob(id: string | undefined) {
  return useQuery({
    queryKey: qk.exportJob(id ?? ''),
    queryFn: () => api.exports.get(id!),
    enabled: !!id,
    refetchInterval: (q) => (q.state.data?.status === 'pending' ? 2000 : false),
  });
}
