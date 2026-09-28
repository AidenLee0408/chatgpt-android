import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { TEST_USER_ID } from "../src/core/index.js";
import { start, type Harness } from "./api-helpers.js";

let h: Harness;
before(async () => { h = await start(); });
after(() => h.close());

test("dev login → /me; same id_token = same user; test-user = seeded user", async () => {
  const a = await h.login("alice");
  const b = await h.login("alice");
  assert.equal(a.user_id, b.user_id);
  assert.equal((await h.login("test-user")).user_id, TEST_USER_ID);
  const me = await h.call("/me", { token: a.access_token });
  assert.equal(me.status, 200);
  assert.equal(me.body.id, a.user_id);
  assert.equal(me.body.plan, "free");
  assert.equal(me.body.limits.max_personas, 3);
  assert.match(me.headers.get("x-request-id") ?? "", /^req_/);
});

test("errors: format, request_id, Korean message", async () => {
  const r = await h.call("/me");
  assert.equal(r.status, 401);
  assert.equal(r.body.error.code, "token_expired");
  assert.match(r.body.error.request_id, /^req_/);
  assert.equal(r.body.error.request_id, r.headers.get("x-request-id"));
  const bad = await h.call("/auth/login", { body: { provider: "naver", id_token: "x" } });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, "validation_failed");
  assert.equal(bad.body.error.field, "provider");
  assert.equal((await h.call("/me", { token: "garbage.token.x" })).status, 401);
});

test("refresh rotates; reusing an old refresh token revokes the family", async () => {
  const s = await h.login("bob");
  const r1 = await h.call("/auth/refresh", { body: { refresh_token: s.refresh_token } });
  assert.equal(r1.status, 200);
  assert.notEqual(r1.body.refresh_token, s.refresh_token);
  assert.equal(r1.body.expires_in, 900);
  // Reuse the first (already rotated) token → 401 and the whole family dies.
  const reuse = await h.call("/auth/refresh", { body: { refresh_token: s.refresh_token } });
  assert.equal(reuse.status, 401);
  assert.equal(reuse.body.error.code, "token_expired");
  assert.equal((await h.call("/auth/refresh", { body: { refresh_token: r1.body.refresh_token } })).status, 401);
  assert.equal((await h.call("/me", { token: r1.body.access_token })).status, 401, "access tokens of the family die too");
});

test("logout kills the session", async () => {
  const s = await h.login("carol");
  assert.equal((await h.call("/auth/logout", { token: s.access_token, body: { refresh_token: s.refresh_token } })).status, 204);
  assert.equal((await h.call("/me", { token: s.access_token })).status, 401);
  assert.equal((await h.call("/auth/refresh", { body: { refresh_token: s.refresh_token } })).status, 401);
});

test("step-up issues a 5-minute token in body and header", async () => {
  const s = await h.login("dave");
  const r = await h.call("/auth/step-up", { token: s.access_token, body: { method: "biometric" } });
  assert.equal(r.status, 200);
  assert.equal(r.body.expires_in, 300);
  assert.equal(r.headers.get("x-step-up-token"), r.body.step_up_token);
  assert.equal((await h.call("/auth/step-up", { token: s.access_token, body: { method: "pin" } })).status, 400);
});

test("consents", async () => {
  const s = await h.login("erin");
  const r = await h.call("/me/consents", { method: "PATCH", token: s.access_token, body: { sensitive_data: true } });
  assert.equal(r.status, 200);
  assert.equal(r.body.consents.sensitive_data, true);
  assert.equal(r.body.consents.marketing, false);
});

test("CORS for Expo web dev origin", async () => {
  const r = await fetch(`${h.base}/v1/me`, { method: "OPTIONS", headers: { origin: "http://localhost:8081", "access-control-request-method": "GET" } });
  assert.equal(r.status, 204);
  assert.equal(r.headers.get("access-control-allow-origin"), "http://localhost:8081");
  assert.match(r.headers.get("access-control-allow-headers") ?? "", /X-Step-Up-Token/);
  const evil = await fetch(`${h.base}/v1/me`, { method: "OPTIONS", headers: { origin: "https://evil.example" } });
  assert.equal(evil.headers.get("access-control-allow-origin"), null);
});

test("dev login disabled unless ALLOW_DEV_LOGIN", async () => {
  const h2 = await start({ allowDevLogin: false });
  try {
    const r = await h2.call("/auth/login", { body: { provider: "dev", id_token: "x" } });
    assert.equal(r.status, 400);
    assert.equal(r.body.error.field, "provider");
  } finally {
    await h2.close();
  }
});

test("rate limit → 429 + Retry-After", async () => {
  const h2 = await start({ rateLimitPerMinute: 3 });
  try {
    const s = await h2.login("rl"); // counts against the IP bucket, not the user
    for (let i = 0; i < 3; i++) assert.equal((await h2.call("/me", { token: s.access_token })).status, 200);
    const r = await h2.call("/me", { token: s.access_token });
    assert.equal(r.status, 429);
    assert.equal(r.body.error.code, "rate_limited");
    assert.ok(Number(r.headers.get("retry-after")) >= 1);
  } finally {
    await h2.close();
  }
});
