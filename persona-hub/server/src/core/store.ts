import type { AccessLog, Connection, Fact, Persona, User } from "./types.js";

/**
 * In-memory store for the PoC. The MVP replaces this with PostgreSQL behind the
 * same interface; nothing outside core/ may touch these maps directly.
 */
export class Store {
  users = new Map<string, User>();
  personas = new Map<string, Persona>();
  facts = new Map<string, Fact>();
  connections = new Map<string, Connection>();
  accessLogs: AccessLog[] = [];
}
