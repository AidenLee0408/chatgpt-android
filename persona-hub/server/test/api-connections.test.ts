import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { PERSONA_HEALTH, PERSONA_HOBBY, PERSONA_WORK } from "../src/core/index.js";
import { mcpStatus, oauthConnect, start, type Harness } from "./api-helpers.js";

let h: Harness;
before(async () => { h = await start(); });
after(() => h.close());

test("context pack: sensitive excluded by default, needs step-up to include, private never", async () => {
  const { access_token: t } = await h.login("test-user");
  const r = await h.call("/context-packs", { token: t, body: { persona_ids: [PERSONA_WORK, PERSONA_HEALTH], length: "detailed" } });
  assert.equal(r.status, 200);
  assert.match(r.body.text, /Kotlin/);
  assert.doesNotMatch(r.body.text, /연봉|땅콩|국민은행/);
  assert.equal((await h.call("/context-packs", { token: t, body: { persona_ids: [PERSONA_WORK], include_sensitive: true } })).status, 401);
  const su = await h.stepUp(t);
  const s = await h.call("/context-packs", { token: t, headers: { "x-step-up-token": su }, body: { persona_ids: [PERSONA_WORK, PERSONA_HEALTH], include_sensitive: true, length: "detailed", language: "en" } });
  assert.match(s.body.text, /연봉/);
  assert.match(s.body.text, /땅콩/);
  assert.doesNotMatch(s.body.text, /국민은행/, "private never");
  assert.match(s.body.text, /# Persona: 업무/);
  const short = await h.call("/context-packs", { token: t, body: { persona_ids: [PERSONA_WORK, PERSONA_HOBBY], length: "short" } });
  assert.ok(short.body.char_count <= 330, String(short.body.char_count));
  const other = await h.login("cp-other");
  assert.equal((await h.call("/context-packs", { token: other.access_token, body: { persona_ids: [PERSONA_WORK] } })).status, 404);
});

test("connections: list/get, narrowing is free, widening needs step-up, If-Match, access logs, delete revokes MCP token", async () => {
  const { access_token: t } = await h.login("test-user");
  const mcpToken = await oauthConnect(h.base, [PERSONA_WORK, PERSONA_HOBBY], "normal");
  assert.equal((await mcpStatus(h.base, mcpToken)).status, 200);

  const list = await h.call("/connections", { token: t });
  const conn = list.body.items.find((c: any) => c.status === "active");
  assert.ok(conn);
  assert.equal(conn.client_name, "Claude");
  assert.deepEqual(conn.personas.map((p: any) => p.name).sort(), ["업무", "취미"].sort());
  const got = await h.call(`/connections/${conn.id}`, { token: t });
  assert.equal(got.body.version, 1);

  const narrow = await h.call(`/connections/${conn.id}`, { method: "PATCH", token: t, headers: { "if-match": "1" }, body: { persona_ids: [PERSONA_WORK], max_sensitivity: "normal" } });
  assert.equal(narrow.status, 200);
  assert.equal(narrow.body.version, 2);

  const widen = await h.call(`/connections/${conn.id}`, { method: "PATCH", token: t, body: { persona_ids: [PERSONA_WORK, PERSONA_HEALTH] } });
  assert.equal(widen.status, 401);
  assert.equal(widen.body.error.code, "step_up_required");
  const raise = await h.call(`/connections/${conn.id}`, { method: "PATCH", token: t, body: { max_sensitivity: "sensitive" } });
  assert.equal(raise.body.error.code, "step_up_required");
  const su = await h.stepUp(t);
  const stale = await h.call(`/connections/${conn.id}`, { method: "PATCH", token: t, headers: { "x-step-up-token": su, "if-match": "1" }, body: { max_sensitivity: "sensitive" } });
  assert.equal(stale.status, 409);
  const ok = await h.call(`/connections/${conn.id}`, { method: "PATCH", token: t, headers: { "x-step-up-token": su, "if-match": "2" }, body: { max_sensitivity: "sensitive" } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.max_sensitivity, "sensitive");
  const bad = await h.call(`/connections/${conn.id}`, { method: "PATCH", token: t, body: { max_sensitivity: "private" } });
  assert.equal(bad.status, 400);

  // Access logs (MCP initialize isn't a tool call, so log one directly through core).
  h.server.core.recordAccess({ connection_id: conn.id, client_name: "Claude", tool: "get_persona", persona_ids: [PERSONA_WORK], fact_ids: ["fct_W01"], latency_ms: 3 });
  const logs = await h.call(`/access-logs?connection_id=${conn.id}&limit=20`, { token: t });
  assert.equal(logs.status, 200);
  assert.deepEqual(logs.body.items[0].connection, { id: conn.id, client_name: "Claude" });
  assert.equal(logs.body.items[0].fact_count, 1);
  const future = await h.call(`/access-logs?from=2999-01-01T00:00:00Z`, { token: t });
  assert.equal(future.body.items.length, 0);
  assert.equal((await h.call(`/access-logs?from=yesterday`, { token: t })).status, 400);

  assert.equal((await h.call(`/connections/${conn.id}`, { method: "DELETE", token: t })).status, 204);
  assert.equal((await mcpStatus(h.base, mcpToken)).status, 401);
  assert.equal((await h.call(`/connections/${conn.id}`, { token: t })).body.status, "revoked");

  const other = await h.login("con-other");
  assert.equal((await h.call(`/connections/${conn.id}`, { token: other.access_token })).status, 404);
});

test("connect guides", async () => {
  const { access_token: t } = await h.login("g");
  const r = await h.call("/connect-guides", { token: t });
  assert.deepEqual(r.body.items.map((g: any) => g.client), ["claude", "chatgpt", "gemini"]);
  for (const g of r.body.items) {
    assert.equal(g.mcp_url, `${h.base}/mcp`);
    assert.equal(g.steps[0].n, 1);
  }
  assert.ok(r.body.items[0].steps.some((s: any) => s.text.includes(`${h.base}/mcp`)));
});
