import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { PERSONA_WORK, TEST_USER_ID } from "../src/core/index.js";
import { mcpStatus, oauthConnect, start, type Harness } from "./api-helpers.js";

let h: Harness;
before(async () => { h = await start(); });
after(() => h.close());

test("exports: step-up required, JSON of all data, signed 10-minute download URL", async () => {
  const { access_token: t } = await h.login("test-user");
  assert.equal((await h.call("/exports", { token: t, body: {} })).body.error.code, "step_up_required");
  const su = await h.stepUp(t);
  const c = await h.call("/exports", { token: t, headers: { "x-step-up-token": su }, body: {} });
  assert.equal(c.status, 201);
  const g = await h.call(`/exports/${c.body.id}`, { token: t });
  assert.equal(g.body.status, "ready");
  const ttl = Date.parse(g.body.download_expires_at) - Date.now();
  assert.ok(ttl > 9 * 60_000 && ttl <= 10 * 60_000);

  const dl = await fetch(g.body.download_url);
  assert.equal(dl.status, 200);
  assert.match(dl.headers.get("content-disposition") ?? "", /attachment/);
  const data = (await dl.json()) as any;
  assert.equal(data.user.id, TEST_USER_ID);
  assert.equal(data.personas.length, 3);
  assert.ok(data.facts.some((f: any) => f.sensitivity === "private"), "export is the user's own full data");

  assert.equal((await fetch(g.body.download_url.replace(/token=.*/, "token=bad"))).status, 404);
  const other = await h.login("exp-other");
  assert.equal((await h.call(`/exports/${c.body.id}`, { token: other.access_token })).status, 404);
});

test("DELETE /me: step-up, revokes all MCP access, kills sessions", async () => {
  const s = await h.login("test-user");
  const mcpToken = await oauthConnect(h.base, [PERSONA_WORK], "normal");
  assert.equal((await mcpStatus(h.base, mcpToken)).status, 200);

  assert.equal((await h.call("/me", { method: "DELETE", token: s.access_token })).status, 401);
  const su = await h.stepUp(s.access_token);
  assert.equal((await h.call("/me", { method: "DELETE", token: s.access_token, headers: { "x-step-up-token": su } })).status, 204);

  assert.equal((await mcpStatus(h.base, mcpToken)).status, 401);
  assert.ok(h.server.core.listConnections(TEST_USER_ID).every((c) => c.revoked_at));
  assert.equal((await h.call("/me", { token: s.access_token })).status, 401);
  assert.equal((await h.call("/auth/refresh", { body: { refresh_token: s.refresh_token } })).status, 401);
  // Logging in again with the same identity creates a fresh account.
  const again = await h.login("test-user");
  assert.notEqual(again.user_id, TEST_USER_ID);
  assert.equal((await h.call("/personas", { token: again.access_token })).body.items.length, 0);

  // Purge after 30 days erases the data.
  assert.equal(h.server.appService.purgeDeletedUsers(Date.now() + 31 * 86400_000), 1);
  assert.equal(h.server.store.personas.get(PERSONA_WORK), undefined);
});
