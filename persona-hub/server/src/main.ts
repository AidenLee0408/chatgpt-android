import express, { type RequestHandler } from "express";
import { randomBytes } from "node:crypto";
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
}

export function createServer(config: ServerConfig, appToken: string, opts: ServerOptions = {}) {
  const store = new Store();
  seed(store);
  const core = new CoreService(store);
  const appService = new AppService(store, core, opts.factExtractor ?? new RuleBasedFactExtractor());
  const auth = new AuthService(store, appService, opts.jwtSecret ?? randomBytes(32).toString("hex"), {
    ...opts.socialVerifiers,
    ...(opts.allowDevLogin ? { dev: new DevSocialVerifier() } : {}),
  });
  const oauth = createOAuth({ core, config });

  const app = express();
  app.set("trust proxy", true);
  app.get("/healthz", (_req, res) => void res.json({ ok: true }));

  // PoC stand-in for the app's user JWT: one static bearer token for the seeded user.
  const appAuth: RequestHandler = (req, res, next) => {
    if (req.headers.authorization === `Bearer ${appToken}`) return next();
    res.status(401).json({ error: { code: "token_expired", message: "다시 로그인해 주세요." } });
  };

  oauth.mount(app);
  mountMcp(app, { core, config, oauth });
  mountAppApi(app, { core, config, oauth, auth: appAuth });
  mountV1(app, {
    core, appService, auth, oauth, config,
    rateLimitPerMinute: opts.rateLimitPerMinute,
    corsOrigins: opts.corsOrigins,
    allowDevCors: opts.allowDevCors,
  });
  return { app, core, store, oauth, appService, auth };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 3000);
  const config: ServerConfig = {
    baseUrl: (process.env.BASE_URL ?? `http://localhost:${port}`).replace(/\/$/, ""),
    testUserPassword: process.env.TEST_USER_PASSWORD ?? "persona-poc",
  };
  const allowDevLogin = process.env.ALLOW_DEV_LOGIN === "1";
  if (!process.env.JWT_SECRET) console.warn("JWT_SECRET not set — using a random secret; app sessions reset on restart.");
  const { app } = createServer(config, process.env.APP_TOKEN ?? "dev-app-token", {
    jwtSecret: process.env.JWT_SECRET,
    allowDevLogin,
    rateLimitPerMinute: process.env.RATE_LIMIT_PER_MIN ? Number(process.env.RATE_LIMIT_PER_MIN) : undefined,
    corsOrigins: (process.env.CORS_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    allowDevCors: process.env.ALLOW_DEV_CORS ? process.env.ALLOW_DEV_CORS === "1" : !config.baseUrl.startsWith("https://") || allowDevLogin,
  });
  if (allowDevLogin) console.log("ALLOW_DEV_LOGIN=1: POST /v1/auth/login {provider:\"dev\", id_token:\"test-user\"} → seeded user");
  app.listen(port, () => console.log(`persona-hub PoC on :${port} (base ${config.baseUrl})`));
}
