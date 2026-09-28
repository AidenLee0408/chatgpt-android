import express from "express";
import { TEST_USER_ID, type Connection, type Sensitivity } from "../core/index.js";
import type { MountAppApi } from "../contracts.js";

/**
 * Minimal stand-in for the mobile app API (/v1 in the MVP). Only what the PoC
 * needs to verify "범위 변경·연결 해제가 다음 호출부터 반영": list, change scope, revoke, logs.
 */
export const mountAppApi: MountAppApi = (app, { core, oauth, auth }) => {
  const r = express.Router();
  r.use(express.json(), auth);

  r.get("/connections", (_req, res) => {
    res.json({ items: core.listConnections(TEST_USER_ID), next_cursor: null });
  });

  r.patch("/connections/:id", (req, res) => {
    const { persona_ids, max_sensitivity } = req.body ?? {};
    const valid: Sensitivity[] = ["normal", "sensitive"];
    if (!Array.isArray(persona_ids) || !valid.includes(max_sensitivity)) {
      return void res.status(400).json(err("validation_failed", "persona_ids와 max_sensitivity(normal|sensitive)가 필요해요."));
    }
    const c = core.updateScope(req.params.id, TEST_USER_ID, {
      persona_ids: persona_ids.map(String),
      max_sensitivity: max_sensitivity as Connection["max_sensitivity"],
    });
    if (!c) return void res.status(404).json(err("not_found", "연결을 찾을 수 없어요."));
    res.json(c);
  });

  r.delete("/connections/:id", (req, res) => {
    if (!core.revokeConnection(req.params.id, TEST_USER_ID)) {
      return void res.status(404).json(err("not_found", "연결을 찾을 수 없어요."));
    }
    oauth.revokeConnectionTokens(req.params.id);
    res.status(204).end();
  });

  r.get("/access-logs", (req, res) => {
    const connectionId = typeof req.query.connection_id === "string" ? req.query.connection_id : undefined;
    res.json({ items: core.listAccessLogs(TEST_USER_ID, connectionId), next_cursor: null });
  });

  app.use("/app", r);
};

function err(code: string, message: string) {
  return { error: { code, message } };
}
