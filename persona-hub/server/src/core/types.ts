// Shared domain types. Field names follow the API spec (snake_case on the wire).

export type Sensitivity = "normal" | "sensitive" | "private";
export const SENSITIVITY_RANK: Record<Sensitivity, number> = { normal: 0, sensitive: 1, private: 2 };

export type Category = "profile" | "work" | "interest" | "health" | "finance" | "preference" | "other";
export type FactSource = "manual" | "interview" | "ai_suggestion" | "import";
export type ConnectionStatus = "active" | "expired" | "revoked";

export type Plan = "free" | "pro";
export const PLAN_PERSONA_LIMIT: Record<Plan, number> = { free: 3, pro: 10 };
/** Absolute cap regardless of plan (F-02: 최대 10개). */
export const HARD_PERSONA_LIMIT = 10;

export interface Consents {
  /** 필수 약관 동의 (가입 시 true). */
  terms: boolean;
  /** 민감정보(건강 등) 처리 동의 — 선택. */
  sensitive_data: boolean;
  /** 마케팅 수신 — 선택. */
  marketing: boolean;
  updated_at: string;
}

export interface User {
  id: string;
  display_name: string;
  plan?: Plan;
  consents?: Consents;
  created_at?: string;
  /** Set by DELETE /me. Data is purged within 30 days (see CoreService.purgeDeletedUsers). */
  deleted_at?: string | null;
}

export type Provider = "kakao" | "apple" | "google" | "dev";

/** Social identity → user mapping (provider:subject). */
export interface Identity {
  key: string;
  provider: Provider;
  subject: string;
  user_id: string;
}

export interface Persona {
  id: string;
  user_id: string;
  name: string;
  icon: string;
  summary: string;
  instructions: string;
  archived: boolean;
  updated_at: string;
  /** Optimistic concurrency (If-Match). Missing on legacy fixtures → treated as 1. */
  version?: number;
  created_at?: string;
}

export interface Fact {
  id: string;
  persona_id: string;
  category: Category;
  body: string;
  sensitivity: Sensitivity;
  source: FactSource;
  updated_at: string;
  version?: number;
  created_at?: string;
}

export interface Connection {
  id: string;
  user_id: string;
  client_id: string;
  client_name: string;
  persona_ids: string[];
  /** "private" is never allowed; consent screen offers normal | sensitive only. */
  max_sensitivity: Exclude<Sensitivity, "private">;
  created_at: string;
  revoked_at: string | null;
  last_accessed_at: string | null;
  version?: number;
}

export interface AccessLog {
  id: string;
  connection_id: string;
  client_name: string;
  tool: string;
  persona_ids: string[];
  fact_ids: string[];
  latency_ms: number;
  created_at: string;
}

export const SENSITIVITIES: readonly Sensitivity[] = ["normal", "sensitive", "private"];
export const CATEGORIES: readonly Category[] = ["profile", "work", "interest", "health", "finance", "preference", "other"];

export interface InterviewAnswer {
  question_id: string;
  text: string;
  answered_at: string;
}

export interface FactCandidate {
  id: string;
  question_id: string | null;
  category: Category;
  body: string;
  sensitivity: Sensitivity;
}

export interface Interview {
  id: string;
  user_id: string;
  template_id: string;
  persona_id: string | null;
  status: "in_progress" | "extracted" | "committed";
  answers: InterviewAnswer[];
  candidates: FactCandidate[];
  created_at: string;
  updated_at: string;
}

export interface ExportJob {
  id: string;
  user_id: string;
  status: "ready";
  /** Snapshot taken at creation. */
  data: unknown;
  created_at: string;
}

/** Rotating refresh token (stored hashed). One family per login/device. */
export interface RefreshToken {
  hash: string;
  family_id: string;
  user_id: string;
  expires_at: number;
  used: boolean;
}

export interface AuthSession {
  /** family id — also the `sid` claim in access tokens. */
  id: string;
  user_id: string;
  created_at: string;
  revoked_at: string | null;
}
