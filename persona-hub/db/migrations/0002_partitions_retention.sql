-- 0002_partitions_retention.sql — access_logs monthly partitions, 1-year retention, 30-day query purge.
-- Run daily from a scheduler (ECS scheduled task / pg_cron):
--   SELECT access_logs_maintain();          -- create ahead + drop > 12 months
--   SELECT access_logs_purge_query_text();  -- NULL query_text older than 30 days

CREATE OR REPLACE FUNCTION access_logs_ensure_partition(p_month date) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v_from date := date_trunc('month', p_month)::date;
  v_to   date := (date_trunc('month', p_month) + interval '1 month')::date;
  v_name text := format('access_logs_%s', to_char(v_from, 'YYYY_MM'));
BEGIN
  IF to_regclass(v_name) IS NULL THEN
    -- Note: fails if the DEFAULT partition already holds rows for this range;
    -- access_logs_maintain() creates months ahead so DEFAULT should stay empty.
    EXECUTE format('CREATE TABLE %I PARTITION OF access_logs FOR VALUES FROM (%L) TO (%L)',
                   v_name, v_from, v_to);
  END IF;
  RETURN v_name;
END $$;

-- Creates current + p_ahead future months; drops monthly partitions whose whole
-- range is older than p_retain_months (default 12 = spec "1년 보관").
CREATE OR REPLACE FUNCTION access_logs_maintain(p_ahead int DEFAULT 3, p_retain_months int DEFAULT 12)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  i int;
  r record;
  v_cutoff date := (date_trunc('month', now()) - make_interval(months => p_retain_months))::date;
BEGIN
  FOR i IN 0..p_ahead LOOP
    PERFORM access_logs_ensure_partition((date_trunc('month', now()) + make_interval(months => i))::date);
  END LOOP;

  FOR r IN
    SELECT c.relname
    FROM pg_inherits inh
    JOIN pg_class c ON c.oid = inh.inhrelid
    JOIN pg_class p ON p.oid = inh.inhparent
    WHERE p.relname = 'access_logs' AND c.relname ~ '^access_logs_\d{4}_\d{2}$'
  LOOP
    IF to_date(substring(r.relname from '\d{4}_\d{2}$'), 'YYYY_MM') < v_cutoff THEN
      EXECUTE format('ALTER TABLE access_logs DETACH PARTITION %I', r.relname);
      EXECUTE format('DROP TABLE %I', r.relname);
    END IF;
  END LOOP;

  -- Rows that slipped into DEFAULT and are past retention.
  DELETE FROM access_logs_default WHERE created_at < v_cutoff;
END $$;

-- Spec (api-mcp-poc): "입력 query 원문은 30일 후 삭제". fact_ids/tool stay for 1 year.
CREATE OR REPLACE FUNCTION access_logs_purge_query_text(p_days int DEFAULT 30) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  UPDATE access_logs SET query_text = NULL
  WHERE query_text IS NOT NULL AND created_at < now() - make_interval(days => p_days);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- Other TTL housekeeping (idempotency 24h, expired codes/tokens, exports, 30-day user purge).
CREATE OR REPLACE FUNCTION housekeeping_purge_expired() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM idempotency_keys WHERE expires_at < now();
  DELETE FROM oauth_codes      WHERE expires_at < now() - interval '1 day';
  DELETE FROM oauth_tokens     WHERE expires_at < now() - interval '1 day';
  DELETE FROM refresh_tokens   WHERE expires_at < now() - interval '1 day';
  DELETE FROM exports          WHERE expires_at < now();
  -- 탈퇴 후 30일 파기: cascades to every user-owned table incl. access_logs.
  DELETE FROM users WHERE deleted_at IS NOT NULL AND deleted_at < now() - interval '30 days';
END $$;

-- Bootstrap partitions at migration time.
SELECT access_logs_maintain();
