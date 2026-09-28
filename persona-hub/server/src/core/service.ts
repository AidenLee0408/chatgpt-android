import { newId } from "./ids.js";
import type { Store } from "./store.js";
import { SENSITIVITY_RANK, type AccessLog, type Connection, type Fact, type Persona } from "./types.js";

/**
 * The ONLY read path for persona data. Every entry point (app API, MCP) goes
 * through here so the "scope × sensitivity" filter lives in exactly one place.
 *
 * Rules (tech spec §기술 아키텍처 2, MCP 서버 동작 규칙):
 *  - connection must be active (not revoked) — checked on every call, never cached in the token
 *  - persona must be in connection.persona_ids and not archived
 *  - fact.sensitivity <= connection.max_sensitivity; "private" is never returned
 *  - out-of-scope and non-existent IDs are indistinguishable (both → null)
 */
export class CoreService {
  constructor(private readonly store: Store) {}

  /** Resolves a live connection or null if missing/revoked. */
  activeConnection(connectionId: string): Connection | null {
    const c = this.store.connections.get(connectionId);
    return c && c.revoked_at === null ? c : null;
  }

  listVisiblePersonas(conn: Connection): Array<Persona & { fact_count: number }> {
    return [...new Set(conn.persona_ids)]
      .map((id) => this.visiblePersona(conn, id))
      .filter((p): p is Persona => p !== null)
      .map((p) => ({ ...p, fact_count: this.visibleFacts(conn, p.id).length }));
  }

  /** Returns null for missing AND out-of-scope personas alike. */
  visiblePersona(conn: Connection, personaId: string): Persona | null {
    if (conn.revoked_at !== null || !conn.persona_ids.includes(personaId)) return null;
    const p = this.store.personas.get(personaId);
    if (!p || p.archived || p.user_id !== conn.user_id) return null;
    return p;
  }

  visibleFacts(conn: Connection, personaId: string): Fact[] {
    if (!this.visiblePersona(conn, personaId)) return [];
    const max = SENSITIVITY_RANK[conn.max_sensitivity];
    return [...this.store.facts.values()].filter(
      (f) =>
        f.persona_id === personaId &&
        f.sensitivity !== "private" &&
        SENSITIVITY_RANK[f.sensitivity] <= max,
    );
  }

  /**
   * PoC search: token/bigram overlap scoring over visible facts only.
   * MVP swaps this for pgvector embeddings; the filter stays identical.
   */
  searchFacts(conn: Connection, query: string, personaId: string | undefined, limit: number): Fact[] {
    const personaIds = personaId ? [personaId] : [...new Set(conn.persona_ids)];
    const candidates = personaIds.flatMap((id) => this.visibleFacts(conn, id));
    const q = grams(query);
    return candidates
      .map((f) => ({ f, score: overlap(q, grams(f.body + " " + f.category)) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((x) => x.f);
  }

  recordAccess(entry: Omit<AccessLog, "id" | "created_at">): AccessLog {
    const log: AccessLog = { ...entry, id: newId("log"), created_at: new Date().toISOString() };
    this.store.accessLogs.push(log);
    const c = this.store.connections.get(entry.connection_id);
    if (c) c.last_accessed_at = log.created_at;
    return log;
  }

  // --- connection management (used by OAuth consent + app/admin endpoints) ---

  createConnection(input: Pick<Connection, "user_id" | "client_id" | "client_name" | "persona_ids" | "max_sensitivity">): Connection {
    const conn: Connection = {
      ...input,
      persona_ids: this.ownedIds(input.user_id, input.persona_ids),
      max_sensitivity: clampSensitivity(input.max_sensitivity),
      id: newId("con"),
      created_at: new Date().toISOString(),
      revoked_at: null,
      last_accessed_at: null,
      version: 1,
    };
    this.store.connections.set(conn.id, conn);
    return conn;
  }

  updateScope(connectionId: string, userId: string, scope: Pick<Connection, "persona_ids" | "max_sensitivity">): Connection | null {
    const c = this.store.connections.get(connectionId);
    if (!c || c.user_id !== userId || c.revoked_at) return null;
    c.persona_ids = this.ownedIds(userId, scope.persona_ids);
    c.max_sensitivity = clampSensitivity(scope.max_sensitivity);
    c.version = (c.version ?? 1) + 1;
    return c;
  }

  revokeConnection(connectionId: string, userId: string): boolean {
    const c = this.store.connections.get(connectionId);
    if (!c || c.user_id !== userId) return false;
    if (c.revoked_at === null) {
      c.revoked_at = new Date().toISOString();
      c.version = (c.version ?? 1) + 1;
    }
    return true;
  }

  listConnections(userId: string): Connection[] {
    return [...this.store.connections.values()].filter((c) => c.user_id === userId);
  }

  listAccessLogs(userId: string, connectionId?: string): AccessLog[] {
    const mine = new Set(this.listConnections(userId).map((c) => c.id));
    return this.store.accessLogs
      .filter((l) => mine.has(l.connection_id) && (!connectionId || l.connection_id === connectionId))
      .slice()
      .reverse();
  }

  private ownedIds(userId: string, ids: string[]): string[] {
    return [...new Set(ids)].filter((id) => this.store.personas.get(id)?.user_id === userId);
  }

  listUserPersonas(userId: string): Persona[] {
    return [...this.store.personas.values()].filter((p) => p.user_id === userId && !p.archived);
  }
}

/** Anything other than "sensitive" (including a smuggled "private") collapses to the safe default. */
function clampSensitivity(s: string): Connection["max_sensitivity"] {
  return s === "sensitive" ? "sensitive" : "normal";
}

function grams(s: string): Set<string> {
  const out = new Set<string>();
  for (const w of s.toLowerCase().split(/[\s,.·:()\/]+/).filter(Boolean)) {
    out.add(w);
    for (let i = 0; i < w.length - 1; i++) out.add(w.slice(i, i + 2));
  }
  return out;
}

function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const g of a) if (b.has(g)) n++;
  return n;
}
