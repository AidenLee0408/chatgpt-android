import type {
  AccessLog, AuthSession, Connection, ExportJob, Fact, Identity, Interview, Persona, RefreshToken, User,
} from "./types.js";

/**
 * In-memory store. The MVP replaces this with PostgreSQL: each map is one table
 * (Map key = primary key). Only core/ services and main.ts may touch it; route
 * handlers go through CoreService / AppService, so swapping the backing store
 * means re-implementing those service methods against a repo, not the routes.
 */
export class Store {
  users = new Map<string, User>();
  identities = new Map<string, Identity>();
  personas = new Map<string, Persona>();
  facts = new Map<string, Fact>();
  connections = new Map<string, Connection>();
  accessLogs: AccessLog[] = [];
  interviews = new Map<string, Interview>();
  exports = new Map<string, ExportJob>();
  authSessions = new Map<string, AuthSession>();
  /** key: sha256(refresh token) */
  refreshTokens = new Map<string, RefreshToken>();
}
