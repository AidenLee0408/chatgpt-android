/**
 * Module boundaries for the PoC. Each team owns one directory:
 *   src/oauth/  → OAuth 2.1 인가 서버 (DCR, PKCE, W-01 로그인, W-02 동의 화면)
 *   src/mcp/    → MCP 서버 (Streamable HTTP, 도구 3개)
 *   src/app/    → 앱 측 최소 API (연결 목록·범위 변경·해제·접근 로그) — 반영 속도 검증용
 *   test/       → 권한 통합 테스트(CI 게이트), 평가 도구
 * All data reads go through CoreService. Nobody imports Store outside core/ and main.ts.
 */
import type { Express, RequestHandler } from "express";
import type { CoreService } from "./core/index.js";

export interface AccessTokenInfo {
  token: string;
  connectionId: string;
  clientId: string;
  /** seconds since epoch */
  expiresAt: number;
}

export interface OAuthModule {
  /** Mounts /.well-known/oauth-authorization-server, /register, /authorize, /token, /revoke, consent pages. */
  mount(app: Express): void;
  /** Returns token info, or null if unknown/expired OR its connection is revoked. */
  verifyAccessToken(token: string): AccessTokenInfo | null;
  /** Drop all tokens for a connection (called when the user disconnects in the app). */
  revokeConnectionTokens(connectionId: string): void;
}

export interface ServerConfig {
  /** Public base URL, e.g. https://staging.personahub.app (issuer & resource). */
  baseUrl: string;
  /** PoC login: shared test password for the single seeded user. */
  testUserPassword: string;
}

export interface ModuleDeps {
  core: CoreService;
  config: ServerConfig;
}

export type MountMcp = (app: Express, deps: ModuleDeps & { oauth: OAuthModule }) => void;
export type MountAppApi = (app: Express, deps: ModuleDeps & { oauth: OAuthModule; auth: RequestHandler }) => void;
