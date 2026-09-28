import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { PERSONA_WORK, TEST_USER_ID } from "../src/core/index.js";
import { start, type Harness } from "./api-helpers.js";

let h: Harness;
before(async () => { h = await start(); });
after(() => h.close());

async function persona(t: string) {
  return (await h.call("/personas", { token: t, body: { name: "업무" } })).body.id as string;
}

test("create normal fact matches spec example shape", async () => {
  const { access_token: t } = await h.login("f-create");
  const pid = await persona(t);
  const r = await h.call(`/personas/${pid}/facts`, { token: t, body: { category: "work", body: "핀테크 스타트업 백엔드 개발자, Kotlin·Spring 주력", sensitivity: "normal" } });
  assert.equal(r.status, 201);
  assert.deepEqual(Object.keys(r.body).sort(), ["body", "category", "created_at", "id", "persona_id", "sensitivity", "source", "updated_at", "version"]);
  assert.match(r.body.id, /^fct_/);
  assert.equal(r.body.source, "manual");
  assert.equal(r.body.version, 1);
});

test("private patterns are rejected with the spec message", async () => {
  const { access_token: t } = await h.login("f-private");
  const pid = await persona(t);
  const r = await h.call(`/personas/${pid}/facts`, { token: t, body: { category: "finance", body: "급여 계좌 110-123-456789", sensitivity: "normal" } });
  assert.equal(r.status, 400);
  assert.equal(r.body.error.code, "fact_private_pattern");
  assert.equal(r.body.error.message, "계좌번호처럼 보여요. 이런 정보는 저장하지 않아요.");
  assert.equal(r.body.error.field, "body");
  const ok = await h.call(`/personas/${pid}/facts`, { token: t, body: { category: "work", body: "개발자" } });
  const patch = await h.call(`/facts/${ok.body.id}`, { method: "PATCH", token: t, body: { body: "카드 4111 1111 1111 1111" } });
  assert.equal(patch.body.error.code, "fact_private_pattern");
});

test("sensitive facts need step-up for create, list and patch", async () => {
  const { access_token: t } = await h.login("f-stepup");
  const pid = await persona(t);
  const body = { category: "health", body: "땅콩 알레르기", sensitivity: "sensitive" };
  const denied = await h.call(`/personas/${pid}/facts`, { token: t, body });
  assert.equal(denied.status, 401);
  assert.equal(denied.body.error.code, "step_up_required");

  const su = await h.stepUp(t);
  const created = await h.call(`/personas/${pid}/facts`, { token: t, body, headers: { "x-step-up-token": su } });
  assert.equal(created.status, 201);
  await h.call(`/personas/${pid}/facts`, { token: t, body: { category: "work", body: "개발자" } });

  // Without step-up: only normal facts, with a locked count; explicit sensitive filter → 401.
  const plain = await h.call(`/personas/${pid}/facts`, { token: t });
  assert.deepEqual(plain.body.items.map((f: any) => f.sensitivity), ["normal"]);
  assert.equal(plain.body.locked_count, 1);
  assert.equal((await h.call(`/personas/${pid}/facts?sensitivity=sensitive`, { token: t })).status, 401);
  const full = await h.call(`/personas/${pid}/facts`, { token: t, headers: { "x-step-up-token": su } });
  assert.equal(full.body.items.length, 2);
  const onlyHealth = await h.call(`/personas/${pid}/facts?category=health`, { token: t, headers: { "x-step-up-token": su } });
  assert.deepEqual(onlyHealth.body.items.map((f: any) => f.id), [created.body.id]);

  assert.equal((await h.call(`/facts/${created.body.id}`, { method: "PATCH", token: t, body: { body: "땅콩·호두 알레르기" } })).status, 401);
  const patched = await h.call(`/facts/${created.body.id}`, { method: "PATCH", token: t, headers: { "x-step-up-token": su }, body: { body: "땅콩·호두 알레르기" } });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.version, 2);

  // Raising a normal fact to sensitive also needs step-up.
  const n = plain.body.items[0].id;
  assert.equal((await h.call(`/facts/${n}`, { method: "PATCH", token: t, body: { sensitivity: "sensitive" } })).status, 401);
  // Step-up token of another user is useless.
  const other = await h.login("f-stepup-other");
  const otherSu = await h.stepUp(other.access_token);
  assert.equal((await h.call(`/personas/${pid}/facts`, { token: t, body, headers: { "x-step-up-token": otherSu } })).status, 401);
});

test("fact If-Match conflict", async () => {
  const { access_token: t } = await h.login("f-ver");
  const pid = await persona(t);
  const f = (await h.call(`/personas/${pid}/facts`, { token: t, body: { category: "work", body: "a" } })).body;
  assert.equal((await h.call(`/facts/${f.id}`, { method: "PATCH", token: t, headers: { "if-match": "1" }, body: { body: "b" } })).status, 200);
  const r = await h.call(`/facts/${f.id}`, { method: "PATCH", token: t, headers: { "if-match": "1" }, body: { body: "c" } });
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, "version_conflict");
  assert.equal((await h.call(`/facts/${f.id}`, { method: "DELETE", token: t, headers: { "if-match": "1" } })).status, 409);
});

test("deleted fact disappears from app and MCP paths", async () => {
  const { access_token: t } = await h.login("test-user");
  const core = h.server.core;
  const conn = core.createConnection({ user_id: TEST_USER_ID, client_id: "c", client_name: "Claude", persona_ids: [PERSONA_WORK], max_sensitivity: "sensitive" });
  assert.ok(core.searchFacts(conn, "Kotlin", undefined, 10).some((f) => f.id === "fct_W02"));
  assert.equal((await h.call("/facts/fct_W02", { method: "DELETE", token: t })).status, 204);
  assert.ok(!core.searchFacts(conn, "Kotlin Spring", undefined, 10).some((f) => f.id === "fct_W02"));
  assert.ok(!core.visibleFacts(conn, PERSONA_WORK).some((f) => f.id === "fct_W02"));
  const su = await h.stepUp(t);
  const list = await h.call(`/personas/${PERSONA_WORK}/facts`, { token: t, headers: { "x-step-up-token": su } });
  assert.ok(!list.body.items.some((f: any) => f.id === "fct_W02"));
  assert.equal((await h.call("/facts/fct_W02", { method: "PATCH", token: t, body: { body: "x" } })).status, 404);
  // A newly added fact is visible to MCP immediately.
  await h.call(`/personas/${PERSONA_WORK}/facts`, { token: t, body: { category: "work", body: "Rust도 공부 중" } });
  assert.ok(core.searchFacts(conn, "Rust", undefined, 10).some((f) => f.body.includes("Rust")));
});
