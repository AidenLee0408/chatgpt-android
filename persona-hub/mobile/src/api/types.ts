/**
 * Wire types for the app REST API (/v1). snake_case exactly as on the wire.
 * Source: docs/specs/api-mcp-poc.txt, aligned with persona-hub/server/src/api/v1.ts
 * (serializers + zod schemas) where the spec leaves shapes open.
 */

export type Sensitivity = 'normal' | 'sensitive' | 'private';
export type Category = 'profile' | 'work' | 'interest' | 'health' | 'finance' | 'preference' | 'other';
export type FactSource = 'manual' | 'interview' | 'ai_suggestion' | 'import';
export type ConnectionStatus = 'active' | 'expired' | 'revoked';

export const SENSITIVITIES: Sensitivity[] = ['normal', 'sensitive', 'private'];
export const CATEGORIES: Category[] = ['profile', 'work', 'interest', 'health', 'finance', 'preference', 'other'];

export interface Paginated<T> {
  items: T[];
  next_cursor: string | null;
}

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode | (string & {});
    message: string;
    field?: string;
    request_id?: string;
  };
}

export type ApiErrorCode =
  | 'validation_failed'
  | 'fact_private_pattern'
  | 'token_expired'
  | 'step_up_required'
  | 'plan_limit_reached'
  | 'not_found'
  | 'version_conflict'
  | 'rate_limited'
  | 'internal'
  | 'network_error';

// ---- auth ----
export type LoginProvider = 'kakao' | 'apple' | 'google' | 'dev';
export interface LoginRequest {
  provider: LoginProvider;
  id_token: string;
}
export interface TokenPair {
  access_token: string;
  token_type?: 'Bearer';
  /** seconds (15 min) */
  expires_in: number;
  refresh_token: string;
  refresh_expires_in?: number;
}
export interface LoginResponse extends TokenPair {
  user_id: string;
  is_new_user: boolean;
  user: Me;
}
export interface StepUpRequest {
  method: 'biometric';
}
export interface StepUpResponse {
  step_up_token: string;
  /** seconds (5 min) */
  expires_in: number;
  expires_at?: string;
}

// ---- me ----
export interface Consents {
  /** 필수 (이용약관·개인정보 수집) — recorded by the server at signup. */
  terms: boolean;
  /** 민감정보 처리 동의 */
  sensitive_data: boolean;
  /** 선택 (소식·마케팅 알림) */
  marketing: boolean;
  updated_at?: string;
}
export interface Me {
  id: string;
  display_name: string;
  plan: 'free' | 'pro' | (string & {});
  limits: { max_personas: number };
  persona_count: number;
  consents: Consents;
  providers?: LoginProvider[];
  created_at?: string;
}
export type ConsentsPatch = Partial<Pick<Consents, 'sensitive_data' | 'marketing'>>;

// ---- personas ----
export interface Persona {
  id: string;
  name: string;
  icon: string;
  /** Optional 1..8 → color.persona.N. Derived from id when absent (server doesn't send it yet). */
  color?: number | null;
  /** 한 줄 설명 */
  description: string;
  instructions: string;
  archived: boolean;
  /** "페르소나 상세 + 팩트 요약 수" */
  fact_count?: number;
  fact_counts?: { total: number } & Record<Sensitivity, number>;
  /** Not sent by the server; the app computes it from GET /connections. */
  connection_count?: number;
  version: number;
  created_at?: string;
  updated_at: string;
}
export interface PersonaCreate {
  /** ≤30 */
  name: string;
  icon?: string;
  /** ≤100 */
  description?: string;
  /** ≤1000 */
  instructions?: string;
}
export type PersonaPatch = Partial<PersonaCreate & { archived: boolean }>;

// ---- facts ----
export interface Fact {
  id: string;
  persona_id: string;
  category: Category;
  body: string;
  sensitivity: Sensitivity;
  source: FactSource;
  version: number;
  created_at?: string;
  updated_at: string;
}
export interface FactCreate {
  category: Category;
  body: string;
  sensitivity: Sensitivity;
}
export type FactPatch = Partial<FactCreate>;

// ---- templates / interviews ----
export interface TemplateQuestion {
  id: string;
  text: string;
  hint: string;
  /** Default category for facts extracted from this answer. */
  category: Category;
}
export interface Template {
  id: string;
  name: string;
  icon: string;
  description: string;
  persona_defaults: { name: string; icon: string; description: string };
  questions: TemplateQuestion[];
}
export interface InterviewAnswer {
  question_id: string;
  text: string;
  answered_at?: string;
}
export interface FactCandidate {
  id: string;
  question_id: string | null;
  category: Category;
  body: string;
  /** Server/LLM recommendation — must be visible before save (F-03). */
  sensitivity: Sensitivity;
}
export interface Interview {
  id: string;
  template_id: string;
  persona_id: string | null;
  status: 'in_progress' | 'extracted' | 'committed';
  questions: Array<TemplateQuestion & { answered: boolean }>;
  answers: InterviewAnswer[];
  candidates: FactCandidate[];
  created_at: string;
  updated_at: string;
}
export interface ExtractResponse extends Interview {
  /** Answers the server refused to turn into facts (private pattern). */
  blocked: Array<{ question_id: string | null; reason: string }>;
}
export interface CommitRequest {
  /** Append into an existing persona instead of creating one. */
  persona_id?: string;
  /** Omit → server uses the template's persona_defaults. */
  persona?: PersonaCreate;
  facts: FactCreate[];
}
export interface CommitResponse {
  persona: Persona;
  facts: Fact[];
}

// ---- context packs ----
export type PackLength = 'short' | 'normal' | 'detailed';
export interface ContextPackRequest {
  persona_ids: string[];
  length: PackLength;
  include_sensitive: boolean;
  language?: 'ko' | 'en';
}
export interface ContextPack {
  text: string;
  char_count: number;
  language: 'ko' | 'en';
  length: PackLength;
  include_sensitive: boolean;
  persona_ids: string[];
  fact_count: number;
  omitted_fact_count?: number;
}

// ---- connections / logs / guides / exports (for 연결·활동·설정 tabs) ----
export interface Connection {
  id: string;
  client_id: string;
  client_name: string;
  /** Server currently emits active | revoked; 'expired' reserved by the spec. */
  status: ConnectionStatus;
  persona_ids: string[];
  personas: Array<{ id: string; name: string }>;
  max_sensitivity: Exclude<Sensitivity, 'private'>;
  version: number;
  created_at: string;
  last_accessed_at: string | null;
  revoked_at: string | null;
}
export interface ConnectionPatch {
  persona_ids?: string[];
  max_sensitivity?: Exclude<Sensitivity, 'private'>;
}
export interface AccessLog {
  id: string;
  connection: { id: string; client_name: string };
  tool: string;
  persona_ids: string[];
  fact_count: number;
  /** Only facts that still exist. */
  fact_ids: string[];
  created_at: string;
}
export interface AccessLogQuery {
  connection_id?: string;
  from?: string;
  to?: string;
}
export interface ConnectGuideStep {
  n: number;
  /** {MCP_URL} already substituted by the server. */
  text: string;
}
export interface ConnectGuide {
  client: 'claude' | 'chatgpt' | 'gemini' | (string & {});
  name: string;
  requirements: string;
  supported: boolean;
  note?: string;
  mcp_url: string;
  steps: ConnectGuideStep[];
}
export interface ExportJob {
  id: string;
  status: 'pending' | 'ready' | 'failed';
  created_at: string;
  /** Present on GET /exports/{id}; valid 10 minutes. */
  download_url?: string;
  download_expires_at?: string;
}
