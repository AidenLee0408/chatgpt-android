import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { PERSONA_HOBBY, PERSONA_WORK, TEST_USER_ID } from "../src/core/index.js";
import { start, type Harness } from "./api-helpers.js";

let h: Harness;
before(async () => { h = await start(); });
after(() => h.close());

test("persona CRUD + archived filter", async () => {
  const { access_token: t } = await h.login("p-crud");
  const c = await h.call("/personas", { token: t, body: { name: "업무", icon: "briefcase", description: "개발자", instructions: "결론 먼저" } });
  assert.equal(c.status, 201);
  assert.match(c.body.id, /^per_/);
  assert.equal(c.body.version, 1);
  assert.equal(c.body.fact_count, 0);
  assert.equal(c.body.description, "개발자");

  const got = await h.call(`/personas/${c.body.id}`, { token: t });
  assert.equal(got.status, 200);
  assert.deepEqual(got.body.fact_counts, { total: 0, normal: 0, sensitive: 0, private: 0 });

  const p = await h.call(`/personas/${c.body.id}`, { method: "PATCH", token: t, body: { archived: true, name: "옛 업무" } });
  assert.equal(p.status, 200);
  assert.equal(p.body.version, 2);
  assert.equal((await h.call("/personas", { token: t })).body.items.length, 0);
  assert.equal((await h.call("/personas?archived=true", { token: t })).body.items[0].name, "옛 업무");
  assert.equal((await h.call("/personas?archived=all", { token: t })).body.items.length, 1);

  assert.equal((await h.call(`/personas/${c.body.id}`, { method: "DELETE", token: t })).status, 204);
  assert.equal((await h.call(`/personas/${c.body.id}`, { token: t })).status, 404);
});

test("validation: Korean message + field", async () => {
  const { access_token: t } = await h.login("p-val");
  const r = await h.call("/personas", { token: t, body: { name: "" } });
  assert.equal(r.status, 400);
  assert.equal(r.body.error.field, "name");
  assert.equal(r.body.error.message, "이름을 입력해 주세요.");
});

test("free plan: 4th persona → 403 plan_limit_reached (archived still counts)", async () => {
  const { access_token: t } = await h.login("p-limit");
  for (let i = 0; i < 3; i++) assert.equal((await h.call("/personas", { token: t, body: { name: `p${i}` } })).status, 201);
  const r = await h.call("/personas", { token: t, body: { name: "p4" } });
  assert.equal(r.status, 403);
  assert.equal(r.body.error.code, "plan_limit_reached");
  assert.match(r.body.error.message, /3개/);
});

test("pro plan hard max 10", async () => {
  const s = await h.login("p-pro");
  h.server.store.users.get(s.user_id)!.plan = "pro";
  for (let i = 0; i < 10; i++) assert.equal((await h.call("/personas", { token: s.access_token, body: { name: `p${i}` } })).status, 201);
  assert.equal((await h.call("/personas", { token: s.access_token, body: { name: "p11" } })).status, 403);
});

test("other users' personas look exactly like missing ones", async () => {
  const { access_token: t } = await h.login("p-other");
  const theirs = await h.call(`/personas/${PERSONA_WORK}`, { token: t });
  const missing = await h.call(`/personas/per_DOESNOTEXIST`, { token: t });
  assert.equal(theirs.status, 404);
  assert.equal(theirs.body.error.message, missing.body.error.message);
  assert.equal((await h.call(`/personas/${PERSONA_WORK}`, { method: "PATCH", token: t, body: { name: "x" } })).status, 404);
  assert.equal((await h.call(`/personas/${PERSONA_WORK}/facts`, { token: t })).status, 404);
  assert.equal((await h.call(`/facts/fct_W01`, { method: "DELETE", token: t })).status, 404);
});

test("If-Match mismatch → 409 version_conflict", async () => {
  const { access_token: t } = await h.login("p-ifmatch");
  const c = await h.call("/personas", { token: t, body: { name: "a" } });
  const ok = await h.call(`/personas/${c.body.id}`, { method: "PATCH", token: t, headers: { "if-match": "1" }, body: { name: "b" } });
  assert.equal(ok.status, 200);
  const stale = await h.call(`/personas/${c.body.id}`, { method: "PATCH", token: t, headers: { "if-match": "1" }, body: { name: "c" } });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error.code, "version_conflict");
  assert.equal((await h.call(`/personas/${c.body.id}`, { token: t })).body.name, "b");
  assert.equal((await h.call(`/personas/${c.body.id}`, { method: "PATCH", token: t, headers: { "if-match": `"2"` }, body: { name: "d" } })).status, 200);
});

test("Idempotency-Key replays the first response", async () => {
  const { access_token: t } = await h.login("p-idem");
  const headers = { "idempotency-key": "7d7b1c1e-0000-4000-8000-000000000001" };
  const a = await h.call("/personas", { token: t, headers, body: { name: "once" } });
  const b = await h.call("/personas", { token: t, headers, body: { name: "once" } });
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  assert.deepEqual(b.body, a.body);
  assert.equal(b.headers.get("idempotent-replayed"), "true");
  assert.equal((await h.call("/personas", { token: t })).body.items.length, 1);
  // Same key, different payload → rejected.
  assert.equal((await h.call("/personas", { token: t, headers, body: { name: "twice" } })).status, 400);
  // Keys are per user.
  const other = await h.login("p-idem-2");
  assert.equal((await h.call("/personas", { token: other.access_token, headers, body: { name: "once" } })).body.id === a.body.id, false);
});

test("cursor pagination", async () => {
  const s = await h.login("p-page");
  h.server.store.users.get(s.user_id)!.plan = "pro";
  for (let i = 0; i < 5; i++) await h.call("/personas", { token: s.access_token, body: { name: `p${i}` } });
  const p1 = await h.call("/personas?limit=2", { token: s.access_token });
  assert.equal(p1.body.items.length, 2);
  assert.ok(p1.body.next_cursor);
  const p2 = await h.call(`/personas?limit=2&cursor=${p1.body.next_cursor}`, { token: s.access_token });
  assert.notEqual(p2.body.items[0].id, p1.body.items[0].id);
  const p3 = await h.call(`/personas?limit=2&cursor=${p2.body.next_cursor}`, { token: s.access_token });
  assert.equal(p3.body.items.length, 1);
  assert.equal(p3.body.next_cursor, null);
  assert.equal((await h.call("/personas?limit=101", { token: s.access_token })).status, 400);
});

test("deleting a persona strips it from every connection's scope", async () => {
  const { access_token: t } = await h.login("test-user");
  const core = h.server.core;
  const conn = core.createConnection({ user_id: TEST_USER_ID, client_id: "c", client_name: "Claude", persona_ids: [PERSONA_WORK, PERSONA_HOBBY], max_sensitivity: "normal" });
  assert.equal((await h.call(`/personas/${PERSONA_HOBBY}`, { method: "DELETE", token: t })).status, 204);
  const c = await h.call(`/connections/${conn.id}`, { token: t });
  assert.deepEqual(c.body.persona_ids, [PERSONA_WORK]);
  assert.equal(c.body.version, 2);
  assert.deepEqual(core.searchFacts(core.activeConnection(conn.id)!, "러닝", undefined, 10), []);
  assert.equal(h.server.store.facts.get("fct_H01"), undefined);
});
