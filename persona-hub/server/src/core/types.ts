// Shared domain types. Field names follow the API spec (snake_case on the wire).

export type Sensitivity = "normal" | "sensitive" | "private";
export const SENSITIVITY_RANK: Record<Sensitivity, number> = { normal: 0, sensitive: 1, private: 2 };

export type Category = "profile" | "work" | "interest" | "health" | "finance" | "preference" | "other";
export type FactSource = "manual" | "interview" | "ai_suggestion" | "import";
export type ConnectionStatus = "active" | "expired" | "revoked";

export interface User {
  id: string;
  display_name: string;
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
}

export interface Fact {
  id: string;
  persona_id: string;
  category: Category;
  body: string;
  sensitivity: Sensitivity;
  source: FactSource;
  updated_at: string;
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
