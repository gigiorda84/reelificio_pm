#!/usr/bin/env bash
# Apply every migration to a throwaway local Postgres and run the SQL checks.
# Requires Postgres binaries on PATH (e.g. `brew install postgresql@16`).
# Usage: scripts/db-check/run.sh
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
HERE="$ROOT/scripts/db-check"
TMP=$(mktemp -d)
PORT=${DB_CHECK_PORT:-54399}

initdb -D "$TMP/data" -U postgres -A trust >/dev/null
pg_ctl -D "$TMP/data" -o "-p $PORT -k $TMP -c listen_addresses=''" -l "$TMP/postgres.log" -w start >/dev/null
trap 'pg_ctl -D "$TMP/data" -m immediate stop >/dev/null 2>&1; rm -rf "$TMP"' EXIT

PSQL=(psql -h "$TMP" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X -o /dev/null)

"${PSQL[@]}" -f "$HERE/shim.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "migrate: $(basename "$f")"
  "${PSQL[@]}" -f "$f"
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
  trap 'kill $REST_PID 2>/dev/null; pg_ctl -D "$TMP/data" -m immediate stop >/dev/null 2>&1; rm -rf "$TMP"' EXIT
  for _ in $(seq 1 50); do curl -sf "http://127.0.0.1:$REST_PORT/" >/dev/null && break; sleep 0.2; done
  DB_CHECK_REST="http://127.0.0.1:$REST_PORT" node "$HERE/api-check.mjs"
else
  echo "skip:    api-check.mjs (install postgrest to run it)"
fi

echo "OK: all migrations applied and all checks passed"
