/**
 * OAuth 2.1 authorization server for the PoC (MCP authorization spec).
 * In-memory: clients, sessions, auth codes, access/refresh tokens (SHA-256 hashed).
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import type { AccessTokenInfo, ModuleDeps, OAuthModule } from "../contracts.js";
import { TEST_USER_ID, newId } from "../core/index.js";
import { DEFAULT_KNOWN_CLIENTS } from "../config.js";

const ACCESS_TTL = 3600;
const REFRESH_TTL = 30 * 24 * 3600;
const CODE_TTL = 600;
const SESSION_TTL = 3600;
/** M-1 limits */
const REGISTER_WINDOW_S = 3600;
const MAX_CLIENTS = 10_000;
const UNUSED_CLIENT_TTL_S = 24 * 3600;
const TOKEN_PER_MINUTE = 60;
const LOGIN_FREE_FAILURES = 5;
const LOGIN_BASE_LOCK_S = 30;
const LOGIN_MAX_LOCK_S = 3600;

/** Brand names that only allowlisted clients may use without a warning (C-1). */
const BRANDS = ["claude", "anthropic", "chatgpt", "openai", "gpt", "gemini", "google", "copilot", "microsoft", "perplexity"];

export function brandIn(name: string): string | null {
  const n = name.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  return BRANDS.find((b) => n.includes(b)) ?? null;
}

interface Client {
  client_id: string;
  /** L-6: SHA-256 of the DCR client secret; the plaintext is only returned once at registration. */
  client_secret_hash?: string;
  client_name: string;
  redirect_uris: string[];
  created_at: number;
  /** C-1: client_name uses a known brand but the redirect origins are not allowlisted. */
  brand_warning: boolean;
  /** Set on first user approval; unused clients are dropped after 24h (M-1). */
  consented: boolean;
}
interface AuthRequest {
  client_id: string;
  redirect_uri: string;
  state?: string;
  code_challenge: string;
  resource?: string;
}
interface AuthCode extends AuthRequest {
  connectionId: string;
  expiresAt: number;
  used: boolean;
}
interface Session {
  userId: string | null;
  csrf: string;
  expiresAt: number;
}
interface StoredToken {
  kind: "access" | "refresh";
  connectionId: string;
  clientId: string;
  expiresAt: number;
  /** refresh tokens: set when rotated; reuse after this revokes the connection */
  rotated: boolean;
  resource?: string;
}

const now = () => Math.floor(Date.now() / 1000);
const rand = (n = 32) => randomBytes(n).toString("base64url");
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"'`=\/]/g, (c) => `&#${c.charCodeAt(0)};`);
}

function safeEq(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function isAllowedRedirect(uri: string): boolean {
  try {
    const u = new URL(uri);
    if (u.hash) return false;
    if (u.protocol === "https:") return true;
    if (u.protocol === "http:") return ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
    return false;
  } catch {
    return false;
  }
}

function cors(req: Request, res: Response, next: NextFunction) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, MCP-Protocol-Version");
  res.setHeader("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
}

function oauthError(res: Response, status: number, error: string, description?: string) {
  res.status(status).setHeader("Cache-Control", "no-store");
  res.json(description ? { error, error_description: description } : { error });
}

class BadRequest extends Error {}

/** L-1: an undecodable cookie is a client error (400), never an uncaught URIError (500 + stack). */
function parseCookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i <= 0) continue;
    try {
      out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      throw new BadRequest("malformed cookie");
    }
  }
  return out;
}

/** Fixed-window counter with self-cleanup. */
class Window {
  private readonly m = new Map<string, { start: number; count: number }>();
  constructor(private readonly limit: number, private readonly windowS: number) {}
  hit(key: string): boolean {
    const t = now();
    let w = this.m.get(key);
    if (!w || t - w.start >= this.windowS) {
      w = { start: t, count: 0 };
      this.m.set(key, w);
      if (this.m.size > 10_000) this.sweep(t);
    }
    return ++w.count <= this.limit;
  }
  sweep(t = now()) {
    for (const [k, v] of this.m) if (t - v.start >= this.windowS) this.m.delete(k);
  }
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function redirectWith(uri: string, params: Record<string, string | undefined>): string {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, v);
  return u.toString();
}

export function createOAuth(deps: ModuleDeps): OAuthModule {
  const { core, config } = deps;
  const issuer = config.baseUrl.replace(/\/+$/, "");
  const mcpResource = `${issuer}/mcp`;
  const secureCookie = issuer.startsWith("https://");
  // M-2: __Host- prefix pins the cookie to this host (requires Secure, so only over https).
  const SESSION_COOKIE = secureCookie ? "__Host-ph_sid" : "ph_sid";
  const knownClients = config.knownClients ?? DEFAULT_KNOWN_CLIENTS;
  const registerLimit = new Window(config.registerPerHour ?? 10, REGISTER_WINDOW_S);
  const tokenLimit = new Window(TOKEN_PER_MINUTE, 60);
  const loginFailures = new Map<string, { fails: number; lockedUntil: number; last: number }>();
  /** H-3: (client_id, redirect_uri) pairs the user has approved at least once. */
  const consentedRedirects = new Set<string>();

  const clients = new Map<string, Client>();
  const sessions = new Map<string, Session>();
  const codes = new Map<string, AuthCode>(); // key: sha256(code)
  const tokens = new Map<string, StoredToken>(); // key: sha256(token)

  // ---- helpers ----
  function setSessionCookie(res: Response, sid: string) {
    res.setHeader(
      "Set-Cookie",
      `${SESSION_COOKIE}=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL}${secureCookie ? "; Secure" : ""}`,
    );
  }

  function getSession(req: Request, res: Response): Session & { sid: string } {
    const sid = parseCookies(req)[SESSION_COOKIE];
    const s = sid ? sessions.get(sid) : undefined;
    if (sid && s && s.expiresAt > now()) return Object.assign(s, { sid });
    if (sid) sessions.delete(sid);
    if (sessions.size > 50_000) for (const [k, v] of sessions) if (v.expiresAt <= now()) sessions.delete(k);
    const newSid = rand();
    const fresh: Session = { userId: null, csrf: rand(24), expiresAt: now() + SESSION_TTL };
    sessions.set(newSid, fresh);
    setSessionCookie(res, newSid);
    return Object.assign(fresh, { sid: newSid });
  }

  /** M-2: new session id on privilege change (login); the old id is dead. */
  function rotateSession(res: Response, old: string, userId: string): Session {
    sessions.delete(old);
    const sid = rand();
    const s: Session = { userId, csrf: rand(24), expiresAt: now() + SESSION_TTL };
    sessions.set(sid, s);
    setSessionCookie(res, sid);
    return s;
  }

  /** C-1: display name when EVERY registered redirect origin is allowlisted under the same name. */
  function verifiedName(client: Client): string | null {
    let name: string | null = null;
    for (const u of client.redirect_uris) {
      let origin: string;
      try {
        origin = new URL(u).origin;
      } catch {
        return null;
      }
      const n = Object.hasOwn(knownClients, origin) ? knownClients[origin] : undefined;
      if (!n || (name !== null && n !== name)) return null;
      name = n;
    }
    return name;
  }

  /** H-3: may we send errors back to this redirect_uri without the user seeing our page first? */
  function trustedRedirect(client: Client, redirectUri: string): boolean {
    return verifiedName(client) !== null || consentedRedirects.has(`${client.client_id}\n${redirectUri}`);
  }

  function sweepClients() {
    const t = now();
    for (const [id, c] of clients) if (!c.consented && t - c.created_at > UNUSED_CLIENT_TTL_S) clients.delete(id);
  }

  // ---- login throttling (M-1): per session and per IP, exponential lock after 5 failures ----
  function loginKeys(req: Request, sid: string) {
    return [`sid:${sid}`, `ip:${req.ip ?? "unknown"}`];
  }
  function loginLockedFor(keys: string[]): number {
    const t = now();
    return Math.max(0, ...keys.map((k) => (loginFailures.get(k)?.lockedUntil ?? 0) - t));
  }
  function recordLoginFailure(keys: string[]) {
    const t = now();
    if (loginFailures.size > 50_000) for (const [k, v] of loginFailures) if (t - v.last > LOGIN_MAX_LOCK_S) loginFailures.delete(k);
    for (const k of keys) {
      const f = loginFailures.get(k) ?? { fails: 0, lockedUntil: 0, last: t };
      f.fails++;
      f.last = t;
      if (f.fails >= LOGIN_FREE_FAILURES) {
        f.lockedUntil = t + Math.min(LOGIN_MAX_LOCK_S, LOGIN_BASE_LOCK_S * 2 ** (f.fails - LOGIN_FREE_FAILURES));
      }
      loginFailures.set(k, f);
    }
  }

  function dropConnectionTokens(connectionId: string) {
    for (const [k, t] of tokens) if (t.connectionId === connectionId) tokens.delete(k);
    for (const [k, c] of codes) if (c.connectionId === connectionId) codes.delete(k);
  }

  function revokeConnection(connectionId: string) {
    const conn = core.activeConnection(connectionId);
    if (conn) core.revokeConnection(connectionId, conn.user_id);
    dropConnectionTokens(connectionId);
  }

  function issueTokens(connectionId: string, clientId: string, resource?: string) {
    const access = rand();
    const refresh = rand();
    const t = now();
    tokens.set(sha256(access), { kind: "access", connectionId, clientId, expiresAt: t + ACCESS_TTL, rotated: false, resource });
    tokens.set(sha256(refresh), { kind: "refresh", connectionId, clientId, expiresAt: t + REFRESH_TTL, rotated: false, resource });
    const conn = core.activeConnection(connectionId);
    return {
      access_token: access,
      token_type: "Bearer",
      expires_in: ACCESS_TTL,
      refresh_token: refresh,
      scope: conn ? `personas:${conn.max_sensitivity}` : undefined,
    };
  }

  /** Validates the client/redirect part of an authorize request. Returns error string for non-redirectable errors. */
  function validateAuthRequest(q: Record<string, unknown>):
    | { ok: true; client: Client; req: AuthRequest }
    | { ok: false; fatal: string }
    | { ok: false; redirect: string } {
    const clientId = str(q.client_id);
    const client = clientId ? clients.get(clientId) : undefined;
    if (!client) return { ok: false, fatal: "알 수 없는 클라이언트예요 (client_id)." };
    const redirectUri = str(q.redirect_uri) ?? (client.redirect_uris.length === 1 ? client.redirect_uris[0] : undefined);
    if (!redirectUri || !client.redirect_uris.includes(redirectUri))
      return { ok: false, fatal: "등록되지 않은 redirect_uri예요." };
    const state = str(q.state);
    const trusted = trustedRedirect(client, redirectUri);
    // H-3: only trusted (allowlisted or previously approved) redirects get OAuth error redirects;
    // everyone else sees our error page so /authorize can't be used as an open redirect.
    const fail = (error: string, d: string) =>
      trusted
        ? { ok: false as const, redirect: redirectWith(redirectUri, { error, error_description: d, state, iss: issuer }) }
        : { ok: false as const, fatal: `잘못된 연결 요청이에요 (${error}: ${d}).` };
    if (q.response_type !== "code") return fail("unsupported_response_type", "response_type must be code");
    const challenge = str(q.code_challenge);
    if (!challenge || !/^[A-Za-z0-9_-]{43,128}$/.test(challenge)) return fail("invalid_request", "code_challenge required");
    if (q.code_challenge_method !== "S256") return fail("invalid_request", "code_challenge_method must be S256");
    // M-3: the resource (audience) is bound to the code; default is our MCP endpoint.
    const resource = str(q.resource) ?? mcpResource;
    if (resource) {
      try {
        const r = new URL(resource);
        if (r.hash) return fail("invalid_target", "resource must not contain fragment");
      } catch {
        return fail("invalid_target", "resource must be an absolute URI");
      }
    }
    return { ok: true, client, req: { client_id: client.client_id, redirect_uri: redirectUri, state, code_challenge: challenge, resource } };
  }

  function hiddenFields(r: AuthRequest, csrf: string): string {
    const f: Record<string, string | undefined> = {
      client_id: r.client_id,
      redirect_uri: r.redirect_uri,
      state: r.state,
      code_challenge: r.code_challenge,
      code_challenge_method: "S256",
      response_type: "code",
      resource: r.resource,
      csrf,
    };
    return Object.entries(f)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
      .join("");
  }

  // ---- routes ----
  function mount(app: Express) {
    const form = express.urlencoded({ extended: false });
    const json = express.json();

    app.options(["/.well-known/oauth-authorization-server", "/register", "/token", "/revoke"], cors);

    app.get("/.well-known/oauth-authorization-server", cors, (_req, res) => {
      res.json({
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        registration_endpoint: `${issuer}/register`,
        revocation_endpoint: `${issuer}/revoke`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
        revocation_endpoint_auth_methods_supported: ["none", "client_secret_post"],
        scopes_supported: ["personas"],
        authorization_response_iss_parameter_supported: true,
      });
    });

    app.post("/register", cors, json, form, (req, res) => {
      if (!registerLimit.hit(`ip:${req.ip ?? "unknown"}`)) {
        res.setHeader("Retry-After", String(REGISTER_WINDOW_S));
        return oauthError(res, 429, "slow_down", "too many registrations from this address");
      }
      if (clients.size >= MAX_CLIENTS) sweepClients();
      if (clients.size >= MAX_CLIENTS) return oauthError(res, 503, "temporarily_unavailable", "registration is full");
      const b = (req.body ?? {}) as Record<string, unknown>;
      const uris = b.redirect_uris;
      if (!Array.isArray(uris) || uris.length === 0 || !uris.every((u) => typeof u === "string"))
        return oauthError(res, 400, "invalid_redirect_uri", "redirect_uris required");
      if (!uris.every(isAllowedRedirect))
        return oauthError(res, 400, "invalid_redirect_uri", "redirect_uris must be https or http://localhost");
      const authMethod = str(b.token_endpoint_auth_method) ?? "none";
      if (!["none", "client_secret_post"].includes(authMethod))
        return oauthError(res, 400, "invalid_client_metadata", "unsupported token_endpoint_auth_method");
      const gt = b.grant_types;
      if (gt !== undefined && (!Array.isArray(gt) || gt.some((g) => g !== "authorization_code" && g !== "refresh_token")))
        return oauthError(res, 400, "invalid_client_metadata", "unsupported grant_types");
      const rawName = str(b.client_name) ?? "이름 없는 앱";
      const secret = authMethod === "client_secret_post" ? rand() : undefined;
      const client: Client = {
        client_id: newId("cli"),
        client_name: rawName.slice(0, 100),
        redirect_uris: uris as string[],
        created_at: now(),
        client_secret_hash: secret ? sha256(secret) : undefined,
        brand_warning: false,
        consented: false,
      };
      client.brand_warning = brandIn(client.client_name) !== null && verifiedName(client) === null;
      clients.set(client.client_id, client);
      res.status(201).setHeader("Cache-Control", "no-store");
      res.json({
        client_id: client.client_id,
        client_id_issued_at: client.created_at,
        ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
        client_name: client.client_name,
        redirect_uris: client.redirect_uris,
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: authMethod,
      });
    });

    app.get("/authorize", (req, res) => {
      const v = validateAuthRequest(req.query as Record<string, unknown>);
      if (!v.ok) {
        if ("redirect" in v) return res.redirect(302, v.redirect);
        return sendHtml(res, 400, errorPage(v.fatal));
      }
      const s = getSession(req, res);
      if (!s.userId) return sendHtml(res, 200, loginPage(v.req, s.csrf), v.req.redirect_uri);
      return sendHtml(res, 200, consentPage(v.client, v.req, s.csrf, s.userId), v.req.redirect_uri);
    });

    app.post("/authorize/login", form, (req, res) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const v = validateAuthRequest(b);
      if (!v.ok) {
        if ("redirect" in v) return res.redirect(303, v.redirect);
        return sendHtml(res, 400, errorPage(v.fatal));
      }
      const s = getSession(req, res);
      if (!str(b.csrf) || !safeEq(String(b.csrf), s.csrf)) return sendHtml(res, 403, errorPage("요청이 만료됐어요. 다시 시도해 주세요."));
      const keys = loginKeys(req, s.sid);
      const locked = loginLockedFor(keys);
      if (locked > 0) {
        s.csrf = rand(24);
        res.setHeader("Retry-After", String(locked));
        return sendHtml(res, 429, loginPage(v.req, s.csrf, `로그인 시도가 너무 많아요. ${locked}초 후에 다시 시도해 주세요.`), v.req.redirect_uri);
      }
      if (!str(b.password) || !safeEq(sha256(String(b.password)), sha256(config.testUserPassword))) {
        recordLoginFailure(keys);
        s.csrf = rand(24); // M-1: a failed attempt spends the csrf token
        return sendHtml(res, 401, loginPage(v.req, s.csrf, "비밀번호가 맞지 않아요."), v.req.redirect_uri);
      }
      for (const k of keys) loginFailures.delete(k);
      const fresh = rotateSession(res, s.sid, TEST_USER_ID); // M-2: new session id + csrf on login
      return sendHtml(res, 200, consentPage(v.client, v.req, fresh.csrf, TEST_USER_ID), v.req.redirect_uri);
    });

    app.post("/authorize/consent", form, (req, res) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const v = validateAuthRequest(b);
      if (!v.ok) {
        if ("redirect" in v) return res.redirect(303, v.redirect);
        return sendHtml(res, 400, errorPage(v.fatal));
      }
      const s = getSession(req, res);
      if (!str(b.csrf) || !safeEq(String(b.csrf), s.csrf)) return sendHtml(res, 403, errorPage("요청이 만료됐어요. 다시 시도해 주세요."));
      if (!s.userId) return sendHtml(res, 200, loginPage(v.req, s.csrf), v.req.redirect_uri);
      const r = v.req;
      const userId = s.userId;
      if (b.decision !== "approve")
        return res.redirect(303, redirectWith(r.redirect_uri, { error: "access_denied", state: r.state, iss: issuer }));

      const raw = b.persona_ids;
      const requested = (Array.isArray(raw) ? raw : raw === undefined ? [] : [raw]).filter((x): x is string => typeof x === "string");
      const owned = new Set(core.listUserPersonas(userId).map((p) => p.id));
      const personaIds = [...new Set(requested)].filter((id) => owned.has(id));
      if (personaIds.length === 0) return sendHtml(res, 400, consentPage(v.client, r, s.csrf, userId, "페르소나를 하나 이상 선택해 주세요."), r.redirect_uri);
      const maxSensitivity = b.max_sensitivity === "sensitive" ? "sensitive" : "normal";
      // M-4: sensitive scope only with the user's separate 민감정보 consent.
      if (maxSensitivity === "sensitive" && !hasSensitiveConsent(userId))
        return sendHtml(res, 400, consentPage(v.client, r, s.csrf, userId, "민감정보 공유에 동의하지 않아서 민감 정보는 공유할 수 없어요."), r.redirect_uri);

      v.client.consented = true;
      consentedRedirects.add(`${v.client.client_id}\n${r.redirect_uri}`);
      const conn = core.createConnection({
        user_id: userId,
        client_id: v.client.client_id,
        client_name: verifiedName(v.client) ?? v.client.client_name,
        persona_ids: personaIds,
        max_sensitivity: maxSensitivity,
      });
      const code = rand();
      codes.set(sha256(code), { ...r, connectionId: conn.id, expiresAt: now() + CODE_TTL, used: false });
      s.csrf = rand(24); // one submission per token
      return res.redirect(303, redirectWith(r.redirect_uri, { code, state: r.state, iss: issuer }));
    });

    app.post("/token", cors, json, form, (req, res) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      let client: Client | null;
      try {
        client = authenticateClient(req, b);
      } catch {
        return oauthError(res, 400, "invalid_request", "malformed Authorization header");
      }
      if (!client) return oauthError(res, 401, "invalid_client", "client authentication failed");
      if (!tokenLimit.hit(`${client.client_id}|${req.ip ?? "unknown"}`)) {
        res.setHeader("Retry-After", "60");
        return oauthError(res, 429, "slow_down", "too many token requests");
      }
      const gt = b.grant_type;

      if (gt === "authorization_code") {
        const code = str(b.code);
        const verifier = str(b.code_verifier);
        if (!code || !verifier) return oauthError(res, 400, "invalid_request", "code and code_verifier required");
        const key = sha256(code);
        const c = codes.get(key);
        if (!c) return oauthError(res, 400, "invalid_grant", "unknown code");
        if (c.used) {
          // RFC 6749 §4.1.2 / OAuth 2.1: code replay → revoke everything issued from it
          revokeConnection(c.connectionId);
          return oauthError(res, 400, "invalid_grant", "code already used");
        }
        c.used = true;
        if (c.expiresAt < now()) return oauthError(res, 400, "invalid_grant", "code expired");
        if (c.client_id !== client.client_id) return oauthError(res, 400, "invalid_grant", "client mismatch");
        const redirectUri = str(b.redirect_uri);
        if (redirectUri !== undefined && redirectUri !== c.redirect_uri)
          return oauthError(res, 400, "invalid_grant", "redirect_uri mismatch");
        if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return oauthError(res, 400, "invalid_grant", "malformed code_verifier");
        const computed = createHash("sha256").update(verifier).digest("base64url");
        if (!safeEq(computed, c.code_challenge)) return oauthError(res, 400, "invalid_grant", "PKCE verification failed");
        // M-3: the resource was bound at /authorize; /token may repeat it but never change it.
        const asked = str(b.resource);
        if (asked !== undefined && asked !== c.resource) return oauthError(res, 400, "invalid_target", "resource does not match the authorization");
        if (!core.activeConnection(c.connectionId)) return oauthError(res, 400, "invalid_grant", "connection revoked");
        res.setHeader("Cache-Control", "no-store");
        return res.json(issueTokens(c.connectionId, client.client_id, c.resource));
      }

      if (gt === "refresh_token") {
        const rt = str(b.refresh_token);
        if (!rt) return oauthError(res, 400, "invalid_request", "refresh_token required");
        const key = sha256(rt);
        const t = tokens.get(key);
        if (!t || t.kind !== "refresh") return oauthError(res, 400, "invalid_grant", "unknown refresh_token");
        if (t.clientId !== client.client_id) return oauthError(res, 400, "invalid_grant", "client mismatch");
        if (t.rotated) {
          revokeConnection(t.connectionId);
          return oauthError(res, 400, "invalid_grant", "refresh_token reuse detected; connection revoked");
        }
        if (t.expiresAt < now()) {
          tokens.delete(key);
          return oauthError(res, 400, "invalid_grant", "refresh_token expired");
        }
        if (!core.activeConnection(t.connectionId)) {
          dropConnectionTokens(t.connectionId);
          return oauthError(res, 400, "invalid_grant", "connection revoked");
        }
        const asked = str(b.resource);
        if (asked !== undefined && asked !== t.resource) return oauthError(res, 400, "invalid_target", "resource does not match the grant");
        t.rotated = true; // keep tombstone to detect reuse
        res.setHeader("Cache-Control", "no-store");
        return res.json(issueTokens(t.connectionId, client.client_id, t.resource));
      }

      return oauthError(res, 400, "unsupported_grant_type");
    });

    app.post("/revoke", cors, json, form, (req, res) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      let client: Client | null;
      try {
        client = authenticateClient(req, b);
      } catch {
        return oauthError(res, 400, "invalid_request", "malformed Authorization header");
      }
      if (!client) return oauthError(res, 401, "invalid_client");
      const tok = str(b.token);
      if (!tok) return oauthError(res, 400, "invalid_request", "token required");
      const key = sha256(tok);
      const t = tokens.get(key);
      if (t && t.clientId === client.client_id) {
        if (t.kind === "refresh") {
          // revoking a refresh token invalidates the grant's tokens (RFC 7009 §2.1); connection stays for the app to manage
          for (const [k, x] of tokens) if (x.connectionId === t.connectionId) tokens.delete(k);
        } else {
          tokens.delete(key);
        }
      }
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).end();
    });

    // L-1: malformed cookies etc. → 400 page, never a stack trace.
    app.use(["/authorize", "/authorize/login", "/authorize/consent"], (err: unknown, _req: Request, res: Response, next: NextFunction) => {
      if (err instanceof BadRequest || (err as { status?: number })?.status === 400) return sendHtml(res, 400, errorPage("요청 형식이 올바르지 않아요."));
      next(err);
    });

    const sweep = setInterval(() => {
      sweepClients();
      registerLimit.sweep();
      tokenLimit.sweep();
      const t = now();
      for (const [k, v] of sessions) if (v.expiresAt <= t) sessions.delete(k);
      for (const [k, c] of codes) if (c.expiresAt <= t - CODE_TTL) codes.delete(k);
      for (const [k, v] of loginFailures) if (t - v.last > LOGIN_MAX_LOCK_S && v.lockedUntil <= t) loginFailures.delete(k);
    }, 10 * 60_000);
    sweep.unref();
  }

  function hasSensitiveConsent(userId: string): boolean {
    return core.userConsents(userId)?.sensitive_data === true;
  }

  function authenticateClient(req: Request, b: Record<string, unknown>): Client | null {
    let clientId = str(b.client_id);
    let secret = str(b.client_secret);
    const auth = req.headers.authorization;
    if (!clientId && auth?.startsWith("Basic ")) {
      // tolerated for interop even though not advertised. Throws BadRequest on malformed input (L-1).
      const raw = Buffer.from(auth.slice(6), "base64").toString();
      const i = raw.indexOf(":");
      try {
        clientId = decodeURIComponent(i >= 0 ? raw.slice(0, i) : raw);
        secret = i >= 0 ? decodeURIComponent(raw.slice(i + 1)) : undefined;
      } catch {
        throw new BadRequest("malformed basic auth");
      }
    }
    const client = clientId ? clients.get(clientId) : undefined;
    if (!client) return null;
    if (client.client_secret_hash) {
      if (!secret || !safeEq(sha256(secret), client.client_secret_hash)) return null;
    }
    return client;
  }

  function verifyAccessToken(token: string): AccessTokenInfo | null {
    if (!token) return null;
    const key = sha256(token);
    const t = tokens.get(key);
    if (!t || t.kind !== "access") return null;
    if (t.expiresAt <= now()) {
      tokens.delete(key);
      return null;
    }
    if (!core.activeConnection(t.connectionId)) {
      dropConnectionTokens(t.connectionId);
      return null;
    }
    return { token, connectionId: t.connectionId, clientId: t.clientId, expiresAt: t.expiresAt, resource: t.resource };
  }

  // ---- HTML ----
  /**
   * L-2: script-src only via a per-response nonce; form-action is 'self' plus the origin of the
   * already-validated redirect_uri (Chrome checks the 303 target against form-action).
   */
  function sendHtml(res: Response, status: number, html: string, redirectUri?: string) {
    const nonce = randomBytes(16).toString("base64");
    let redirectOrigin = "";
    if (redirectUri) {
      try {
        redirectOrigin = ` ${new URL(redirectUri).origin}`;
      } catch {
        redirectOrigin = "";
      }
    }
    res.status(status);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    if (secureCookie) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    res.setHeader(
      "Content-Security-Policy",
      `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; form-action 'self'${redirectOrigin}; frame-ancestors 'none'; base-uri 'none'`,
    );
    res.send(html.replaceAll("__CSP_NONCE__", nonce));
  }

  function layout(title: string, body: string): string {
    return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>${CSS}</style></head><body><main>${body}</main></body></html>`;
  }

  function errorPage(msg: string): string {
    return layout("오류", `<div class="card"><h1>연결할 수 없어요</h1><p class="muted">${esc(msg)}</p></div>`);
  }

  function loginPage(r: AuthRequest, csrf: string, error?: string): string {
    const client = clients.get(r.client_id);
    return layout(
      "로그인",
      `<div class="brand">페르소나 허브</div>
<h1>로그인</h1>
<p class="muted">${esc(client?.client_name ?? "")} 연결을 위해 로그인해 주세요.</p>
<form method="post" action="/authorize/login" class="card">
${hiddenFields(r, csrf)}
<label class="field"><span>아이디</span><input value="테스트 사용자" disabled></label>
<label class="field"><span>비밀번호</span><input type="password" name="password" autocomplete="current-password" required autofocus></label>
${error ? `<p class="error" role="alert">${esc(error)}</p>` : ""}
<button class="primary" type="submit">로그인</button>
</form>`,
    );
  }

  function consentPage(client: Client, r: AuthRequest, csrf: string, userId: string, error?: string): string {
    const personas = core.listUserPersonas(userId);
    const verified = verifiedName(client);
    const displayName = verified ?? client.client_name;
    let host = r.redirect_uri;
    try {
      host = new URL(r.redirect_uri).host;
    } catch {
      /* validated earlier */
    }
    const sensitiveOk = hasSensitiveConsent(userId);
    const cards = personas
      .map(
        (p) => `<label class="persona card"><input type="checkbox" name="persona_ids" value="${esc(p.id)}">
<span class="pbody"><strong>${esc(p.name)}</strong><span class="muted">${esc(p.summary)}</span></span></label>`,
      )
      .join("");
    // C-1: the redirect host is ALWAYS shown; the badge comes only from the server allowlist.
    const dest = `<p class="muted dest">정보를 받는 주소: <code>${esc(host)}</code></p>`;
    const brandWarn = client.brand_warning
      ? `<div class="warn" role="alert"><strong>주의: 공식 앱이 아닐 수 있어요</strong><br>이름에 잘 알려진 서비스 이름이 들어 있지만, 등록된 주소가 해당 서비스의 공식 주소가 아니에요.</div>`
      : "";
    const badge = verified
      ? `<span class="badge ok">✓ 확인된 앱</span>${dest}`
      : `<div class="warn" role="note"><strong>확인되지 않은 앱이에요</strong><br>아래 주소로 정보가 전달돼요. 아는 앱인지 확인해 주세요.<br><code>${esc(r.redirect_uri)}</code></div>${brandWarn}${dest}`;
    return layout(
      "연결 요청",
      `<div class="brand">페르소나 허브</div>
<h1>${verified ? "" : "확인되지 않은 앱 "}${esc(displayName)}가 페르소나 허브 연결을 요청해요</h1>
${badge}
<form method="post" action="/authorize/consent" id="consent">
${hiddenFields(r, csrf)}
<h2>공유할 페르소나</h2>
${cards || `<p class="muted">공유할 페르소나가 없어요.</p>`}
<h2>공유할 정보 범위</h2>
<div class="card radios">
<label><input type="radio" name="max_sensitivity" value="normal" checked> 일반만</label>
${sensitiveOk
  ? `<label><input type="radio" name="max_sensitivity" value="sensitive"> 민감 포함</label>`
  : `<label class="muted"><input type="radio" name="max_sensitivity" value="sensitive" disabled> 민감 포함</label><p class="hint">민감정보 공유에 동의하지 않았어요. 앱의 설정에서 동의하면 선택할 수 있어요.</p>`}
<p class="hint" id="sens-warn" hidden>건강·재무 같은 민감 정보도 이 앱에 전달돼요.</p>
</div>
<ul class="notes"><li>비공개 정보는 절대 전달되지 않아요</li><li>언제든 앱에서 연결을 끊을 수 있어요</li></ul>
<details class="card"><summary>국외 이전 고지</summary>
<dl><dt>이전받는 자</dt><dd>${esc(displayName)} 운영사</dd>
<dt>이전 국가</dt><dd>미국 등 해당 서비스 운영 국가</dd>
<dt>이전 항목</dt><dd>선택한 페르소나의 요약·지침 및 허용 범위 내 사실 정보</dd>
<dt>이전 목적</dt><dd>AI 대화 개인화</dd>
<dt>보유 기간</dt><dd>연결 해제 시까지 (수신자 정책에 따름)</dd></dl></details>
${error ? `<p class="error" role="alert">${esc(error)}</p>` : ""}
<div class="actions">
<button class="primary" type="submit" name="decision" value="approve" id="approve" disabled>선택한 페르소나 허용</button>
<button class="secondary" type="submit" name="decision" value="deny" formnovalidate>거절</button>
</div>
</form>
<script nonce="__CSP_NONCE__">(function(){var f=document.getElementById('consent'),a=document.getElementById('approve'),w=document.getElementById('sens-warn');
function u(){a.disabled=f.querySelectorAll('input[name=persona_ids]:checked').length===0;w.hidden=!f.querySelector('input[name=max_sensitivity][value=sensitive]:checked');}
f.addEventListener('change',u);u();})();</script>`,
    );
  }

  return { mount, verifyAccessToken, revokeConnectionTokens: dropConnectionTokens };
}

const CSS = `
:root{--brand:#3B5BDB;--bg:#F7F7F5;--card:#fff;--text:#1f2328;--muted:#6b7280;--line:#e5e7eb;--warn-bg:#FFF4E6;--warn:#D9480F;--ok:#2B8A3E}
@media (prefers-color-scheme:dark){:root{--brand:#748FFC;--bg:#141517;--card:#1f2023;--text:#eceef1;--muted:#9aa0a8;--line:#2e3035;--warn-bg:#3a2410;--warn:#FFA94D;--ok:#69DB7C}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 -apple-system,"Apple SD Gothic Neo","Noto Sans KR",system-ui,sans-serif}
main{max-width:480px;margin:0 auto;padding:24px 16px 40px}
.brand{color:var(--brand);font-weight:700;font-size:14px;margin-bottom:8px}
h1{font-size:22px;line-height:1.35;margin:0 0 12px;word-break:keep-all}h2{font-size:15px;margin:24px 0 8px;color:var(--muted)}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px;margin-bottom:10px}
.muted{color:var(--muted);font-size:14px}
.badge.ok{display:inline-block;color:var(--ok);font-size:13px;font-weight:600}
.warn{background:var(--warn-bg);color:var(--warn);border-radius:12px;padding:12px;font-size:14px}
.warn code{word-break:break-all;color:var(--text)}
.persona{display:flex;gap:12px;align-items:flex-start;cursor:pointer}.persona input{margin-top:4px;width:20px;height:20px;accent-color:var(--brand)}
.pbody{display:flex;flex-direction:column}
.radios label{display:block;padding:6px 0}.radios input{accent-color:var(--brand)}
.hint{color:var(--warn);font-size:13px;margin:6px 0 0}
.notes{padding-left:20px;font-size:14px;color:var(--muted)}
details summary{cursor:pointer;font-weight:600}dl{font-size:14px;margin:8px 0 0}dt{color:var(--muted)}dd{margin:0 0 8px}
.field{display:block;margin-bottom:12px}.field span{display:block;font-size:14px;color:var(--muted);margin-bottom:4px}
.field input{width:100%;padding:12px;border:1px solid var(--line);border-radius:12px;font-size:16px;background:var(--bg);color:var(--text)}
.error{color:#E03131;font-size:14px}
.actions{display:flex;flex-direction:column;gap:8px;margin-top:20px}
button{width:100%;padding:14px;border-radius:12px;font-size:16px;font-weight:600;cursor:pointer;border:0}
.primary{background:var(--brand);color:#fff}.primary:disabled{opacity:.4;cursor:not-allowed}
.secondary{background:transparent;color:var(--text);border:1px solid var(--line)}
`;
