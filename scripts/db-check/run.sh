#!/usr/bin/env bash
# Apply every migration to a throwaway local Postgres and run the SQL checks.
# Needs Homebrew postgresql@16 (or PG_BIN, see lib.sh) and libpq.
# Usage: scripts/db-check/run.sh
set -euo pipefail

source "$(dirname "$0")/lib.sh"
start_pg 15

"${PSQL[@]}" -f "$HERE/shim.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  apply_migration "$f"
done

for f in "$HERE"/checks/*.sql; do
  echo "check:   $(basename "$f")"
  "${PSQL[@]}" -f "$HERE/seed.sql" -f "$f"
done

# API checks through a real PostgREST (`brew install postgrest`), if present.
if command -v postgrest >/dev/null; then
  echo "check:   api-check.mjs (PostgREST)"
  "${PSQL[@]}" -f "$HERE/seed.sql" -c 'commit'
  export DB_CHECK_JWT_SECRET=$(openssl rand -hex 32)
  REST_PORT=$((PORT - 1))
  PGRST_DB_URI="postgres://postgres@/postgres?host=$TMP&port=$PORT" \
  PGRST_DB_SCHEMAS=public PGRST_DB_ANON_ROLE=anon PGRST_DB_MAX_ROWS=1000 \
  PGRST_JWT_SECRET="$DB_CHECK_JWT_SECRET" PGRST_SERVER_PORT=$REST_PORT \
    postgrest >"$TMP/postgrest.log" 2>&1 &
  REST_PID=$!
  for _ in $(seq 1 50); do curl -sf "http://127.0.0.1:$REST_PORT/" >/dev/null && break; sleep 0.2; done
  DB_CHECK_REST="http://127.0.0.1:$REST_PORT" node "$HERE/api-check.mjs"
else
  echo "skip:    api-check.mjs (install postgrest to run it)"
fi

echo "OK: all migrations applied and all checks passed"
