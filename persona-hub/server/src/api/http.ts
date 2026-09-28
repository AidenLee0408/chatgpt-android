import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from "express";
import { z } from "zod";
import { DomainError, newId } from "../core/index.js";

export const STATUS: Record<DomainError["code"], number> = {
  validation_failed: 400,
  fact_private_pattern: 400,
  token_expired: 401,
  step_up_required: 401,
  plan_limit_reached: 403,
  not_found: 404,
  version_conflict: 409,
  rate_limited: 429,
  internal: 500,
};

declare module "express-serve-static-core" {
  interface Request {
    requestId?: string;
    userId?: string;
    sessionId?: string;
  }
}

export function sendError(res: Response, req: Request, code: DomainError["code"], message: string, field?: string) {
  res.status(STATUS[code]).json({
    error: { code, message, ...(field ? { field } : {}), request_id: req.requestId ?? "req_unknown" },
  });
}

export const requestId: RequestHandler = (req, res, next) => {
  req.requestId = newId("req");
  res.setHeader("X-Request-Id", req.requestId);
  next();
};

/** CORS for the app API: dev origins (Expo web :8081/:19006, any localhost port) + CORS_ORIGINS. */
export function corsFor(extraOrigins: string[], allowDevOrigins: boolean): RequestHandler {
  const allowed = new Set(extraOrigins);
  const dev = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
  return (req, res, next) => {
    const origin = req.headers.origin;
    if (origin && (allowed.has(origin) || (allowDevOrigins && dev.test(origin)))) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, Idempotency-Key, If-Match, X-Step-Up-Token");
      res.setHeader("Access-Control-Expose-Headers", "X-Request-Id, Retry-After, X-Step-Up-Token, Location");
      res.setHeader("Access-Control-Max-Age", "600");
    }
    if (req.method === "OPTIONS") return void res.status(204).end();
    next();
  };
}

/** Fixed-window limiter keyed by user id (or IP before auth). In-memory; Redis in production. */
export function rateLimit(perMinute: number, keyOf: (req: Request) => string): RequestHandler {
  const windows = new Map<string, { start: number; count: number }>();
  return (req, res, next) => {
    const now = Date.now();
    const key = keyOf(req);
    let w = windows.get(key);
    if (!w || now - w.start >= 60_000) {
      w = { start: now, count: 0 };
      windows.set(key, w);
      if (windows.size > 50_000) for (const [k, v] of windows) if (now - v.start >= 60_000) windows.delete(k);
    }
    if (++w.count > perMinute) {
      res.setHeader("Retry-After", String(Math.max(1, Math.ceil((w.start + 60_000 - now) / 1000))));
      return sendError(res, req, "rate_limited", "요청이 너무 많아요. 잠시 후 다시 시도해 주세요.");
    }
    next();
  };
}

interface CachedResponse {
  status: number;
  body: unknown;
  headers: Record<string, string>;
  fingerprint: string;
  expires: number;
}

/**
 * Idempotency-Key replay for POST/PATCH/DELETE (24h, per user + key). The first
 * completed response (except 401/429/5xx, which are safe to retry) is stored and
 * replayed verbatim with `Idempotent-Replayed: true`. Reusing a key for a different
 * method/path/body is a validation error.
 */
export function idempotency(ttlMs = 24 * 3600_000): RequestHandler {
  const cache = new Map<string, CachedResponse>();
  const inflight = new Set<string>();
  return (req, res, next) => {
    const key = req.header("idempotency-key");
    if (!key || !["POST", "PATCH", "DELETE"].includes(req.method)) return next();
    if (key.length > 200) return sendError(res, req, "validation_failed", "Idempotency-Key가 너무 길어요.", "Idempotency-Key");
    const now = Date.now();
    const ck = `${req.userId ?? `ip:${req.ip}`}:${key}`;
    const fingerprint = `${req.method} ${req.originalUrl} ${JSON.stringify(req.body ?? null)}`;
    const hit = cache.get(ck);
    if (hit && hit.expires > now) {
      if (hit.fingerprint !== fingerprint) {
        return sendError(res, req, "validation_failed", "같은 Idempotency-Key로 다른 요청을 보냈어요.", "Idempotency-Key");
      }
      for (const [h, v] of Object.entries(hit.headers)) res.setHeader(h, v);
      res.setHeader("Idempotent-Replayed", "true");
      res.status(hit.status);
      return void (hit.body === undefined ? res.end() : res.json(hit.body));
    }
    if (inflight.has(ck)) return sendError(res, req, "rate_limited", "같은 요청을 처리하고 있어요. 잠시 후 다시 시도해 주세요.");
    inflight.add(ck);
    let body: unknown;
    const json = res.json.bind(res);
    res.json = (b: unknown) => {
      body = b;
      return json(b);
    };
    res.on("close", () => inflight.delete(ck));
    res.on("finish", () => {
      inflight.delete(ck);
      const s = res.statusCode;
      if (s >= 500 || s === 401 || s === 429) return;
      const headers: Record<string, string> = {};
      for (const h of ["location", "x-step-up-token"]) {
        const v = res.getHeader(h);
        if (v !== undefined) headers[h] = String(v);
      }
      cache.set(ck, { status: s, body, headers, fingerprint, expires: now + ttlMs });
      if (cache.size > 100_000) for (const [k, v] of cache) if (v.expires <= Date.now()) cache.delete(k);
    });
    next();
  };
}

export const MAX_LIMIT = 100;
export const DEFAULT_LIMIT = 20;

/** Offset cursor (opaque base64url). A DB repo will switch to keyset cursors behind the same shape. */
export function paginate<T>(items: T[], query: Request["query"]): { items: T[]; next_cursor: string | null } {
  const limitRaw = query.limit === undefined ? DEFAULT_LIMIT : Number(query.limit);
  if (!Number.isInteger(limitRaw) || limitRaw < 1 || limitRaw > MAX_LIMIT) {
    throw new DomainError("validation_failed", `limit은 1~${MAX_LIMIT} 사이여야 해요.`, "limit");
  }
  let offset = 0;
  if (typeof query.cursor === "string" && query.cursor) {
    try {
      offset = JSON.parse(Buffer.from(query.cursor, "base64url").toString("utf8")).o;
    } catch {
      offset = NaN;
    }
    if (!Number.isInteger(offset) || offset < 0) throw new DomainError("validation_failed", "cursor가 올바르지 않아요.", "cursor");
  }
  const page = items.slice(offset, offset + limitRaw);
  const next = offset + limitRaw < items.length ? Buffer.from(JSON.stringify({ o: offset + limitRaw })).toString("base64url") : null;
  return { items: page, next_cursor: next };
}

/** Parses If-Match: 3 / "3" / W/"3". Undefined when absent. */
export function ifMatch(req: Request): number | undefined {
  const raw = req.header("if-match");
  if (raw === undefined) return undefined;
  const n = Number(raw.replace(/^W\//, "").replace(/"/g, "").trim());
  if (!Number.isInteger(n) || n < 1) throw new DomainError("validation_failed", "If-Match 헤더는 version 숫자여야 해요.", "If-Match");
  return n;
}

export function parse<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const r = schema.safeParse(value ?? {});
  if (r.success) return r.data;
  const issue = r.error.issues[0];
  const field = issue.path.map(String).join(".") || undefined;
  const custom = issue.message && /[가-힣]/.test(issue.message) ? issue.message : undefined;
  throw new DomainError("validation_failed", custom ?? (field ? `${field} 값을 확인해 주세요.` : "입력값을 확인해 주세요."), field);
}

export const wrap = (fn: (req: Request, res: Response, next: NextFunction) => unknown): RequestHandler =>
  (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (res.headersSent) return;
  if (err instanceof DomainError) return sendError(res, req, err.code, err.message, err.field);
  if (err?.type === "entity.parse.failed") return sendError(res, req, "validation_failed", "JSON 형식이 올바르지 않아요.");
  if (err?.type === "entity.too.large") return sendError(res, req, "validation_failed", "요청 본문이 너무 커요.");
  console.error(`[${req.requestId}]`, err);
  sendError(res, req, "internal", "일시적인 문제가 생겼어요. 잠시 후 다시 시도해 주세요.");
};
