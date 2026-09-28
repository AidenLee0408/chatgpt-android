// Regression tests for OAuth findings in docs/SECURITY_REVIEW.md: C-1, H-3, M-1, M-2, M-3, M-4, L-1, L-2, L-6.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { PERSONA_WORK, TEST_USER_ID } from "../src/core/index.js";
import { DEFAULT_KNOWN_CLIENTS, parseKnownClients } from "../src/config.js";
import { brandIn } from "../src/oauth/index.js";
import { PASSWORD, mcpStatus, start, type Harness } from "./api-helpers.js";

const LOCAL = "http://localhost:9/callback";
const CLAUDE_CB = "https://claude.ai/api/mcp/auth_callback";

let h: Harness;
before(async () => { h = await start({}, { knownClients: { "https://claude.ai": "Claude" } }); });
after(() => h.close());

const form = (o: Record<string, string | string[] | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined) for (const x of [v].flat()) p.append(k, x);
  return p;
};
const hidden = (html: string) =>
  Object.fromEntries([...html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)].map((m) => [m[1], m[2].replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, "&")]));
const cookieOf = (r: Response) => r.headers.get("set-cookie")?.split(";")[0];

async function register(base: string, name: string, uris: string[], extra: Record<string, unknown> = {}) {
  const r = await fetch(`${base}/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: name, redirect_uris: uris, ...extra }) });
  return { status: r.status, body: (await r.json()) as any };
}

function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

/** GET /authorize → login → consent page. Returns cookie, consent html and verifier. */
async function toConsent(base: string, clientId: string, redirect: string, extra: Record<string, string> = {}) {
  const { verifier, challenge } = pkce();
  const q = new URLSearchParams({ client_id: clientId, redirect_uri: redirect, response_type: "code", code_challenge: challenge, code_challenge_method: "S256", state: "s", ...extra });
  const a = await fetch(`${base}/authorize?${q}`);
  const pre = cookieOf(a)!;
  const login = await fetch(`${base}/authorize/login`, { method: "POST", headers: { cookie: pre }, body: form({ ...hidden(await a.text()), password: PASSWORD }) });
  return { cookie: cookieOf(login)!, html: await login.text(), verifier, pre, login };
}

async function approve(base: string, c: { cookie: string; html: string }, max: "normal" | "sensitive" = "normal") {
  return fetch(`${base}/authorize/consent`, {
    method: "POST", redirect: "manual", headers: { cookie: c.cookie },
    body: form({ ...hidden(c.html), persona_ids: [PERSONA_WORK], max_sensitivity: max, decision: "approve" }),
  });
}

async function exchange(base: string, clientId: string, code: string, verifier: string, redirect: string, extra: Record<string, string> = {}) {
  const r = await fetch(`${base}/token`, { method: "POST", body: form({ grant_type: "authorization_code", code, redirect_uri: redirect, client_id: clientId, code_verifier: verifier, ...extra }) });
  return { status: r.status, body: (await r.json()) as any };
}

// ---------- C-1 ----------

test("C-1: a DCR client named like a known brand gets no badge, a warning, and the redirect host is shown", async () => {
  const reg = await register(h.base, "Claude (official) - evil", ["https://evil.example/cb"]);
  assert.equal(reg.status, 201);
  const c = await toConsent(h.base, reg.body.client_id, "https://evil.example/cb");
  assert.doesNotMatch(c.html, /확인된 앱</);
  assert.match(c.html, /확인되지 않은 앱 Claude \(official\) - evil가/);
  assert.match(c.html, /공식 앱이 아닐 수 있어요/);
  assert.match(c.html, /정보를 받는 주소: <code>evil&#46;example|정보를 받는 주소: <code>evil\.example/);
});

test("C-1: badge only for allowlisted redirect origins (all of them), host always shown", async () => {
  const good = await register(h.base, "whatever name", [CLAUDE_CB]);
  const c = await toConsent(h.base, good.body.client_id, CLAUDE_CB);
  assert.match(c.html, /✓ 확인된 앱/);
  assert.match(c.html, /<h1>Claude가 페르소나 허브 연결을 요청해요/, "display name comes from the allowlist");
  assert.match(c.html, /정보를 받는 주소: <code>claude\.ai<\/code>/);

  const mixed = await register(h.base, "Claude", [CLAUDE_CB, "https://evil.example/cb"]);
  const m = await toConsent(h.base, mixed.body.client_id, CLAUDE_CB);
  assert.doesNotMatch(m.html, /✓ 확인된 앱/, "one non-allowlisted redirect_uri → not verified");
  assert.match(m.html, /공식 앱이 아닐 수 있어요/);

  const lookalike = await register(h.base, "Claude", ["https://claude.ai.evil.example/cb"]);
  assert.doesNotMatch((await toConsent(h.base, lookalike.body.client_id, "https://claude.ai.evil.example/cb")).html, /✓ 확인된 앱/);
});

test("C-1: allowlist config parsing and brand detection", () => {
  assert.deepEqual(parseKnownClients(undefined), DEFAULT_KNOWN_CLIENTS);
  assert.deepEqual(parseKnownClients('{"https://claude.ai":"Claude"}'), { "https://claude.ai": "Claude" });
  assert.throws(() => parseKnownClients('{"https://claude.ai/cb":"Claude"}'), /exact https origin/);
  assert.throws(() => parseKnownClients('{"http://claude.ai":"Claude"}'), /https/);
  assert.throws(() => parseKnownClients("nope"), /JSON/);
  assert.equal(brandIn("C l a u d e"), "claude");
  assert.equal(brandIn("ＣｈａｔＧＰＴ helper"), "chatgpt");
  assert.equal(brandIn("My notes app"), null);
});

// ---------- H-3 ----------

test("H-3: errors for untrusted clients render our page instead of redirecting", async () => {
  const reg = await register(h.base, "Some app", ["https://evil.example/cb"]);
  const q = new URLSearchParams({ client_id: reg.body.client_id, response_type: "token" });
  const r = await fetch(`${h.base}/authorize?${q}`, { redirect: "manual" });
  assert.equal(r.status, 400);
  assert.equal(r.headers.get("location"), null);
  assert.match(await r.text(), /unsupported_response_type/);

  // Allowlisted client keeps spec behaviour.
  const good = await register(h.base, "c", [CLAUDE_CB]);
  const g = await fetch(`${h.base}/authorize?${new URLSearchParams({ client_id: good.body.client_id, response_type: "token", state: "x" })}`, { redirect: "manual" });
  assert.equal(g.status, 302);
  assert.match(g.headers.get("location") ?? "", /^https:\/\/claude\.ai\/api\/mcp\/auth_callback\?error=unsupported_response_type/);
});

test("H-3: a previously approved (client, redirect_uri) gets spec error redirects", async () => {
  const reg = await register(h.base, "local app", [LOCAL]);
  const c = await toConsent(h.base, reg.body.client_id, LOCAL);
  assert.equal((await approve(h.base, c)).status, 303);
  const r = await fetch(`${h.base}/authorize?${new URLSearchParams({ client_id: reg.body.client_id, response_type: "token" })}`, { redirect: "manual" });
  assert.equal(r.status, 302);
  assert.match(r.headers.get("location") ?? "", /error=unsupported_response_type/);
});

// ---------- M-1 ----------

test("M-1: /register is rate limited per IP", async () => {
  const h2 = await start({}, { registerPerHour: 3 });
  try {
    for (let i = 0; i < 3; i++) assert.equal((await register(h2.base, "a", [LOCAL])).status, 201);
    const r = await register(h2.base, "a", [LOCAL]);
    assert.equal(r.status, 429);
    assert.equal(r.body.error, "slow_down");
    // X-Forwarded-For is not trusted by default (M-9), so spoofing it doesn't reset the bucket.
    const spoof = await fetch(`${h2.base}/register`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "1.2.3.4" }, body: JSON.stringify({ redirect_uris: [LOCAL] }) });
    assert.equal(spoof.status, 429);
  } finally {
    await h2.close();
  }
});

test("M-1: failed login rotates CSRF and locks out after 5 failures", async () => {
  const h2 = await start();
  try {
    const reg = await register(h2.base, "a", [LOCAL]);
    const { challenge } = pkce();
    const q = new URLSearchParams({ client_id: reg.body.client_id, redirect_uri: LOCAL, response_type: "code", code_challenge: challenge, code_challenge_method: "S256" });
    const a = await fetch(`${h2.base}/authorize?${q}`);
    const cookie = cookieOf(a)!;
    let fields = hidden(await a.text());
    const first = await fetch(`${h2.base}/authorize/login`, { method: "POST", headers: { cookie }, body: form({ ...fields, password: "wrong" }) });
    assert.equal(first.status, 401);
    const next = hidden(await first.text());
    assert.notEqual(next.csrf, fields.csrf, "csrf rotated after a failure");
    const replay = await fetch(`${h2.base}/authorize/login`, { method: "POST", headers: { cookie }, body: form({ ...fields, password: PASSWORD }) });
    assert.equal(replay.status, 403, "old csrf is dead");
    fields = next;
    for (let i = 0; i < 4; i++) {
      const r = await fetch(`${h2.base}/authorize/login`, { method: "POST", headers: { cookie }, body: form({ ...fields, password: "wrong" }) });
      fields = hidden(await r.text());
    }
    const locked = await fetch(`${h2.base}/authorize/login`, { method: "POST", headers: { cookie }, body: form({ ...fields, password: PASSWORD }) });
    assert.equal(locked.status, 429, "even the right password is refused while locked");
    assert.ok(Number(locked.headers.get("retry-after")) >= 1);
  } finally {
    await h2.close();
  }
});

test("M-1: /token is rate limited per client + IP", async () => {
  const reg = await register(h.base, "a", [LOCAL]);
  let last = 0;
  for (let i = 0; i < 61; i++) {
    const r = await fetch(`${h.base}/token`, { method: "POST", body: form({ grant_type: "authorization_code", code: "x", code_verifier: "y", client_id: reg.body.client_id }) });
    last = r.status;
  }
  assert.equal(last, 429);
});

// ---------- M-2 ----------

test("M-2: login reissues the session id; the pre-login cookie can't consent", async () => {
  const reg = await register(h.base, "a", [LOCAL]);
  const c = await toConsent(h.base, reg.body.client_id, LOCAL);
  assert.ok(c.cookie && c.cookie !== c.pre);
  const fixated = await fetch(`${h.base}/authorize/consent`, {
    method: "POST", redirect: "manual", headers: { cookie: c.pre },
    body: form({ ...hidden(c.html), persona_ids: [PERSONA_WORK], max_sensitivity: "normal", decision: "approve" }),
  });
  assert.notEqual(fixated.status, 303, "old session id must not be logged in");
});

// ---------- M-3 ----------

test("M-3: resource is bound to the code; /token can't change it; MCP rejects foreign audiences", async () => {
  const reg = await register(h.base, "a", [LOCAL]);
  // default resource = our /mcp
  const c = await toConsent(h.base, reg.body.client_id, LOCAL);
  const code = new URL((await approve(h.base, c)).headers.get("location")!).searchParams.get("code")!;
  const bad = await exchange(h.base, reg.body.client_id, code, c.verifier, LOCAL, { resource: "https://other.example/api" });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, "invalid_target");

  const c2 = await toConsent(h.base, reg.body.client_id, LOCAL);
  const code2 = new URL((await approve(h.base, c2)).headers.get("location")!).searchParams.get("code")!;
  const ok = await exchange(h.base, reg.body.client_id, code2, c2.verifier, LOCAL);
  assert.equal(ok.status, 200);
  assert.equal(h.server.oauth.verifyAccessToken(ok.body.access_token)?.resource, `${h.base}/mcp`);
  assert.equal((await mcpStatus(h.base, ok.body.access_token)).status, 200);

  // A token issued for another resource is refused by /mcp.
  const c3 = await toConsent(h.base, reg.body.client_id, LOCAL, { resource: "https://other.example/api" });
  const code3 = new URL((await approve(h.base, c3)).headers.get("location")!).searchParams.get("code")!;
  const other = await exchange(h.base, reg.body.client_id, code3, c3.verifier, LOCAL);
  assert.equal(other.status, 200);
  assert.equal((await mcpStatus(h.base, other.body.access_token)).status, 401);
});

// ---------- M-4 ----------

test("M-4: '민감 포함' needs the sensitive-data consent; withdrawing it downgrades connections", async () => {
  const h2 = await start();
  try {
    const user = h2.server.store.users.get(TEST_USER_ID)!;
    const reg = await register(h2.base, "a", [LOCAL]);
    // With consent: sensitive connection is possible.
    const c = await toConsent(h2.base, reg.body.client_id, LOCAL);
    assert.match(c.html, /value="sensitive"> 민감 포함/);
    assert.equal((await approve(h2.base, c, "sensitive")).status, 303);
    const conn = h2.server.core.listConnections(TEST_USER_ID).find((x) => !x.revoked_at)!;
    assert.equal(conn.max_sensitivity, "sensitive");

    // Withdraw via /v1 → every active connection drops to normal.
    const { access_token: t } = await h2.login("test-user");
    const w = await h2.call("/me/consents", { method: "PATCH", token: t, body: { sensitive_data: false } });
    assert.equal(w.status, 200);
    assert.equal(h2.server.core.activeConnection(conn.id)!.max_sensitivity, "normal");

    // Without consent: radio disabled, server rejects a forged POST.
    assert.equal(user.consents!.sensitive_data, false);
    const c2 = await toConsent(h2.base, reg.body.client_id, LOCAL);
    assert.match(c2.html, /value="sensitive" disabled/);
    const forged = await approve(h2.base, c2, "sensitive");
    assert.equal(forged.status, 400);

    // /v1 widening to sensitive is refused even with step-up.
    const su = await h2.stepUp(t);
    const p = await h2.call(`/connections/${conn.id}`, { method: "PATCH", token: t, headers: { "x-step-up-token": su }, body: { max_sensitivity: "sensitive" } });
    assert.equal(p.status, 400);
    assert.equal(p.body.error.field, "max_sensitivity");
  } finally {
    await h2.close();
  }
});

// ---------- L-1 / L-2 / L-6 ----------

test("L-1: malformed cookie / Basic header → 400 without a stack trace", async () => {
  const reg = await register(h.base, "a", [LOCAL]);
  const { challenge } = pkce();
  const q = new URLSearchParams({ client_id: reg.body.client_id, redirect_uri: LOCAL, response_type: "code", code_challenge: challenge, code_challenge_method: "S256" });
  const r = await fetch(`${h.base}/authorize?${q}`, { headers: { cookie: "ph_sid=%E0%A4%A" } });
  assert.equal(r.status, 400);
  const body = await r.text();
  assert.doesNotMatch(body, /URIError|at .*\.ts|node_modules/);

  const basic = Buffer.from("%E0:x").toString("base64");
  const t = await fetch(`${h.base}/token`, { method: "POST", headers: { authorization: `Basic ${basic}` }, body: form({ grant_type: "refresh_token", refresh_token: "x" }) });
  assert.equal(t.status, 400);
  assert.doesNotMatch(await t.text(), /URIError|\.ts:/);
});

test("L-2: CSP uses a nonce for the inline script and limits form-action to self + redirect origin", async () => {
  const reg = await register(h.base, "a", [LOCAL]);
  const c = await toConsent(h.base, reg.body.client_id, LOCAL);
  const csp = c.login.headers.get("content-security-policy") ?? "";
  const nonce = /script-src 'nonce-([^']+)'/.exec(csp)?.[1];
  assert.ok(nonce, csp);
  assert.ok(c.html.includes(`<script nonce="${nonce}">`));
  assert.doesNotMatch(csp, /script-src[^;]*unsafe-inline/);
  assert.match(csp, /form-action 'self' http:\/\/localhost:9;/);
  assert.doesNotMatch(csp, /form-action[^;]*https:(?!\/\/)/, "no blanket https: in form-action");
  assert.equal(c.login.headers.get("x-content-type-options"), "nosniff");
});

test("L-6: DCR client secrets are stored hashed and still authenticate", async () => {
  const reg = await register(h.base, "confidential", [LOCAL], { token_endpoint_auth_method: "client_secret_post" });
  assert.ok(reg.body.client_secret);
  const c = await toConsent(h.base, reg.body.client_id, LOCAL);
  const code = new URL((await approve(h.base, c)).headers.get("location")!).searchParams.get("code")!;
  const wrong = await exchange(h.base, reg.body.client_id, code, c.verifier, LOCAL, { client_secret: "nope" });
  assert.equal(wrong.status, 401);
  const ok = await exchange(h.base, reg.body.client_id, code, c.verifier, LOCAL, { client_secret: reg.body.client_secret });
  assert.equal(ok.status, 200);
});
