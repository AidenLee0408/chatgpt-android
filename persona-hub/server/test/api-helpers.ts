// Shared harness for /v1 tests (not a test file itself).
import assert from "node:assert/strict";
import { createServer as createHttpServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createServer, type ServerOptions } from "../src/main.js";
import type { ServerConfig } from "../src/contracts.js";

export interface Harness {
  base: string;
  server: ReturnType<typeof createServer>;
  close(): Promise<void>;
  call(path: string, init?: { method?: string; body?: unknown; token?: string; headers?: Record<string, string> }): Promise<{ status: number; body: any; headers: Headers }>;
  login(idToken?: string): Promise<{ access_token: string; refresh_token: string; user_id: string }>;
  stepUp(token: string): Promise<string>;
}

export const PASSWORD = "pw";

export async function start(opts: ServerOptions = {}, configOverrides: Partial<ServerConfig> = {}): Promise<Harness> {
  const probe = await new Promise<Server>((r) => { const s = createHttpServer(); s.listen(0, () => r(s)); });
  const port = (probe.address() as AddressInfo).port;
  await new Promise((r) => probe.close(r));
  const base = `http://localhost:${port}`;
  const server = createServer({ baseUrl: base, testUserPassword: PASSWORD, registerPerHour: 1000, ...configOverrides }, "test-app-token", { allowDevLogin: true, jwtSecret: "test-secret", ...opts });
  const http = await new Promise<Server>((r) => { const s = server.app.listen(port, () => r(s)); });

  const call: Harness["call"] = async (path, init = {}) => {
    const res = await fetch(`${base}/v1${path}`, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers: {
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
        ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
        ...init.headers,
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined, headers: res.headers };
  };

  return {
    base,
    server,
    call,
    close: () => new Promise<void>((r) => { http.closeAllConnections?.(); http.close(() => r()); }),
    async login(idToken = `user-${Math.random()}`) {
      const r = await call("/auth/login", { body: { provider: "dev", id_token: idToken } });
      if (r.status !== 200) throw new Error(`login failed ${r.status} ${JSON.stringify(r.body)}`);
      return r.body;
    },
    async stepUp(token) {
      const r = await call("/auth/step-up", { token, body: { method: "biometric" } });
      if (r.status !== 200) throw new Error(`step-up failed ${r.status}`);
      return r.body.step_up_token;
    },
  };
}

// ---- OAuth → MCP connection for the seeded user (same flow as e2e.test.ts) ----
import { createHash, randomBytes } from "node:crypto";

const REDIRECT = "http://localhost:9/callback";
const form = (o: Record<string, string | string[]>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) for (const x of [v].flat()) p.append(k, x);
  return p;
};
const hidden = (html: string) =>
  Object.fromEntries([...html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)].map((m) => [m[1], m[2].replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, "&")]));

export async function oauthConnect(base: string, personaIds: string[], maxSensitivity: "normal" | "sensitive"): Promise<string> {
  const reg = await fetch(`${base}/register`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: "Claude", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none" }),
  });
  const { client_id } = (await reg.json()) as { client_id: string };
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const q = new URLSearchParams({ client_id, redirect_uri: REDIRECT, response_type: "code", code_challenge: challenge, code_challenge_method: "S256", state: "s" });
  const a = await fetch(`${base}/authorize?${q}`);
  const preCookie = a.headers.get("set-cookie")!.split(";")[0];
  const login = await fetch(`${base}/authorize/login`, { method: "POST", headers: { cookie: preCookie }, body: form({ ...hidden(await a.text()), password: PASSWORD }) });
  // M-2: login issues a new session id; the pre-login cookie is dead.
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  assert.notEqual(cookie, preCookie);
  const consentHtml = await login.text();
  const approve = await fetch(`${base}/authorize/consent`, {
    method: "POST", redirect: "manual", headers: { cookie },
    body: form({ ...hidden(consentHtml), persona_ids: personaIds, max_sensitivity: maxSensitivity, decision: "approve" }),
  });
  const code = new URL(approve.headers.get("location")!).searchParams.get("code")!;
  const tok = await fetch(`${base}/token`, {
    method: "POST",
    body: form({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id, code_verifier: verifier }),
  });
  return ((await tok.json()) as { access_token: string }).access_token;
}

export async function mcpStatus(base: string, token: string): Promise<{ status: number; body: any }> {
  const r = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } }),
  });
  return { status: r.status, body: await r.text() };
}
