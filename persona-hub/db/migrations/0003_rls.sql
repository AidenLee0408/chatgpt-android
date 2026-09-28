-- 0003_rls.sql — Row-level security as defense-in-depth.
--
-- The core service remains the single permission filter (connection scope, sensitivity).
-- RLS only guarantees "a request bound to user X can never touch user Y's rows".
--
-- Roles:
--   persona_app      : app API path. Every transaction must run
--                        SET LOCAL app.user_id = '<usr_...>';
--                      Without it current_setting(..., true) is NULL -> zero rows visible.
--   persona_service  : MCP / OAuth / background jobs. BYPASSRLS. The MCP path resolves
--                      user_id from the connection row first, then the core service filters
--                      by connection.persona_ids + max_sensitivity. It may also SET app.user_id
--                      after resolving the connection and use persona_app instead (preferred
--                      once the repo layer supports it). Only this role gets KMS decrypt rights.
--   Migrations run as the table owner (not subject to RLS unless FORCE is set).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'persona_app') THEN
    CREATE ROLE persona_app NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'persona_service') THEN
    CREATE ROLE persona_service NOLOGIN BYPASSRLS;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION app_user_id() RETURNS text
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.user_id', true), '') $$;

DO $$
DECLARE t text;
BEGIN
  -- tables with a user_id column
  FOREACH t IN ARRAY ARRAY['identities','personas','facts','connections','access_logs','interviews',
                           'exports','auth_sessions','refresh_tokens','oauth_codes','oauth_tokens',
                           'idempotency_keys','suggestions']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL TO persona_app USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id())',
                   t || '_owner', t);
  END LOOP;
END $$;

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY users_self ON users FOR ALL TO persona_app
  USING (id = app_user_id()) WITH CHECK (id = app_user_id());

-- oauth_clients is global (DCR metadata, no user data): readable by app for the connections screen.
GRANT SELECT ON oauth_clients TO persona_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  users, identities, personas, facts, connections, access_logs, interviews, exports,
  auth_sessions, refresh_tokens, oauth_codes, oauth_tokens, idempotency_keys, suggestions
  TO persona_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO persona_service;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO persona_service;
-- New monthly partitions are reached through the parent, so no per-partition grants needed.

-- NOTE: login (identities lookup before a user_id is known) and refresh-token rotation run
-- on persona_service, since no app.user_id exists yet at that point.
