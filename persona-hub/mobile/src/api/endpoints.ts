import { request } from './client';
import { randomId, tokenStore } from './tokenStore';
import type {
  AccessLog,
  AccessLogQuery,
  CommitRequest,
  Connection,
  ConnectionPatch,
  ConnectGuide,
  ConsentsPatch,
  ContextPack,
  ContextPackRequest,
  ExportJob,
  ExtractResponse,
  Fact,
  FactCreate,
  FactPatch,
  Interview,
  InterviewAnswer,
  LoginRequest,
  Me,
  Paginated,
  Persona,
  PersonaCreate,
  PersonaPatch,
  Sensitivity,
  Category,
  Template,
  LoginResponse,
  CommitResponse,
} from './types';

export interface PageQuery {
  limit?: number;
  cursor?: string | null;
}

/** Thin 1:1 wrappers over /v1. Screens should prefer the hooks in ./hooks. */
export const api = {
  auth: {
    async login(body: LoginRequest) {
      const pair = await request<LoginResponse>('/auth/login', { method: 'POST', body, anonymous: true });
      // Flag first so the auth gate routes a new user straight into onboarding.
      if (pair.is_new_user) await tokenStore.setOnboardingPending(true);
      await tokenStore.setTokens(pair.access_token, pair.refresh_token);
      return pair;
    },
    async logout() {
      const refresh = await tokenStore.getRefresh();
      try {
        await request<void>('/auth/logout', { method: 'POST', body: { refresh_token: refresh } });
      } finally {
        await tokenStore.clear();
      }
    },
  },
  me: {
    get: () => request<Me>('/me'),
    patchConsents: (body: ConsentsPatch) => request<Me>('/me/consents', { method: 'PATCH', body }),
    /** 탈퇴 — requires step-up (handled by client). */
    delete: () => request<void>('/me', { method: 'DELETE' }),
  },
  personas: {
    list: (q: PageQuery & { archived?: boolean | 'all' } = {}) =>
      request<Paginated<Persona>>('/personas', { query: { limit: q.limit ?? 50, cursor: q.cursor, archived: q.archived === undefined ? undefined : String(q.archived) } }),
    get: (id: string) => request<Persona>(`/personas/${id}`),
    create: (body: PersonaCreate, idempotencyKey?: string) =>
      request<Persona>('/personas', { method: 'POST', body, idempotencyKey }),
    patch: (id: string, body: PersonaPatch, version: number) =>
      request<Persona>(`/personas/${id}`, { method: 'PATCH', body, version }),
    delete: (id: string) => request<void>(`/personas/${id}`, { method: 'DELETE' }),
  },
  facts: {
    list: (personaId: string, q: PageQuery & { sensitivity?: Sensitivity; category?: Category } = {}) =>
      request<Paginated<Fact>>(`/personas/${personaId}/facts`, {
        query: { limit: q.limit ?? 100, cursor: q.cursor, sensitivity: q.sensitivity, category: q.category },
      }),
    create: (personaId: string, body: FactCreate, idempotencyKey?: string) =>
      request<Fact>(`/personas/${personaId}/facts`, { method: 'POST', body, idempotencyKey }),
    patch: (id: string, body: FactPatch, version: number) =>
      request<Fact>(`/facts/${id}`, { method: 'PATCH', body, version }),
    delete: (id: string) => request<void>(`/facts/${id}`, { method: 'DELETE' }),
  },
  templates: {
    list: () => request<Paginated<Template>>('/templates'),
  },
  interviews: {
    start: (template_id: string, persona_id?: string) =>
      request<Interview>('/interviews', { method: 'POST', body: { template_id, persona_id } }),
    /** Saves one answer immediately (partial progress survives leaving). Skipping = not answering. */
    answer: (id: string, body: Pick<InterviewAnswer, 'question_id' | 'text'>) =>
      request<Interview>(`/interviews/${id}/answers`, { method: 'POST', body }),
    extract: (id: string) => request<ExtractResponse>(`/interviews/${id}/extract`, { method: 'POST', body: {} }),
    commit: (id: string, body: CommitRequest, idempotencyKey?: string) =>
      request<CommitResponse>(`/interviews/${id}/commit`, { method: 'POST', body, idempotencyKey }),
  },
  contextPacks: {
    create: (body: ContextPackRequest) => request<ContextPack>('/context-packs', { method: 'POST', body }),
  },
  connections: {
    list: (q: PageQuery = {}) => request<Paginated<Connection>>('/connections', { query: { limit: q.limit ?? 50, cursor: q.cursor } }),
    get: (id: string) => request<Connection>(`/connections/${id}`),
    patch: (id: string, body: ConnectionPatch, version: number) =>
      request<Connection>(`/connections/${id}`, { method: 'PATCH', body, version }),
    /** 연결 해제 — tokens revoked immediately. */
    delete: (id: string, version?: number) => request<void>(`/connections/${id}`, { method: 'DELETE', version }),
  },
  connectGuides: {
    list: () => request<Paginated<ConnectGuide>>('/connect-guides'),
  },
  accessLogs: {
    list: (q: PageQuery & AccessLogQuery = {}) =>
      request<Paginated<AccessLog>>('/access-logs', { query: { limit: q.limit ?? 20, cursor: q.cursor, connection_id: q.connection_id, from: q.from, to: q.to } }),
  },
  exports: {
    create: () => request<ExportJob>('/exports', { method: 'POST', body: {} }),
    get: (id: string) => request<ExportJob>(`/exports/${id}`),
  },
};

export { randomId };
