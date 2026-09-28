import express, { type RequestHandler } from "express";
import { CoreService, Store, seed } from "./core/index.js";
import type { ServerConfig } from "./contracts.js";
import { createOAuth } from "./oauth/index.js";
import { mountMcp } from "./mcp/index.js";
import { mountAppApi } from "./app/index.js";

export function createServer(config: ServerConfig, appToken: string) {
  const store = new Store();
  seed(store);
  const core = new CoreService(store);
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
  return { app, core, store, oauth };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 3000);
  const config: ServerConfig = {
    baseUrl: (process.env.BASE_URL ?? `http://localhost:${port}`).replace(/\/$/, ""),
    testUserPassword: process.env.TEST_USER_PASSWORD ?? "persona-poc",
  };
  const { app } = createServer(config, process.env.APP_TOKEN ?? "dev-app-token");
  app.listen(port, () => console.log(`persona-hub PoC on :${port} (base ${config.baseUrl})`));
}
