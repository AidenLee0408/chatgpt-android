/**
 * Environment → server config, with production fail-closed checks (H-2) and the
 * known-client allowlist (C-1).
 */
import type { ServerConfig } from "./contracts.js";

/**
 * C-1: verified-badge allowlist, keyed by exact redirect-URI origin → display name.
 * Override with KNOWN_CLIENTS='{"https://claude.ai":"Claude", ...}'.
 * TODO(C-1): confirm the production callback origins with each vendor before launch
 * (Claude: https://claude.ai/api/mcp/auth_callback, ChatGPT: https://chatgpt.com/connector_platform_oauth_redirect).
 * These defaults are placeholders to be confirmed.
 */
export const DEFAULT_KNOWN_CLIENTS: Record<string, string> = {
  "https://claude.ai": "Claude",
  "https://chatgpt.com": "ChatGPT",
};

export function parseKnownClients(raw: string | undefined): Record<string, string> {
  if (!raw) return { ...DEFAULT_KNOWN_CLIENTS };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("KNOWN_CLIENTS must be JSON: {\"https://origin\": \"Display name\"}");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("KNOWN_CLIENTS must be a JSON object");
  const out: Record<string, string> = {};
  for (const [origin, name] of Object.entries(parsed as Record<string, unknown>)) {
    let u: URL;
    try {
      u = new URL(origin);
    } catch {
      throw new Error(`KNOWN_CLIENTS: invalid origin ${origin}`);
    }
    if (u.origin !== origin || u.protocol !== "https:") throw new Error(`KNOWN_CLIENTS: ${origin} must be an exact https origin`);
    if (typeof name !== "string" || !name.trim()) throw new Error(`KNOWN_CLIENTS: name for ${origin} must be a string`);
    out[origin] = name.trim();
  }
  return out;
}

/** TRUST_PROXY: hop count (e.g. 1 behind one ALB). Unset/0/false → false (req.ip = socket address). */
export function parseTrustProxy(raw: string | undefined): number | false {
  if (!raw || raw === "false" || raw === "0") return false;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 10) throw new Error("TRUST_PROXY must be a hop count (1-10) or false");
  return n;
}

export interface EnvConfig {
  production: boolean;
  port: number;
  config: ServerConfig;
  appToken: string;
  jwtSecret: string | undefined;
  allowDevLogin: boolean;
  trustProxy: number | false;
}

/**
 * H-2: in production (NODE_ENV=production) refuse to start without TEST_USER_PASSWORD,
 * APP_TOKEN and JWT_SECRET (≥32 bytes), or with ALLOW_DEV_LOGIN set. Dev keeps the old defaults.
 */
export function loadEnvConfig(env: NodeJS.ProcessEnv): EnvConfig {
  const production = env.NODE_ENV === "production";
  const port = Number(env.PORT ?? 3000);
  const problems: string[] = [];
  if (production) {
    if (!env.TEST_USER_PASSWORD) problems.push("TEST_USER_PASSWORD is required");
    if (!env.APP_TOKEN || env.APP_TOKEN.length < 32) problems.push("APP_TOKEN is required (≥32 chars)");
    if (!env.JWT_SECRET || Buffer.byteLength(env.JWT_SECRET) < 32) problems.push("JWT_SECRET is required (≥32 bytes)");
    if (env.ALLOW_DEV_LOGIN !== undefined && env.ALLOW_DEV_LOGIN !== "" && env.ALLOW_DEV_LOGIN !== "0")
      problems.push("ALLOW_DEV_LOGIN must not be set in production");
    if (!env.BASE_URL?.startsWith("https://")) problems.push("BASE_URL must be https in production");
  }
  if (problems.length) throw new Error(`Refusing to start in production: ${problems.join("; ")}`);
  return {
    production,
    port,
    config: {
      baseUrl: (env.BASE_URL ?? `http://localhost:${port}`).replace(/\/$/, ""),
      testUserPassword: env.TEST_USER_PASSWORD ?? "persona-poc",
      knownClients: parseKnownClients(env.KNOWN_CLIENTS),
    },
    appToken: env.APP_TOKEN ?? "dev-app-token",
    jwtSecret: env.JWT_SECRET,
    allowDevLogin: !production && env.ALLOW_DEV_LOGIN === "1",
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
  };
}
