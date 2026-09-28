import express, { type Express, type Request } from "express";
import { z } from "zod";
import {
  CATEGORIES, DomainError, SENSITIVITIES, TEMPLATES, getTemplate, renderContextPack,
  type AccessLog, type AppService, type Connection, type CoreService, type Fact, type Interview, type Persona, type Sensitivity,
} from "../core/index.js";
import type { OAuthModule, ServerConfig } from "../contracts.js";
import type { AuthService } from "./auth.js";
import {
  corsFor, errorHandler, idempotency, ifMatch, paginate, parse, rateLimit, requestId, sendError, wrap,
} from "./http.js";
import { CONNECT_GUIDES } from "./guides.js";

export interface V1Deps {
  core: CoreService;
  appService: AppService;
  auth: AuthService;
  oauth: OAuthModule;
  config: ServerConfig;
  rateLimitPerMinute?: number;
  corsOrigins?: string[];
  allowDevCors?: boolean;
}

// ---------- serializers (wire format, snake_case) ----------

export function personaOut(p: Persona, counts?: { total: number; normal: number; sensitive: number; private: number }) {
  return {
    id: p.id, name: p.name, icon: p.icon, description: p.summary, instructions: p.instructions, archived: p.archived,
    version: p.version ?? 1,
    ...(counts ? { fact_count: counts.total, fact_counts: counts } : {}),
    created_at: p.created_at ?? p.updated_at, updated_at: p.updated_at,
  };
}

export function factOut(f: Fact) {
  return {
    id: f.id, persona_id: f.persona_id, category: f.category, body: f.body, sensitivity: f.sensitivity, source: f.source,
    version: f.version ?? 1, created_at: f.created_at ?? f.updated_at, updated_at: f.updated_at,
  };
}

function connectionOut(c: Connection, names: Map<string, string>) {
  return {
    id: c.id, client_id: c.client_id, client_name: c.client_name,
    status: c.revoked_at ? "revoked" : "active",
    persona_ids: c.persona_ids,
    personas: c.persona_ids.filter((id) => names.has(id)).map((id) => ({ id, name: names.get(id)! })),
    max_sensitivity: c.max_sensitivity, version: c.version ?? 1,
    created_at: c.created_at, last_accessed_at: c.last_accessed_at, revoked_at: c.revoked_at,
  };
}

function interviewOut(i: Interview) {
  const t = getTemplate(i.template_id)!;
  return {
    id: i.id, template_id: i.template_id, persona_id: i.persona_id, status: i.status,
    questions: t.questions.map((q) => ({ ...q, answered: i.answers.some((a) => a.question_id === q.id) })),
    answers: i.answers, candidates: i.candidates, created_at: i.created_at, updated_at: i.updated_at,
  };
}

// ---------- schemas ----------

const sensitivity = z.enum(SENSITIVITIES as [Sensitivity, ...Sensitivity[]], { error: "민감도는 normal, sensitive, private 중 하나예요." });
const category = z.enum(CATEGORIES as [Fact["category"], ...Fact["category"][]], { error: "카테고리 값이 올바르지 않아요." });
const factBody = z.string({ error: "내용을 입력해 주세요." }).trim().min(1, "내용을 입력해 주세요.").max(500, "팩트는 500자까지 쓸 수 있어요.");
const personaName = z.string({ error: "이름을 입력해 주세요." }).trim().min(1, "이름을 입력해 주세요.").max(30, "이름은 30자까지 쓸 수 있어요.");
const personaFields = {
  icon: z.string().trim().min(1).max(40).optional(),
  description: z.string().trim().max(100, "설명은 100자까지 쓸 수 있어요.").optional(),
  instructions: z.string().trim().max(1000, "지시문은 1000자까지 쓸 수 있어요.").optional(),
};
const PersonaCreate = z.object({ name: personaName, ...personaFields });
const PersonaPatch = z.object({ name: personaName.optional(), ...personaFields, archived: z.boolean().optional() });
const FactCreate = z.object({ category, body: factBody, sensitivity: sensitivity.default("normal") });
const FactPatch = z.object({ category: category.optional(), body: factBody.optional(), sensitivity: sensitivity.optional() });
const scopeSensitivity = z.enum(["normal", "sensitive"], { error: "max_sensitivity는 normal 또는 sensitive예요." });
const ConnectionPatch = z.object({ persona_ids: z.array(z.string()).max(10).optional(), max_sensitivity: scopeSensitivity.optional() })
  .refine((v) => v.persona_ids !== undefined || v.max_sensitivity !== undefined, { error: "변경할 범위를 보내 주세요." });

const STEP_UP_MSG = "민감한 작업이라 본인 확인이 필요해요.";

export function mountV1(app: Express, deps: V1Deps): void {
  const { appService: svc, auth, oauth, config } = deps;
  const r = express.Router();
  const PUBLIC = new Set(["POST /auth/login", "POST /auth/refresh", "POST /auth/logout"]);

  /** H-1: session-bound step-up. `consume` = single-use (high-risk: DELETE /me, exports). */
  const hasStepUp = (req: Request, consume = false) =>
    auth.hasStepUp(req.header("x-step-up-token"), req.userId!, req.sessionId!, { consume });
  const stepUp = (req: Request, consume = false) => {
    if (!hasStepUp(req, consume)) throw new DomainError("step_up_required", STEP_UP_MSG);
  };
  const uid = (req: Request) => req.userId!;
  const personaNames = (userId: string) => new Map(svc.listPersonas(userId, "all").map((p) => [p.id, p.name]));

  r.use(requestId, corsFor(deps.corsOrigins ?? [], deps.allowDevCors ?? true), express.json({ limit: "256kb" }));
  // Optional auth everywhere, required except for PUBLIC and signed download links.
  r.use((req, res, next) => {
    const h = req.header("authorization");
    const isPublic = PUBLIC.has(`${req.method} ${req.path}`) || (req.method === "GET" && /^\/exports\/[^/]+\/download$/.test(req.path));
    if (h?.startsWith("Bearer ")) {
      try {
        const a = auth.authenticate(h.slice(7).trim());
        req.userId = a.userId;
        req.sessionId = a.sessionId;
      } catch (e) {
        if (!isPublic) return next(e);
      }
    }
    if (!req.userId && !isPublic) return sendError(res, req, "token_expired", "로그인이 필요해요.");
    next();
  });
  r.use(rateLimit(deps.rateLimitPerMinute ?? 120, (req) => req.userId ?? `ip:${req.ip}`));
  r.use(idempotency());

  // ---------- auth ----------
  r.post("/auth/login", wrap(async (req, res) => {
    const b = parse(z.object({ provider: z.enum(["kakao", "apple", "google", "dev"], { error: "지원하지 않는 로그인 방식이에요." }), id_token: z.string().min(1, "id_token이 필요해요.") }), req.body);
    const t = await auth.login(b.provider, b.id_token);
    res.json({ ...t, user: svc.me(t.user_id) });
  }));

  r.post("/auth/refresh", wrap((req, res) => {
    const b = parse(z.object({ refresh_token: z.string().min(1, "refresh_token이 필요해요.") }), req.body);
    res.json(auth.refresh(b.refresh_token));
  }));

  r.post("/auth/logout", wrap((req, res) => {
    const b = parse(z.object({ refresh_token: z.string().optional() }), req.body);
    if (!b.refresh_token && !req.sessionId) throw new DomainError("validation_failed", "refresh_token이 필요해요.", "refresh_token");
    auth.logout(b.refresh_token, req.sessionId ?? "");
    res.status(204).end();
  }));

  r.post("/auth/step-up", wrap((req, res) => {
    parse(z.object({ method: z.literal("biometric", { error: "지원하는 인증 방식은 biometric이에요." }) }), req.body);
    const s = auth.stepUp(uid(req), req.sessionId!);
    res.setHeader("X-Step-Up-Token", s.step_up_token);
    res.json(s);
  }));

  // ---------- me ----------
  r.get("/me", wrap((req, res) => void res.json(svc.me(uid(req)))));

  r.patch("/me/consents", wrap((req, res) => {
    const b = parse(z.object({ sensitive_data: z.boolean().optional(), marketing: z.boolean().optional() })
      .refine((v) => v.sensitive_data !== undefined || v.marketing !== undefined, { error: "변경할 동의 항목을 보내 주세요." }), req.body);
    res.json(svc.updateConsents(uid(req), b));
  }));

  r.delete("/me", wrap((req, res) => {
    stepUp(req, true);
    for (const id of svc.deleteUser(uid(req))) oauth.revokeConnectionTokens(id);
    res.status(204).end();
  }));

  // ---------- personas ----------
  r.get("/personas", wrap((req, res) => {
    const a = req.query.archived;
    const archived = a === undefined || a === "false" ? false : a === "true" ? true : a === "all" ? "all" : null;
    if (archived === null) throw new DomainError("validation_failed", "archived는 true, false, all 중 하나예요.", "archived");
    const page = paginate(svc.listPersonas(uid(req), archived), req.query);
    res.json({ ...page, items: page.items.map((p) => personaOut(p, svc.factCounts(p.id))) });
  }));

  r.post("/personas", wrap((req, res) => {
    const p = svc.createPersona(uid(req), parse(PersonaCreate, req.body));
    res.status(201).location(`/v1/personas/${p.id}`).json(personaOut(p, svc.factCounts(p.id)));
  }));

  r.get("/personas/:id", wrap((req, res) => {
    const p = svc.ownPersona(uid(req), String(req.params.id));
    res.json(personaOut(p, svc.factCounts(p.id)));
  }));

  r.patch("/personas/:id", wrap((req, res) => {
    const p = svc.updatePersona(uid(req), String(req.params.id), parse(PersonaPatch, req.body), ifMatch(req));
    res.json(personaOut(p, svc.factCounts(p.id)));
  }));

  r.delete("/personas/:id", wrap((req, res) => {
    svc.deletePersona(uid(req), String(req.params.id), ifMatch(req));
    res.status(204).end();
  }));

  // ---------- facts ----------
  r.get("/personas/:id/facts", wrap((req, res) => {
    const q = parse(z.object({ sensitivity: sensitivity.optional(), category: category.optional() }), {
      sensitivity: req.query.sensitivity, category: req.query.category,
    });
    const userId = uid(req);
    const stepped = hasStepUp(req);
    let sensitivities: Sensitivity[];
    if (q.sensitivity) {
      if (q.sensitivity !== "normal" && !stepped) throw new DomainError("step_up_required", STEP_UP_MSG);
      sensitivities = [q.sensitivity];
    } else {
      sensitivities = stepped ? ["normal", "sensitive", "private"] : ["normal"];
    }
    const all = svc.listFacts(userId, String(req.params.id), { sensitivities: [...SENSITIVITIES], category: q.category });
    const visible = all.filter((f) => sensitivities.includes(f.sensitivity));
    const page = paginate(visible, req.query);
    res.json({
      ...page,
      items: page.items.map(factOut),
      // Facts hidden because no X-Step-Up-Token was sent (lets the app show a "잠금 해제" row).
      locked_count: stepped || q.sensitivity ? 0 : all.length - visible.length,
    });
  }));

  r.post("/personas/:id/facts", wrap((req, res) => {
    const b = parse(FactCreate, req.body);
    if (b.sensitivity !== "normal") stepUp(req);
    const f = svc.createFact(uid(req), String(req.params.id), b);
    res.status(201).location(`/v1/facts/${f.id}`).json(factOut(f));
  }));

  r.patch("/facts/:id", wrap((req, res) => {
    const b = parse(FactPatch, req.body);
    const cur = svc.ownFact(uid(req), String(req.params.id));
    if (cur.sensitivity !== "normal" || (b.sensitivity && b.sensitivity !== "normal")) stepUp(req);
    res.json(factOut(svc.updateFact(uid(req), cur.id, b, ifMatch(req))));
  }));

  r.delete("/facts/:id", wrap((req, res) => {
    svc.deleteFact(uid(req), String(req.params.id), ifMatch(req));
    res.status(204).end();
  }));

  // ---------- templates & interviews ----------
  r.get("/templates", (req, res) => void res.json(paginate(TEMPLATES, req.query)));

  r.post("/interviews", wrap((req, res) => {
    const b = parse(z.object({ template_id: z.string({ error: "template_id가 필요해요." }), persona_id: z.string().optional() }), req.body);
    const i = svc.startInterview(uid(req), b.template_id, b.persona_id);
    res.status(201).location(`/v1/interviews/${i.id}`).json(interviewOut(i));
  }));

  r.post("/interviews/:id/answers", wrap((req, res) => {
    const answer = z.object({ question_id: z.string(), text: z.string().max(2000, "답변은 2000자까지 쓸 수 있어요.") });
    const b = parse(z.union([z.object({ answers: z.array(answer).min(1).max(20) }), answer]), req.body);
    const list = "answers" in b ? b.answers : [b];
    const r = svc.submitAnswers(uid(req), String(req.params.id), list);
    res.json({ ...interviewOut(r.interview), redacted_count: r.redacted_count });
  }));

  r.post("/interviews/:id/extract", wrap(async (req, res) => {
    const { interview, blocked } = await svc.extract(uid(req), String(req.params.id));
    res.json({ ...interviewOut(interview), blocked });
  }));

  r.post("/interviews/:id/commit", wrap((req, res) => {
    const b = parse(z.object({
      persona_id: z.string().optional(),
      persona: PersonaCreate.optional(),
      facts: z.array(z.object({ category, body: factBody, sensitivity })).min(1, "저장할 팩트를 하나 이상 골라 주세요.").max(100),
    }), req.body);
    if (b.facts.some((f) => f.sensitivity !== "normal")) stepUp(req);
    const out = svc.commit(uid(req), String(req.params.id), b);
    res.status(201).json({ persona: personaOut(out.persona, svc.factCounts(out.persona.id)), facts: out.facts.map(factOut) });
  }));

  // ---------- context packs ----------
  r.post("/context-packs", wrap((req, res) => {
    const b = parse(z.object({
      persona_ids: z.array(z.string()).min(1, "페르소나를 하나 이상 골라 주세요.").max(10),
      language: z.enum(["ko", "en"]).default("ko"),
      length: z.enum(["short", "normal", "detailed"]).default("normal"),
      include_sensitive: z.boolean().default(false),
    }), req.body);
    if (b.include_sensitive) stepUp(req);
    const src = svc.contextPackSource(uid(req), b.persona_ids, b.include_sensitive);
    const pack = renderContextPack(src, b.language, b.length);
    res.json({
      text: pack.text, char_count: pack.char_count, language: b.language, length: b.length,
      include_sensitive: b.include_sensitive, persona_ids: src.map((s) => s.persona.id),
      fact_count: pack.fact_ids.length, omitted_fact_count: pack.omitted_fact_count,
    });
  }));

  // ---------- connections ----------
  r.get("/connections", wrap((req, res) => {
    const names = personaNames(uid(req));
    const page = paginate(svc.listConnections(uid(req)), req.query);
    res.json({ ...page, items: page.items.map((c) => connectionOut(c, names)) });
  }));

  r.get("/connections/:id", wrap((req, res) => {
    res.json(connectionOut(svc.ownConnection(uid(req), String(req.params.id)), personaNames(uid(req))));
  }));

  r.patch("/connections/:id", wrap((req, res) => {
    const b = parse(ConnectionPatch, req.body);
    const c = svc.ownConnection(uid(req), String(req.params.id));
    // Widening is enforced inside updateConnection (H-1); we only tell it whether step-up was shown.
    const stepUpVerified = svc.isScopeWidening(c, b) && hasStepUp(req);
    res.json(connectionOut(svc.updateConnection(uid(req), c.id, b, ifMatch(req), { stepUpVerified }), personaNames(uid(req))));
  }));

  r.delete("/connections/:id", wrap((req, res) => {
    const id = String(req.params.id);
    svc.revokeConnection(uid(req), id, ifMatch(req));
    oauth.revokeConnectionTokens(id);
    res.status(204).end();
  }));

  r.get("/connect-guides", (req, res) => {
    const mcpUrl = `${config.baseUrl}/mcp`;
    res.json(paginate(CONNECT_GUIDES.map((g) => ({ ...g, mcp_url: mcpUrl, steps: g.steps.map((s, n) => ({ n: n + 1, text: s.replaceAll("{MCP_URL}", mcpUrl) })) })), req.query));
  });

  // ---------- access logs ----------
  r.get("/access-logs", wrap((req, res) => {
    const iso = z.string().refine((s) => !Number.isNaN(Date.parse(s)), { error: "날짜는 ISO 8601 형식이어야 해요." }).optional();
    const q = parse(z.object({ connection_id: z.string().optional(), from: iso, to: iso }), {
      connection_id: req.query.connection_id, from: req.query.from, to: req.query.to,
    });
    const page = paginate(svc.listAccessLogs(uid(req), q), req.query);
    res.json({ ...page, items: page.items.map((l) => logOut(uid(req), l)) });
  }));

  function logOut(userId: string, l: AccessLog) {
    const fact_ids = l.fact_ids.filter((id) => svc.ownFactExists(userId, id)); // deleted facts never surface again
    return {
      id: l.id, connection: { id: l.connection_id, client_name: l.client_name }, tool: l.tool,
      persona_ids: l.persona_ids, fact_count: l.fact_ids.length, fact_ids, created_at: l.created_at,
    };
  }

  // ---------- exports ----------
  r.post("/exports", wrap((req, res) => {
    stepUp(req, true);
    const e = svc.createExport(uid(req));
    res.status(201).location(`/v1/exports/${e.id}`).json({ id: e.id, status: e.status, created_at: e.created_at, expires_at: e.expires_at });
  }));

  r.get("/exports/:id", wrap((req, res) => {
    const e = svc.ownExport(uid(req), String(req.params.id));
    const dl = auth.signDownload(e.id, uid(req), req.sessionId!);
    res.json({
      id: e.id, status: e.status, created_at: e.created_at, expires_at: e.expires_at,
      download_url: `${config.baseUrl}/v1/exports/${e.id}/download?token=${dl.token}`, download_expires_at: dl.expires_at,
    });
  }));

  r.get("/exports/:id/download", wrap((req, res) => {
    const id = String(req.params.id);
    const owner = typeof req.query.token === "string" ? auth.verifyDownload(req.query.token, id) : null;
    const expired = () => new DomainError("not_found", "다운로드 링크가 만료됐어요. 다시 요청해 주세요.");
    if (!owner) throw expired();
    let e;
    try {
      e = svc.ownExport(owner, id);
    } catch {
      throw expired();
    }
    res.setHeader("Content-Disposition", `attachment; filename="persona-hub-export-${e.id}.json"`);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.json(e.data);
  }));

  r.use((req, res) => sendError(res, req, "not_found", "요청한 경로를 찾을 수 없어요."));
  r.use(errorHandler);
  app.use("/v1", r);
}
