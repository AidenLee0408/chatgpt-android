import express, { type ErrorRequestHandler, type RequestHandler } from "express";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { loadEnvConfig } from "./config.js";
import { AppService, CoreService, RuleBasedFactExtractor, Store, seed, type FactExtractor } from "./core/index.js";
import { AuthService, DevSocialVerifier, type SocialVerifier } from "./api/auth.js";
import { mountV1 } from "./api/v1.js";
import type { ServerConfig } from "./contracts.js";
import { createOAuth } from "./oauth/index.js";
import { mountMcp } from "./mcp/index.js";
import { mountAppApi } from "./app/index.js";

export interface ServerOptions {
  /** HS256 secret for app JWTs. Defaults to a random per-process secret (tokens die on restart). */
  jwtSecret?: string;
  /** Enables provider "dev" on POST /v1/auth/login (env ALLOW_DEV_LOGIN=1). */
  allowDevLogin?: boolean;
  /** Real kakao/apple/google verifiers plug in here. */
  socialVerifiers?: Partial<Record<"kakao" | "apple" | "google", SocialVerifier>>;
  factExtractor?: FactExtractor;
  rateLimitPerMinute?: number;
  /** Extra allowed CORS origins for /v1 (localhost origins are always allowed when allowDevCors). */
  corsOrigins?: string[];
  allowDevCors?: boolean;
  /** M-9: Express "trust proxy" hop count; default false (never trust X-Forwarded-For). */
  trustProxy?: number | false;
  /** PoC /app router (static app token). Off in production (H-2). Default true. */
  enablePocAppApi?: boolean;
  /** Interval for periodic cleanup (expired exports, rate-limit maps). 0 disables. Default 10 min. */
  cleanupIntervalMs?: number;
}

/** Timing-safe string compare (hash first so lengths never leak). */
export function safeEqual(a: string, b: string): boolean {
  const x = createHash("sha256").update(a).digest();
  const y = createHash("sha256").update(b).digest();
  return timingSafeEqual(x, y) && a.length === b.length;
}

export function createServer(config: ServerConfig, appToken: string, opts: ServerOptions = {}) {
  const store = new Store();
  seed(store);
  const core = new CoreService(store);
  const appService = new AppService(store, core, opts.factExtractor ?? new RuleBasedFactExtractor());
  const auth = new AuthService(store, appService, opts.jwtSecret ?? randomBytes(32).toString("hex"), {
    ...opts.socialVerifiers,
    ...(opts.allowDevLogin ? { dev: new DevSocialVerifier() } : {}),
  }, config.baseUrl.replace(/\/+$/, ""));
  const oauth = createOAuth({ core, config });

  const app = express();
  app.set("trust proxy", opts.trustProxy ?? false);
  app.get("/healthz", (_req, res) => void res.json({ ok: true }));

  // PoC stand-in for the app's user JWT: one static bearer token for the seeded user.
  const appAuth: RequestHandler = (req, res, next) => {
    const h = req.headers.authorization ?? "";
    if (h.startsWith("Bearer ") && safeEqual(h.slice(7), appToken)) return next();
    res.status(401).json({ error: { code: "token_expired", message: "다시 로그인해 주세요." } });
  };

  oauth.mount(app);
  mountMcp(app, { core, config, oauth });
  if (opts.enablePocAppApi ?? true) mountAppApi(app, { core, config, oauth, auth: appAuth });
  mountV1(app, {
    core, appService, auth, oauth, config,
    rateLimitPerMinute: opts.rateLimitPerMinute,
    corsOrigins: opts.corsOrigins,
    allowDevCors: opts.allowDevCors,
  });
  // L-1: last-resort handler — generic body, no stack traces in responses.
  const finalError: ErrorRequestHandler = (err, _req, res, _next) => {
    if (res.headersSent) return;
    const status = typeof err?.status === "number" && err.status >= 400 && err.status < 500 ? err.status : 500;
    if (status === 500) console.error(JSON.stringify({ error: err?.name ?? "Error", stack: err?.stack?.split("\n").slice(1, 6).join(" | ") }));
    res.status(status).type("text/plain").send(status === 500 ? "Internal Server Error" : "Bad Request");
  };
  app.use(finalError);

  // M-6 / L-5: periodic purge of expired exports; OAuth/MCP maps sweep themselves too.
  const every = opts.cleanupIntervalMs ?? 10 * 60_000;
  if (every > 0) setInterval(() => { appService.purgeExpiredExports(); }, every).unref();

  return { app, core, store, oauth, appService, auth };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let env;
  try {
    env = loadEnvConfig(process.env);
  } catch (e) {
    console.error(String((e as Error).message));
    process.exit(1);
  }
  const { config, port } = env;
  if (!env.jwtSecret) console.warn("JWT_SECRET not set — using a random secret; app sessions reset on restart.");
  const { app } = createServer(config, env.appToken, {
    jwtSecret: env.jwtSecret,
    allowDevLogin: env.allowDevLogin,
    trustProxy: env.trustProxy,
    enablePocAppApi: !env.production,
    rateLimitPerMinute: process.env.RATE_LIMIT_PER_MIN ? Number(process.env.RATE_LIMIT_PER_MIN) : undefined,
    corsOrigins: (process.env.CORS_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    allowDevCors: process.env.ALLOW_DEV_CORS ? process.env.ALLOW_DEV_CORS === "1" : !config.baseUrl.startsWith("https://") || env.allowDevLogin,
  });
  if (env.allowDevLogin) console.log("ALLOW_DEV_LOGIN=1: POST /v1/auth/login {provider:\"dev\", id_token:\"test-user\"} → seeded user");
  app.listen(port, () => console.log(`persona-hub PoC on :${port} (base ${config.baseUrl})`));
}
