#!/usr/bin/env bash
# Apply db/migrations/*.sql in lexical order, once each, tracked in schema_migrations.
# Usage: DATABASE_URL=postgres://persona:persona@localhost:5432/persona_hub db/scripts/migrate.sh
set -euo pipefail
DIR="$(cd "$(dirname "$0")/../migrations" && pwd)"
DB="${DATABASE_URL:-postgres://persona:persona@localhost:5432/persona_hub}"
PSQL=(psql "$DB" -v ON_ERROR_STOP=1 -X -q)

"${PSQL[@]}" -c "CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())"

for f in "$DIR"/*.sql; do
  v="$(basename "$f" .sql)"
  sum="$(sha256sum "$f" | cut -d' ' -f1)"
  applied="$("${PSQL[@]}" -tA -c "SELECT checksum FROM schema_migrations WHERE version = '$v'")"
  if [[ -n "$applied" ]]; then
    [[ "$applied" == "$sum" ]] || echo "WARN: $v changed after being applied (checksum mismatch)" >&2
    continue
  fi
  echo "applying $v"
  # single transaction per file: migration + bookkeeping commit together
  "${PSQL[@]}" -1 -f "$f" -c "INSERT INTO schema_migrations (version, checksum) VALUES ('$v', '$sum')"
done
echo "migrations up to date"
