// Regression tests for H-1, H-2, M-5, M-6, M-9, L-5, L-7 (docs/SECURITY_REVIEW.md).
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { PERSONA_HEALTH, PERSONA_WORK, TEST_USER_ID } from "../src/core/index.js";
import { loadEnvConfig, parseTrustProxy } from "../src/config.js";
import { safeEqual } from "../src/main.js";
import { signJwt, verifyJwt } from "../src/api/jwt.js";
import { rateLimitKeyCount, resetRateLimits, sweepRateLimits } from "../src/mcp/index.js";
import { oauthConnect, start, type Harness } from "./api-helpers.js";

let h: Harness;
before(async () => { h = await start(); });
after(() => h.close());

// ---------- H-1 ----------

test("H-1: step-up is bound to the session and dies with it", async () => {
  const a = await h.login("su-user");
  const b = await h.login("su-user"); // same user, second device/session
  const su = await h.stepUp(a.access_token);
  const pid = (await h.call("/personas", { token: a.access_token, body: { name: "p" } })).body.id;
  const body = { category: "health", body: "x", sensitivity: "sensitive" };
  assert.equal((await h.call(`/personas/${pid}/facts`, { token: b.access_token, headers: { "x-step-up-token": su }, body })).status, 401, "other session");
  assert.equal((await h.call(`/personas/${pid}/facts`, { token: a.access_token, headers: { "x-step-up-token": su }, body })).status, 201);
  // Non-high-risk: reusable within 5 minutes.
  assert.equal((await h.call(`/personas/${pid}/facts`, { token: a.access_token, headers: { "x-step-up-token": su }, body })).status, 201);
  // Revoked session → token dead even if presented with a live access token of that user.
  assert.equal((await h.call("/auth/logout", { token: a.access_token, body: { refresh_token: a.refresh_token } })).status, 204);
  assert.equal(h.server.auth.hasStepUp(su, a.user_id, JSON.parse(Buffer.from(su.split(".")[1], "base64url").toString()).sid), false);
});

test("H-1: step-up is single-use for exports and DELETE /me", async () => {
  const s = await h.login("su-once");
  const su = await h.stepUp(s.access_token);
  const hdr = { "x-step-up-token": su };
  assert.equal((await h.call("/exports", { token: s.access_token, headers: hdr, body: {} })).status, 201);
  const again = await h.call("/exports", { token: s.access_token, headers: hdr, body: {} });
  assert.equal(again.status, 401);
  assert.equal(again.body.error.code, "step_up_required");
  assert.equal((await h.call("/me", { method: "DELETE", token: s.access_token, headers: hdr })).status, 401, "spent token can't delete the account");
});

test("H-1: AppService.updateConnection itself refuses widening without step-up", async () => {
  const conn = h.server.core.createConnection({ user_id: TEST_USER_ID, client_id: "c", client_name: "x", persona_ids: [PERSONA_WORK], max_sensitivity: "normal" });
  const svc = h.server.appService;
  assert.throws(() => svc.updateConnection(TEST_USER_ID, conn.id, { persona_ids: [PERSONA_WORK, PERSONA_HEALTH] }, undefined, { stepUpVerified: false }), /본인 확인/);
  assert.throws(() => svc.updateConnection(TEST_USER_ID, conn.id, { max_sensitivity: "sensitive" }, undefined, { stepUpVerified: false }), /본인 확인/);
  // narrowing never needs it
  assert.equal(svc.updateConnection(TEST_USER_ID, conn.id, { persona_ids: [] }, undefined, { stepUpVerified: false }).persona_ids.length, 0);
  assert.equal(svc.updateConnection(TEST_USER_ID, conn.id, { persona_ids: [PERSONA_WORK] }, undefined, { stepUpVerified: true }).persona_ids.length, 1);
});

// ---------- M-5 / M-6 ----------

test("M-5: download link dies with the session; fact existence is owner-scoped", async () => {
  const s = await h.login("dl-user");
  const su = await h.stepUp(s.access_token);
  const e = await h.call("/exports", { token: s.access_token, headers: { "x-step-up-token": su }, body: {} });
  const g = await h.call(`/exports/${e.body.id}`, { token: s.access_token });
  assert.equal((await fetch(g.body.download_url)).status, 200);
  assert.equal((await fetch(g.body.download_url)).headers.get("referrer-policy"), "no-referrer");
  await h.call("/auth/logout", { token: s.access_token, body: { refresh_token: s.refresh_token } });
  assert.equal((await fetch(g.body.download_url)).status, 404);

  assert.equal(h.server.appService.ownFactExists(TEST_USER_ID, "fct_W01"), true);
  assert.equal(h.server.appService.ownFactExists(s.user_id, "fct_W01"), false);
  assert.equal("factExists" in h.server.appService, false);
  assert.equal("exportById" in h.server.appService, false);
});

test("M-6: exports expire after 24h and are purged", async () => {
  const s = await h.login("exp-ttl");
  const su = await h.stepUp(s.access_token);
  const e = await h.call("/exports", { token: s.access_token, headers: { "x-step-up-token": su }, body: {} });
  const ttl = Date.parse(e.body.expires_at) - Date.now();
  assert.ok(ttl > 23.9 * 3600_000 && ttl <= 24 * 3600_000);
  const g = await h.call(`/exports/${e.body.id}`, { token: s.access_token });
  assert.ok(h.server.appService.purgeExpiredExports(Date.now() + 25 * 3600_000) >= 1);
  assert.equal(h.server.store.exports.has(e.body.id), false);
  assert.equal((await h.call(`/exports/${e.body.id}`, { token: s.access_token })).status, 404);
  assert.equal((await fetch(g.body.download_url)).status, 404);
});

// ---------- M-9 ----------

test("M-9: idempotency never caches unauthenticated requests", async () => {
  const key = { "idempotency-key": "same-key" };
  const a = await h.call("/auth/login", { headers: key, body: { provider: "dev", id_token: "idem-a" } });
  const b = await h.call("/auth/login", { headers: key, body: { provider: "dev", id_token: "idem-b" } });
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.notEqual(a.body.user_id, b.body.user_id, "no replay of another caller's response");
  assert.equal(b.headers.get("idempotent-replayed"), null);
});

test("M-9: X-Forwarded-For is ignored unless TRUST_PROXY is set", async () => {
  const h2 = await start({ rateLimitPerMinute: 2 });
  try {
    for (let i = 0; i < 2; i++) await h2.call("/auth/refresh", { headers: { "x-forwarded-for": `9.9.9.${i}` }, body: { refresh_token: "x" } });
    const r = await h2.call("/auth/refresh", { headers: { "x-forwarded-for": "8.8.8.8" }, body: { refresh_token: "x" } });
    assert.equal(r.status, 429);
  } finally {
    await h2.close();
  }
  assert.equal(parseTrustProxy(undefined), false);
  assert.equal(parseTrustProxy("1"), 1);
  assert.throws(() => parseTrustProxy("true"));
});

// ---------- H-2 ----------

test("H-2: production refuses to start with missing secrets or dev login", () => {
  const good = {
    NODE_ENV: "production", BASE_URL: "https://api.personahub.app",
    TEST_USER_PASSWORD: "x".repeat(16), APP_TOKEN: "a".repeat(40), JWT_SECRET: "s".repeat(40),
  };
  assert.equal(loadEnvConfig(good).production, true);
  for (const k of ["TEST_USER_PASSWORD", "APP_TOKEN", "JWT_SECRET"] as const) {
    const env: Record<string, string> = { ...good };
    delete env[k];
    assert.throws(() => loadEnvConfig(env), new RegExp(k));
  }
  assert.throws(() => loadEnvConfig({ ...good, JWT_SECRET: "short" }), /JWT_SECRET/);
  assert.throws(() => loadEnvConfig({ ...good, ALLOW_DEV_LOGIN: "1" }), /ALLOW_DEV_LOGIN/);
  assert.throws(() => loadEnvConfig({ ...good, BASE_URL: "http://x" }), /https/);
  // Dev keeps working without anything set.
  const dev = loadEnvConfig({ ALLOW_DEV_LOGIN: "1" });
  assert.equal(dev.production, false);
  assert.equal(dev.allowDevLogin, true);
});

test("H-2: static app token compare is timing-safe and exact; /app can be disabled", async () => {
  assert.equal(safeEqual("abc", "abc"), true);
  assert.equal(safeEqual("abc", "abd"), false);
  assert.equal(safeEqual("abc", "abcd"), false);
  assert.equal((await fetch(`${h.base}/app/connections`, { headers: { authorization: "Bearer test-app-tokenX" } })).status, 401);
  assert.equal((await fetch(`${h.base}/app/connections`, { headers: { authorization: "Bearer test-app-token" } })).status, 200);
  const h2 = await start({ enablePocAppApi: false });
  try {
    assert.equal((await fetch(`${h2.base}/app/connections`, { headers: { authorization: "Bearer test-app-token" } })).status, 404);
  } finally {
    await h2.close();
  }
});

// ---------- L-7 ----------

test("L-7: JWT keys are separated per typ, iss/aud checked", () => {
  const now = Math.floor(Date.now() / 1000);
  const claims = { sub: "u", typ: "access", iat: now, exp: now + 60, iss: "i", aud: "a" };
  const tok = signJwt(claims, "secret");
  assert.equal(verifyJwt(tok, "secret", "access", { iss: "i", aud: "a" }).ok, true);
  assert.equal(verifyJwt(tok, "secret", "access", { iss: "other", aud: "a" }).ok, false);
  assert.equal(verifyJwt(tok, "secret", "access", { iss: "i", aud: "other" }).ok, false);
  // Same payload re-labelled as step_up with a signature from the access key → invalid.
  const [hd] = tok.split(".");
  const body = Buffer.from(JSON.stringify({ ...claims, typ: "step_up" })).toString("base64url");
  const accessKeySig = tok.split(".")[2];
  assert.equal(verifyJwt(`${hd}.${body}.${accessKeySig}`, "secret", "step_up").ok, false);
  // A token signed with the raw master secret (pre-L-7 format) is rejected.
  const raw = `${hd}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}`;
  assert.equal(verifyJwt(`${raw}.${createHmac("sha256", "secret").update(raw).digest("base64url")}`, "secret", "access").ok, false);
});

// ---------- L-5 ----------

test("L-5: MCP rate-limit map is swept", async () => {
  resetRateLimits();
  const token = await oauthConnect(h.base, [PERSONA_WORK], "normal");
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
  const client = new Client({ name: "t", version: "0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${h.base}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
  await client.callTool({ name: "list_personas", arguments: {} });
  assert.equal(rateLimitKeyCount(), 1);
  assert.equal(sweepRateLimits(Date.now() + 61_000), 1);
  assert.equal(rateLimitKeyCount(), 0);
  await client.close();
});
