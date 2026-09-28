import { newId } from "./ids.js";
import type { Store } from "./store.js";
import type { CoreService } from "./service.js";
import { detectPrivatePattern, redactPrivatePatterns, REDACTION_MARKER } from "./privacy.js";
import { getTemplate } from "./templates.js";
import type { FactExtractor } from "./extractor.js";
import {
  HARD_PERSONA_LIMIT, PLAN_PERSONA_LIMIT, SENSITIVITY_RANK,
  type AccessLog, type Category, type Connection, type Consents, type ExportJob, type Fact, type FactCandidate,
  type FactSource, type Interview, type Provider, type Persona, type Sensitivity, type User,
} from "./types.js";

/**
 * Domain error with an API error code. HTTP mapping lives in the API layer
 * (code → status table), messages are Korean and user-facing.
 */
export class DomainError extends Error {
  constructor(
    readonly code:
      | "validation_failed" | "fact_private_pattern" | "token_expired" | "step_up_required"
      | "plan_limit_reached" | "not_found" | "version_conflict" | "rate_limited" | "internal",
    message: string,
    readonly field?: string,
  ) {
    super(message);
  }
}

const NOT_FOUND = {
  persona: "페르소나를 찾을 수 없어요.",
  fact: "팩트를 찾을 수 없어요.",
  connection: "연결을 찾을 수 없어요.",
  interview: "인터뷰를 찾을 수 없어요.",
  template: "템플릿을 찾을 수 없어요.",
  export: "내보내기를 찾을 수 없어요.",
  user: "계정을 찾을 수 없어요.",
} as const;

/** M-6: exports (a full copy of the user's data) live at most 24 hours. */
export const EXPORT_TTL_MS = 24 * 3600_000;

const notFound = (what: keyof typeof NOT_FOUND) => new DomainError("not_found", NOT_FOUND[what]);

export function checkVersion(current: number | undefined, expected: number | undefined): void {
  if (expected !== undefined && (current ?? 1) !== expected) {
    throw new DomainError("version_conflict", "다른 기기에서 먼저 수정됐어요. 새로고침 후 다시 시도해 주세요.");
  }
}

function assertNoPrivatePattern(body: string, field = "body"): void {
  const hit = detectPrivatePattern(body);
  if (hit) throw new DomainError("fact_private_pattern", hit.message, field);
}

export interface PersonaInput {
  name: string;
  icon?: string;
  description?: string;
  instructions?: string;
}
export interface PersonaPatch extends Partial<PersonaInput> {
  archived?: boolean;
}
export interface FactInput {
  category: Category;
  body: string;
  sensitivity: Sensitivity;
}

/**
 * User-scoped operations for the app API (/v1). Every method takes the caller's
 * userId and treats other users' resources exactly like missing ones.
 * Reads for AI clients stay in CoreService (the single permission filter).
 */
export class AppService {
  constructor(
    private readonly store: Store,
    private readonly core: CoreService,
    private readonly extractor: FactExtractor,
  ) {}

  // ---------- users ----------

  /** Returns the live user or null when missing/deleted. */
  user(userId: string): User | null {
    const u = this.store.users.get(userId);
    return u && !u.deleted_at ? u : null;
  }

  findOrCreateUserByIdentity(provider: Provider, subject: string, displayName?: string): User {
    const key = `${provider}:${subject}`;
    const ident = this.store.identities.get(key);
    const existing = ident ? this.user(ident.user_id) : null;
    if (existing) return existing;
    const now = new Date().toISOString();
    const user: User = {
      id: newId("usr"),
      display_name: displayName ?? "새 사용자",
      plan: "free",
      created_at: now,
      deleted_at: null,
      consents: { terms: true, sensitive_data: false, marketing: false, updated_at: now },
    };
    this.store.users.set(user.id, user);
    this.store.identities.set(key, { key, provider, subject, user_id: user.id });
    return user;
  }

  personaLimit(user: User): number {
    return Math.min(PLAN_PERSONA_LIMIT[user.plan ?? "free"], HARD_PERSONA_LIMIT);
  }

  me(userId: string) {
    const u = this.requireUser(userId);
    const now = u.created_at ?? new Date(0).toISOString();
    return {
      id: u.id,
      display_name: u.display_name,
      plan: u.plan ?? "free",
      limits: { max_personas: this.personaLimit(u) },
      persona_count: this.ownPersonas(userId).length,
      consents: u.consents ?? { terms: true, sensitive_data: false, marketing: false, updated_at: now },
      providers: [...this.store.identities.values()].filter((i) => i.user_id === u.id).map((i) => i.provider),
      created_at: now,
    };
  }

  /** True only when the user gave the separate 민감정보 consent (PIPA §23). */
  hasSensitiveConsent(userId: string): boolean {
    return this.user(userId)?.consents?.sensitive_data === true;
  }

  /**
   * M-4: withdrawing sensitive_data consent downgrades every active connection to "normal"
   * so no sensitive fact is transferred afterwards. Returns the downgraded connection ids in `downgraded`.
   */
  updateConsents(userId: string, patch: Partial<Omit<Consents, "updated_at" | "terms">>) {
    const u = this.requireUser(userId);
    const prev = u.consents ?? { terms: true, sensitive_data: false, marketing: false, updated_at: "" };
    u.consents = { ...prev, ...patch, updated_at: new Date().toISOString() };
    if (patch.sensitive_data === false) {
      for (const c of this.core.listConnections(userId)) {
        if (!c.revoked_at && c.max_sensitivity === "sensitive") {
          this.core.updateScope(c.id, userId, { persona_ids: c.persona_ids, max_sensitivity: "normal" });
        }
      }
    }
    return this.me(userId);
  }

  /** F-09 탈퇴: revoke every connection now, mark deleted; purgeDeletedUsers() erases data later. Returns revoked connection ids. */
  deleteUser(userId: string): string[] {
    const u = this.requireUser(userId);
    const revoked: string[] = [];
    for (const c of this.core.listConnections(userId)) {
      this.core.revokeConnection(c.id, userId);
      revoked.push(c.id);
    }
    const now = new Date().toISOString();
    u.deleted_at = now;
    for (const s of this.store.authSessions.values()) if (s.user_id === userId) s.revoked_at ??= now;
    for (const [k, i] of this.store.identities) if (i.user_id === userId) this.store.identities.delete(k);
    return revoked;
  }

  /** Hard-deletes users marked deleted more than `graceMs` ago (default 30 days). Run from a scheduled job. */
  purgeDeletedUsers(now = Date.now(), graceMs = 30 * 86400_000): number {
    let n = 0;
    for (const u of [...this.store.users.values()]) {
      if (!u.deleted_at || now - Date.parse(u.deleted_at) < graceMs) continue;
      for (const p of this.ownPersonas(u.id, true)) this.removePersonaData(p.id);
      const cons = new Set(this.core.listConnections(u.id).map((c) => c.id));
      for (const id of cons) this.store.connections.delete(id);
      this.store.accessLogs = this.store.accessLogs.filter((l) => !cons.has(l.connection_id));
      for (const [k, v] of this.store.interviews) if (v.user_id === u.id) this.store.interviews.delete(k);
      for (const [k, v] of this.store.exports) if (v.user_id === u.id) this.store.exports.delete(k);
      this.store.users.delete(u.id);
      n++;
    }
    return n;
  }

  private requireUser(userId: string): User {
    const u = this.user(userId);
    if (!u) throw notFound("user");
    return u;
  }

  // ---------- personas ----------

  private ownPersonas(userId: string, includeArchived = true): Persona[] {
    return [...this.store.personas.values()].filter((p) => p.user_id === userId && (includeArchived || !p.archived));
  }

  ownPersona(userId: string, personaId: string): Persona {
    const p = this.store.personas.get(personaId);
    if (!p || p.user_id !== userId) throw notFound("persona");
    return p;
  }

  factCounts(personaId: string) {
    const counts = { total: 0, normal: 0, sensitive: 0, private: 0 };
    for (const f of this.store.facts.values()) {
      if (f.persona_id !== personaId) continue;
      counts.total++;
      counts[f.sensitivity]++;
    }
    return counts;
  }

  /** archived: false (default) → active only, true → archived only, "all" → both. */
  listPersonas(userId: string, archived: boolean | "all" = false): Persona[] {
    return this.ownPersonas(userId)
      .filter((p) => archived === "all" || p.archived === archived)
      .sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? "") || a.id.localeCompare(b.id));
  }

  createPersona(userId: string, input: PersonaInput): Persona {
    const u = this.requireUser(userId);
    const count = this.ownPersonas(userId).length;
    if (count >= this.personaLimit(u)) {
      throw new DomainError(
        "plan_limit_reached",
        count >= HARD_PERSONA_LIMIT
          ? `페르소나는 최대 ${HARD_PERSONA_LIMIT}개까지 만들 수 있어요.`
          : `무료 플랜은 페르소나를 ${this.personaLimit(u)}개까지 만들 수 있어요.`,
      );
    }
    for (const [field, v] of [["name", input.name], ["description", input.description], ["instructions", input.instructions]] as const) {
      if (v) assertNoPrivatePattern(v, field);
    }
    const now = new Date().toISOString();
    const p: Persona = {
      id: newId("per"),
      user_id: userId,
      name: input.name,
      icon: input.icon ?? "user",
      summary: input.description ?? "",
      instructions: input.instructions ?? "",
      archived: false,
      version: 1,
      created_at: now,
      updated_at: now,
    };
    this.store.personas.set(p.id, p);
    return p;
  }

  updatePersona(userId: string, personaId: string, patch: PersonaPatch, ifMatch?: number): Persona {
    const p = this.ownPersona(userId, personaId);
    checkVersion(p.version, ifMatch);
    for (const [field, v] of [["name", patch.name], ["description", patch.description], ["instructions", patch.instructions]] as const) {
      if (v) assertNoPrivatePattern(v, field);
    }
    if (patch.name !== undefined) p.name = patch.name;
    if (patch.icon !== undefined) p.icon = patch.icon;
    if (patch.description !== undefined) p.summary = patch.description;
    if (patch.instructions !== undefined) p.instructions = patch.instructions;
    if (patch.archived !== undefined) p.archived = patch.archived;
    p.version = (p.version ?? 1) + 1;
    p.updated_at = new Date().toISOString();
    return p;
  }

  /** Deletes the persona and its facts, and strips it from every connection's scope. */
  deletePersona(userId: string, personaId: string, ifMatch?: number): void {
    const p = this.ownPersona(userId, personaId);
    checkVersion(p.version, ifMatch);
    this.removePersonaData(personaId);
  }

  private removePersonaData(personaId: string): void {
    for (const [id, f] of this.store.facts) if (f.persona_id === personaId) this.store.facts.delete(id);
    for (const c of this.store.connections.values()) {
      if (c.persona_ids.includes(personaId)) {
        c.persona_ids = c.persona_ids.filter((id) => id !== personaId);
        c.version = (c.version ?? 1) + 1;
      }
    }
    for (const i of this.store.interviews.values()) if (i.persona_id === personaId) i.persona_id = null;
    this.store.personas.delete(personaId);
  }

  // ---------- facts ----------

  listFacts(userId: string, personaId: string, filter: { sensitivities: Sensitivity[]; category?: Category }): Fact[] {
    this.ownPersona(userId, personaId);
    return [...this.store.facts.values()]
      .filter((f) => f.persona_id === personaId && filter.sensitivities.includes(f.sensitivity) && (!filter.category || f.category === filter.category))
      .sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? "") || a.id.localeCompare(b.id));
  }

  ownFact(userId: string, factId: string): Fact {
    const f = this.store.facts.get(factId);
    if (!f || this.store.personas.get(f.persona_id)?.user_id !== userId) throw notFound("fact");
    return f;
  }

  createFact(userId: string, personaId: string, input: FactInput, source: FactSource = "manual"): Fact {
    this.ownPersona(userId, personaId);
    assertNoPrivatePattern(input.body);
    const now = new Date().toISOString();
    const f: Fact = {
      id: newId("fct"),
      persona_id: personaId,
      category: input.category,
      body: input.body,
      sensitivity: input.sensitivity,
      source,
      version: 1,
      created_at: now,
      updated_at: now,
    };
    this.store.facts.set(f.id, f);
    this.touchPersona(personaId, now);
    return f;
  }

  updateFact(userId: string, factId: string, patch: Partial<FactInput>, ifMatch?: number): Fact {
    const f = this.ownFact(userId, factId);
    checkVersion(f.version, ifMatch);
    if (patch.body !== undefined) assertNoPrivatePattern(patch.body);
    if (patch.body !== undefined) f.body = patch.body;
    if (patch.category !== undefined) f.category = patch.category;
    if (patch.sensitivity !== undefined) f.sensitivity = patch.sensitivity;
    f.version = (f.version ?? 1) + 1;
    f.updated_at = new Date().toISOString();
    this.touchPersona(f.persona_id, f.updated_at);
    return f;
  }

  deleteFact(userId: string, factId: string, ifMatch?: number): void {
    const f = this.ownFact(userId, factId);
    checkVersion(f.version, ifMatch);
    this.store.facts.delete(factId);
    this.touchPersona(f.persona_id, new Date().toISOString());
  }

  private touchPersona(personaId: string, at: string) {
    const p = this.store.personas.get(personaId);
    if (p) p.updated_at = at;
  }

  // ---------- interviews ----------

  startInterview(userId: string, templateId: string, personaId?: string): Interview {
    if (!getTemplate(templateId)) throw new DomainError("validation_failed", NOT_FOUND.template, "template_id");
    if (personaId) this.ownPersona(userId, personaId);
    const now = new Date().toISOString();
    const i: Interview = {
      id: newId("itv"), user_id: userId, template_id: templateId, persona_id: personaId ?? null,
      status: "in_progress", answers: [], candidates: [], created_at: now, updated_at: now,
    };
    this.store.interviews.set(i.id, i);
    return i;
  }

  ownInterview(userId: string, id: string): Interview {
    const i = this.store.interviews.get(id);
    if (!i || i.user_id !== userId) throw notFound("interview");
    return i;
  }

  /**
   * Stores raw answers. M-8: private-pattern content is never stored — matching segments are
   * replaced by REDACTION_MARKER before the answer is kept (and later exported).
   */
  submitAnswers(userId: string, id: string, answers: Array<{ question_id: string; text: string }>): { interview: Interview; redacted_count: number } {
    const i = this.ownInterview(userId, id);
    if (i.status === "committed") throw new DomainError("validation_failed", "이미 저장한 인터뷰예요.");
    const t = getTemplate(i.template_id)!;
    const now = new Date().toISOString();
    for (const a of answers) {
      if (!t.questions.some((q) => q.id === a.question_id)) {
        throw new DomainError("validation_failed", "이 템플릿에 없는 질문이에요.", "question_id");
      }
    }
    let redacted_count = 0;
    for (const a of answers) {
      i.answers = i.answers.filter((x) => x.question_id !== a.question_id);
      if (!a.text.trim()) continue;
      const r = redactPrivatePatterns(a.text.trim());
      redacted_count += r.redacted;
      i.answers.push({ question_id: a.question_id, text: r.text, answered_at: now, ...(r.redacted ? { redacted: true } : {}) });
    }
    i.status = "in_progress";
    i.updated_at = now;
    return { interview: i, redacted_count };
  }

  /** Runs the extractor. Candidates that match a private pattern are dropped (never stored) and reported in `blocked`. */
  async extract(userId: string, id: string): Promise<{ interview: Interview; blocked: Array<{ question_id: string | null; reason: string }> }> {
    const i = this.ownInterview(userId, id);
    if (i.status === "committed") throw new DomainError("validation_failed", "이미 저장한 인터뷰예요.");
    if (i.answers.length === 0) throw new DomainError("validation_failed", "먼저 질문에 답해 주세요.", "answers");
    const t = getTemplate(i.template_id)!;
    const extracted = await this.extractor.extract(
      i.answers.map((a) => ({ question: t.questions.find((q) => q.id === a.question_id) ?? null, answer: a.text })),
    );
    const blocked: Array<{ question_id: string | null; reason: string }> = [];
    i.candidates = [];
    for (const e of extracted) {
      if (e.body.includes(REDACTION_MARKER)) {
        blocked.push({ question_id: e.question_id, reason: "비공개 정보처럼 보여서 저장하지 않았어요." });
        continue;
      }
      const hit = detectPrivatePattern(e.body);
      if (hit) {
        blocked.push({ question_id: e.question_id, reason: hit.message });
        continue;
      }
      i.candidates.push({ id: newId("cnd"), question_id: e.question_id, category: e.category, body: e.body.slice(0, 500), sensitivity: e.sensitivity });
    }
    i.status = "extracted";
    i.updated_at = new Date().toISOString();
    return { interview: i, blocked };
  }

  /**
   * Saves user-reviewed candidates as facts (source=interview). Creates a persona from
   * the template defaults when the interview has none and none is given.
   */
  commit(
    userId: string,
    id: string,
    input: { persona_id?: string; persona?: PersonaInput; facts: FactInput[] },
  ): { persona: Persona; facts: Fact[] } {
    const i = this.ownInterview(userId, id);
    if (i.status === "committed") throw new DomainError("validation_failed", "이미 저장한 인터뷰예요.");
    input.facts.forEach((f, n) => assertNoPrivatePattern(f.body, `facts.${n}.body`));
    const personaId = input.persona_id ?? i.persona_id;
    const t = getTemplate(i.template_id)!;
    const persona = personaId
      ? this.ownPersona(userId, personaId)
      : this.createPersona(userId, input.persona ?? { ...t.persona_defaults });
    const facts = input.facts.map((f) => this.createFact(userId, persona.id, f, "interview"));
    i.persona_id = persona.id;
    i.status = "committed";
    i.updated_at = new Date().toISOString();
    return { persona, facts };
  }

  // ---------- connections ----------

  ownConnection(userId: string, id: string): Connection {
    const c = this.store.connections.get(id);
    if (!c || c.user_id !== userId) throw notFound("connection");
    return c;
  }

  listConnections(userId: string): Connection[] {
    return this.core.listConnections(userId).sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  /** True when the new scope grants anything the current one doesn't (needs step-up). */
  isScopeWidening(c: Connection, scope: { persona_ids?: string[]; max_sensitivity?: Connection["max_sensitivity"] }): boolean {
    if (scope.persona_ids && scope.persona_ids.some((id) => !c.persona_ids.includes(id))) return true;
    return !!scope.max_sensitivity && SENSITIVITY_RANK[scope.max_sensitivity] > SENSITIVITY_RANK[c.max_sensitivity];
  }

  /**
   * H-1: scope widening is enforced here (not only in the route) so no caller can skip it —
   * `opts.stepUpVerified` must be true when the new scope grants anything new.
   * M-4: "sensitive" needs the user's separate sensitive-data consent.
   */
  updateConnection(
    userId: string, id: string,
    scope: { persona_ids?: string[]; max_sensitivity?: Connection["max_sensitivity"] },
    ifMatch: number | undefined,
    opts: { stepUpVerified: boolean },
  ): Connection {
    const c = this.ownConnection(userId, id);
    if (c.revoked_at) throw notFound("connection");
    if (this.isScopeWidening(c, scope) && !opts.stepUpVerified) {
      throw new DomainError("step_up_required", "민감한 작업이라 본인 확인이 필요해요.");
    }
    if (scope.max_sensitivity === "sensitive" && !this.hasSensitiveConsent(userId)) {
      throw new DomainError("validation_failed", "민감정보 공유에 동의해야 민감 정보를 연결할 수 있어요.", "max_sensitivity");
    }
    checkVersion(c.version, ifMatch);
    for (const pid of scope.persona_ids ?? []) {
      const p = this.store.personas.get(pid);
      if (!p || p.user_id !== userId) throw new DomainError("validation_failed", NOT_FOUND.persona, "persona_ids");
    }
    return this.core.updateScope(id, userId, {
      persona_ids: scope.persona_ids ?? c.persona_ids,
      max_sensitivity: scope.max_sensitivity ?? c.max_sensitivity,
    })!;
  }

  revokeConnection(userId: string, id: string, ifMatch?: number): void {
    const c = this.ownConnection(userId, id);
    checkVersion(c.version, ifMatch);
    this.core.revokeConnection(id, userId);
  }

  // ---------- access logs ----------

  listAccessLogs(userId: string, f: { connection_id?: string; from?: string; to?: string }): AccessLog[] {
    const from = f.from ? Date.parse(f.from) : -Infinity;
    const to = f.to ? Date.parse(f.to) : Infinity;
    return this.core
      .listAccessLogs(userId, f.connection_id)
      .filter((l) => {
        const t = Date.parse(l.created_at);
        return t >= from && t <= to;
      });
  }

  /** M-5: owner-scoped existence check (no cross-user oracle). */
  ownFactExists(userId: string, id: string): boolean {
    const f = this.store.facts.get(id);
    return !!f && this.store.personas.get(f.persona_id)?.user_id === userId;
  }

  // ---------- context packs (F-08) ----------

  contextPackSource(userId: string, personaIds: string[], includeSensitive: boolean) {
    const allowed = new Set<Sensitivity>(includeSensitive ? ["normal", "sensitive"] : ["normal"]);
    return [...new Set(personaIds)].map((id) => {
      const p = this.ownPersona(userId, id);
      const facts = [...this.store.facts.values()].filter((f) => f.persona_id === id && allowed.has(f.sensitivity) && f.sensitivity !== "private");
      return { persona: p, facts };
    });
  }

  // ---------- exports (F-09) ----------

  createExport(userId: string): ExportJob {
    const u = this.requireUser(userId);
    const personas = this.ownPersonas(userId);
    const personaIds = new Set(personas.map((p) => p.id));
    const connections = this.core.listConnections(userId);
    const conIds = new Set(connections.map((c) => c.id));
    const data = {
      format: "persona-hub-export",
      format_version: 1,
      exported_at: new Date().toISOString(),
      user: { id: u.id, display_name: u.display_name, plan: u.plan ?? "free", consents: u.consents ?? null, created_at: u.created_at ?? null },
      personas: personas.map(({ user_id: _u, summary, ...p }) => ({ ...p, description: summary })),
      facts: [...this.store.facts.values()].filter((f) => personaIds.has(f.persona_id)),
      connections: connections.map(({ user_id: _u, ...c }) => c),
      access_logs: this.store.accessLogs.filter((l) => conIds.has(l.connection_id)),
      interviews: [...this.store.interviews.values()].filter((i) => i.user_id === userId).map(({ user_id: _u, ...i }) => i),
    };
    const created = Date.now();
    const job: ExportJob = {
      id: newId("exp"), user_id: userId, status: "ready", data,
      created_at: new Date(created).toISOString(), expires_at: new Date(created + EXPORT_TTL_MS).toISOString(),
    };
    this.store.exports.set(job.id, job);
    return job;
  }

  /** Owner-scoped; expired exports look exactly like missing ones (M-5, M-6). */
  ownExport(userId: string, id: string, now = Date.now()): ExportJob {
    const e = this.store.exports.get(id);
    if (!e || e.user_id !== userId || Date.parse(e.expires_at) <= now) throw notFound("export");
    return e;
  }

  /** M-6: deletes exports past expires_at (their data snapshot included). Run periodically. */
  purgeExpiredExports(now = Date.now()): number {
    let n = 0;
    for (const [k, e] of this.store.exports) {
      if (Date.parse(e.expires_at) <= now) {
        this.store.exports.delete(k);
        n++;
      }
    }
    return n;
  }
}

export type { FactCandidate };
