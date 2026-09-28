import type { Express, Request, Response, NextFunction } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { MountMcp } from "../contracts.js";
import type { Category, CoreService, Fact, Persona } from "../core/index.js";

export const INSTRUCTIONS =
  'Persona Hub stores the user\'s self-described context, split into personas (e.g. "Work", "Health"). Use it whenever an answer would be better if you knew who the user is: their job, preferences, constraints, or background.\n' +
  "- Call list_personas first when you are unsure which persona applies.\n" +
  '- Prefer get_persona with detail="short" unless the task needs specifics.\n' +
  "- Treat returned facts as the user's own statements, current as of updated_at.\n" +
  "- Only personas the user granted to this connection are visible; do not ask the user for information that a persona already contains.\n" +
  "- Never reveal raw fact IDs to the user.";

const NOT_FOUND = "Persona not found or not shared with this assistant. Call list_personas to see available personas.";
const NO_RESULTS = "공유된 정보에서 찾지 못했어요.";
const MORE_HINT = "\n\n(search_facts로 더 찾을 수 있어요)";
const SHORT_TOKENS = 800;
const TOTAL_TOKENS = 4000;
const RATE_LIMIT = 60;

const CATEGORY_KO: Record<Category, string> = {
  profile: "신상", work: "직업", interest: "관심사", health: "건강",
  finance: "재무", preference: "선호", other: "기타",
};
const CATEGORY_ORDER: Category[] = ["profile", "work", "interest", "health", "finance", "preference", "other"];

/** Rough token estimate: Korean text ≈ chars/2. */
const tokens = (s: string) => Math.ceil(s.length / 2);

const ANNOTATIONS = { readOnlyHint: true, idempotentHint: true, openWorldHint: false } as const;

// --- rate limit (in-memory, fixed 60s window per connection) ---
const hits = new Map<string, number[]>();
function rateLimited(connectionId: string): boolean {
  const now = Date.now();
  const arr = (hits.get(connectionId) ?? []).filter((t) => now - t < 60_000);
  if (arr.length >= RATE_LIMIT) { hits.set(connectionId, arr); return true; }
  arr.push(now);
  hits.set(connectionId, arr);
  return false;
}
/** Test hook. */
export function resetRateLimits(): void { hits.clear(); }
/** L-5: drops keys whose window has fully expired. Runs every minute (unref'd timer). */
export function sweepRateLimits(now = Date.now()): number {
  let n = 0;
  for (const [k, arr] of hits) {
    if (!arr.some((t) => now - t < 60_000)) { hits.delete(k); n++; }
  }
  return n;
}
export function rateLimitKeyCount(): number { return hits.size; }
setInterval(() => sweepRateLimits(), 60_000).unref();

const errorResult = (text: string): CallToolResult => ({ isError: true, content: [{ type: "text", text }] });
const day = (iso: string) => iso.slice(0, 10);

function renderPersona(p: Persona, facts: Fact[], budgetTokens: number): { text: string; shown: Fact[]; truncated: boolean } {
  const header = `# 페르소나: ${p.name}\n답변 지시: ${p.instructions || "(없음)"}\n`;
  const footer = `\n(업데이트: ${day(p.updated_at)})`;
  let used = tokens(header) + tokens(footer);
  const shown: Fact[] = [];
  let body = "";
  let truncated = false;
  outer: for (const cat of CATEGORY_ORDER) {
    const inCat = facts.filter((f) => f.category === cat);
    if (!inCat.length) continue;
    let section = `## ${CATEGORY_KO[cat]}\n`;
    let added = 0;
    for (const f of inCat) {
      const line = `- ${f.body}\n`;
      const cost = tokens(line) + (added === 0 ? tokens(section) : 0);
      if (used + cost > budgetTokens) { truncated = true; if (added) body += section; break outer; }
      used += cost;
      section += line;
      shown.push(f);
      added++;
    }
    body += section;
  }
  return { text: header + body + footer + (truncated ? MORE_HINT : ""), shown, truncated };
}

export function createPersonaMcpServer(core: CoreService, connectionId: string): McpServer {
  const server = new McpServer({ name: "persona-hub", version: "0.1.0" }, { instructions: INSTRUCTIONS });

  /** Wraps a tool: resolves the live connection per call, rate-limits, records access + logs. */
  function run<A>(tool: string, fn: (conn: NonNullable<ReturnType<CoreService["activeConnection"]>>, args: A) => { result: CallToolResult; persona_ids: string[]; fact_ids: string[] }) {
    return async (args: A): Promise<CallToolResult> => {
      const started = Date.now();
      const conn = core.activeConnection(connectionId);
      if (!conn) return errorResult("This connection has been revoked. Ask the user to reconnect Persona Hub.");
      if (rateLimited(connectionId)) return errorResult("Rate limit exceeded (60 calls/min). Try again shortly.");
      let out: { result: CallToolResult; persona_ids: string[]; fact_ids: string[] };
      try {
        out = fn(conn, args);
      } catch {
        out = { result: errorResult("Internal error while reading personas."), persona_ids: [], fact_ids: [] };
      }
      const latency_ms = Date.now() - started;
      core.recordAccess({ connection_id: conn.id, client_name: conn.client_name, tool, persona_ids: out.persona_ids, fact_ids: out.fact_ids, latency_ms });
      console.log(JSON.stringify({ client_name: conn.client_name, tool, latency_ms, persona_ids: out.persona_ids }));
      return out.result;
    };
  }

  server.registerTool(
    "list_personas",
    {
      title: "List my personas",
      description:
        "List the personas the user has shared with this assistant. Each persona is one context of the user's life (work, health, hobbies...). Call this first when the user's request depends on who they are and you don't yet know which persona fits.",
      inputSchema: {},
      annotations: ANNOTATIONS,
    },
    run<unknown>("list_personas", (conn) => {
      const ps = core.listVisiblePersonas(conn);
      const lines = ps.map((p, i) => `${i + 1}. ${p.name} (${p.id}) — ${p.summary}, 팩트 ${p.fact_count}개`);
      const text = ps.length
        ? `이 연결에서 볼 수 있는 페르소나 ${ps.length}개:\n${lines.join("\n")}`
        : "이 연결에서 볼 수 있는 페르소나가 없어요.";
      return {
        result: {
          content: [{ type: "text", text }],
          structuredContent: {
            personas: ps.map((p) => ({ id: p.id, name: p.name, summary: p.summary, fact_count: p.fact_count, updated_at: p.updated_at })),
          },
        },
        persona_ids: ps.map((p) => p.id),
        fact_ids: [],
      };
    }),
  );

  server.registerTool(
    "get_persona",
    {
      title: "Get a persona",
      description:
        "Get one persona's instructions and facts. Use detail='short' (default, under ~800 tokens) for most tasks; use 'full' only when the task needs every fact. Apply the persona's instructions (tone, format) to your answer.",
      inputSchema: {
        persona_id: z.string().describe("Persona ID from list_personas"),
        detail: z.enum(["short", "full"]).default("short"),
      },
      annotations: ANNOTATIONS,
    },
    run<{ persona_id: string; detail?: "short" | "full" }>("get_persona", (conn, { persona_id, detail = "short" }) => {
      const p = core.visiblePersona(conn, persona_id);
      if (!p) return { result: errorResult(NOT_FOUND), persona_ids: [], fact_ids: [] };
      const facts = core.visibleFacts(conn, p.id);
      const r = renderPersona(p, facts, detail === "short" ? SHORT_TOKENS : TOTAL_TOKENS);
      const byCat: Record<string, string[]> = {};
      for (const f of r.shown) (byCat[f.category] ??= []).push(f.body);
      return {
        result: {
          content: [{ type: "text", text: r.text }],
          structuredContent: {
            persona: { id: p.id, name: p.name, summary: p.summary, instructions: p.instructions, updated_at: p.updated_at },
            detail,
            facts: r.shown.map((f) => ({ category: f.category, body: f.body, updated_at: f.updated_at })),
            truncated: r.truncated,
          },
        },
        persona_ids: [p.id],
        fact_ids: r.shown.map((f) => f.id),
      };
    }),
  );

  server.registerTool(
    "search_facts",
    {
      title: "Search my facts",
      description:
        "Semantic search over the user's facts across all personas shared with this assistant. Use when you need one specific detail (e.g. 'allergies', 'preferred stack') rather than a whole persona.",
      inputSchema: {
        query: z.string().min(1).max(200),
        persona_id: z.string().optional(),
        limit: z.number().int().min(1).max(20).default(5),
      },
      annotations: ANNOTATIONS,
    },
    run<{ query: string; persona_id?: string; limit?: number }>("search_facts", (conn, { query, persona_id, limit = 5 }) => {
      if (persona_id && !core.visiblePersona(conn, persona_id)) return { result: errorResult(NOT_FOUND), persona_ids: [], fact_ids: [] };
      const found = core.searchFacts(conn, query, persona_id, limit);
      if (!found.length) {
        return { result: { content: [{ type: "text", text: NO_RESULTS }], structuredContent: { results: [], truncated: false } }, persona_ids: persona_id ? [persona_id] : [], fact_ids: [] };
      }
      const names = new Map(core.listVisiblePersonas(conn).map((p) => [p.id, p.name]));
      let text = `"${query}" 검색 결과 ${found.length}개:\n`;
      const shown: Fact[] = [];
      let truncated = false;
      for (const f of found) {
        const line = `- [${names.get(f.persona_id) ?? ""} · ${CATEGORY_KO[f.category]}] ${f.body} (업데이트: ${day(f.updated_at)})\n`;
        if (tokens(text + line) > TOTAL_TOKENS) { truncated = true; break; }
        text += line;
        shown.push(f);
      }
      if (truncated) text += MORE_HINT;
      return {
        result: {
          content: [{ type: "text", text: text.trimEnd() }],
          structuredContent: {
            results: shown.map((f) => ({ persona_id: f.persona_id, persona_name: names.get(f.persona_id) ?? "", category: f.category, body: f.body, updated_at: f.updated_at })),
            truncated,
          },
        },
        persona_ids: [...new Set(shown.map((f) => f.persona_id))],
        fact_ids: shown.map((f) => f.id),
      };
    }),
  );

  return server;
}

export const mountMcp: MountMcp = (app, { core, config, oauth }) => {
  const base = config.baseUrl.replace(/\/+$/, "");
  const resource = `${base}/mcp`;
  const resourceMetadataUrl = `${base}/.well-known/oauth-protected-resource/mcp`;
  const metadata = {
    resource,
    authorization_servers: [base],
    bearer_methods_supported: ["header"],
    resource_name: "Persona Hub",
  };
  const sendMeta = (_req: Request, res: Response) => { res.set("Access-Control-Allow-Origin", "*").json(metadata); };
  app.get("/.well-known/oauth-protected-resource", sendMeta);
  app.get("/.well-known/oauth-protected-resource/mcp", sendMeta);

  const auth = (req: Request, res: Response, next: NextFunction) => {
    const h = req.headers.authorization ?? "";
    const m = /^Bearer\s+(.+)$/i.exec(h);
    const info = m ? oauth.verifyAccessToken(m[1].trim()) : null;
    // M-3: a token bound to another resource (audience) is not valid here.
    const audienceOk = !!info && (info.resource === undefined || info.resource === resource);
    const conn = info && audienceOk && info.expiresAt * 1000 > Date.now() ? core.activeConnection(info.connectionId) : null;
    if (!info || !audienceOk || !conn) {
      const err = m ? ', error="invalid_token"' : "";
      res.status(401)
        .set("WWW-Authenticate", `Bearer resource_metadata="${resourceMetadataUrl}"${err}`)
        .json({ error: m ? "invalid_token" : "unauthorized", error_description: "Missing or invalid access token" });
      return;
    }
    res.locals.connectionId = info.connectionId;
    next();
  };

  const handle = async (req: Request, res: Response) => {
    const server = createPersonaMcpServer(core, res.locals.connectionId as string);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => { void transport.close(); void server.close(); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e) {
      console.error(JSON.stringify({ tool: "mcp_transport", error: String(e) }));
      if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
    }
  };

  app.post("/mcp", auth, handle);
  app.get("/mcp", auth, handle);
  app.delete("/mcp", auth, handle);
};
