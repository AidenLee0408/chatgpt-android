// End-to-end: DCR → PKCE authorize → login → consent → token → MCP tools → scope change → disconnect.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { createServer as createHttpServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createServer } from "../src/main.js";
import { PERSONA_HEALTH, PERSONA_HOBBY, PERSONA_WORK } from "../src/core/index.js";

const APP_TOKEN = "test-app-token";
const PASSWORD = "pw";
const REDIRECT = "http://localhost:9/callback";
let http: Server;
let base = "";

before(async () => {
  // baseUrl must be known before listening; bind first, then build the app on that port.
  const probe = await new Promise<Server>((r) => { const s = createHttpServer(); s.listen(0, () => r(s)); });
  const port = (probe.address() as AddressInfo).port;
  await new Promise((r) => probe.close(r));
  base = `http://localhost:${port}`;
  const { app } = createServer({ baseUrl: base, testUserPassword: PASSWORD }, APP_TOKEN);
  http = await new Promise<Server>((r) => { const s = app.listen(port, () => r(s)); });
});
after(() => new Promise<void>((r) => http.close(() => r())));


const form = (o: Record<string, string | string[]>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) for (const x of [v].flat()) p.append(k, x);
  return p;
};
const hidden = (html: string) =>
  Object.fromEntries([...html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)].map((m) => [m[1], m[2].replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, "&")]));

async function connect(personaIds: string[], maxSensitivity: "normal" | "sensitive") {
  const reg = await fetch(`${base}/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: "Claude", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none" }),
  });
  assert.equal(reg.status, 201);
  const { client_id } = (await reg.json()) as { client_id: string };

  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const q = new URLSearchParams({ client_id, redirect_uri: REDIRECT, response_type: "code", code_challenge: challenge, code_challenge_method: "S256", state: "xyz" });
  const a = await fetch(`${base}/authorize?${q}`);
  const cookie = a.headers.get("set-cookie")!.split(";")[0];
  const login = await fetch(`${base}/authorize/login`, { method: "POST", headers: { cookie }, body: form({ ...hidden(await a.text()), password: PASSWORD }) });
  const consentHtml = await login.text();
  assert.match(consentHtml, /Claude가 페르소나 허브 연결을 요청해요/);
  const approve = await fetch(`${base}/authorize/consent`, {
    method: "POST", redirect: "manual", headers: { cookie },
    body: form({ ...hidden(consentHtml), persona_ids: personaIds, max_sensitivity: maxSensitivity, decision: "approve" }),
  });
  assert.equal(approve.status, 303);
  const loc = new URL(approve.headers.get("location")!);
  assert.equal(loc.searchParams.get("state"), "xyz");
  assert.ok(loc.searchParams.get("code"), `no code in redirect: ${loc}`);

  const tok = await fetch(`${base}/token`, {
    method: "POST",
    body: form({ grant_type: "authorization_code", code: loc.searchParams.get("code")!, redirect_uri: REDIRECT, client_id, code_verifier: verifier }),
  });
  assert.equal(tok.status, 200, await tok.clone().text());
  return (await tok.json()) as { access_token: string };
}

async function mcp(token: string) {
  const client = new Client({ name: "e2e", version: "0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
  return client;
}
const text = (r: any) => r.content.map((c: any) => c.text).join("\n") as string;
const app = (path: string, init: RequestInit = {}) =>
  fetch(`${base}/app${path}`, { ...init, headers: { authorization: `Bearer ${APP_TOKEN}`, "content-type": "application/json", ...init.headers } });

test("unauthenticated MCP call → 401 with resource metadata", async () => {
  const r = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(r.status, 401);
  assert.match(r.headers.get("www-authenticate") ?? "", /resource_metadata="[^"]+oauth-protected-resource/);
});

test("full flow: scope enforced, changes and revocation apply on next call", async () => {
  const { access_token } = await connect([PERSONA_WORK, PERSONA_HOBBY], "normal");
  const client = await mcp(access_token);

  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map((t) => t.name).sort(), ["get_persona", "list_personas", "search_facts"]);

  const list = text(await client.callTool({ name: "list_personas", arguments: {} }));
  assert.match(list, /업무/);
  assert.match(list, /취미/);
  assert.doesNotMatch(list, /건강/);

  const health = await client.callTool({ name: "get_persona", arguments: { persona_id: PERSONA_HEALTH } });
  const missing = await client.callTool({ name: "get_persona", arguments: { persona_id: "per_DOESNOTEXIST" } });
  assert.equal(health.isError, true);
  assert.equal(text(health), text(missing), "out-of-scope must look identical to nonexistent");

  const work = text(await client.callTool({ name: "get_persona", arguments: { persona_id: PERSONA_WORK, detail: "full" } }));
  assert.match(work, /Kotlin/);
  assert.doesNotMatch(work, /연봉|계좌|fct_/, "no sensitive/private facts or fact IDs");

  for (const query of ["알레르기", "계좌", "연봉"]) {
    const r = text(await client.callTool({ name: "search_facts", arguments: { query } }));
    assert.doesNotMatch(r, /땅콩|국민은행|연봉 수준/, `leak for ${query}`);
  }

  const { items } = (await (await app("/connections")).json()) as { items: Array<{ id: string; revoked_at: string | null }> };
  const conn = items.find((c) => !c.revoked_at)!;

  // Narrow scope in the app → next call sees only 취미.
  const patched = await app(`/connections/${conn.id}`, { method: "PATCH", body: JSON.stringify({ persona_ids: [PERSONA_HOBBY], max_sensitivity: "normal" }) });
  assert.equal(patched.status, 200);
  const list2 = text(await client.callTool({ name: "list_personas", arguments: {} }));
  assert.doesNotMatch(list2, /업무/);

  const logs = (await (await app(`/access-logs?connection_id=${conn.id}`)).json()) as { items: unknown[] };
  assert.ok(logs.items.length >= 6, "every tool call is logged");

  // Disconnect → token rejected on the very next request.
  assert.equal((await app(`/connections/${conn.id}`, { method: "DELETE" })).status, 204);
  const r = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { authorization: `Bearer ${access_token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  assert.equal(r.status, 401);
  await client.close().catch(() => {});
});

test("private facts never returned even with sensitive scope", async () => {
  const { access_token } = await connect([PERSONA_WORK, PERSONA_HEALTH], "sensitive");
  const client = await mcp(access_token);
  const work = text(await client.callTool({ name: "get_persona", arguments: { persona_id: PERSONA_WORK, detail: "full" } }));
  assert.match(work, /연봉/);
  assert.doesNotMatch(work, /국민은행/);
  const health = text(await client.callTool({ name: "search_facts", arguments: { query: "알레르기" } }));
  assert.match(health, /땅콩/);
  await client.close();
});
