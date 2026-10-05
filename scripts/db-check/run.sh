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
# Until the contract becomes a migration (end of S4) it lives in
# supabase/rollback/; the checks below describe the state after it.
if ! ls "$ROOT"/supabase/migrations/*_fase1_r1_contract.sql >/dev/null 2>&1; then
  echo "migrate: fase1_r1_recontract.sql (contract, from supabase/rollback)"
  "${PSQL[@]}" --single-transaction -f "$ROOT/supabase/rollback/fase1_r1_recontract.sql"
fi
export PGOPTIONS="-c db_check.contract_applied=on"

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

# The sweep skips a reel locked by a running transition (S4): a second
# connection holds the lock while the sweep runs.
echo "check:   sweep skips a locked reel"
[ -n "${REST_PID:-}" ] || "${PSQL[@]}" -f "$HERE/seed.sql" -c 'commit'
"${PSQL[@]}" -f "$HERE/concurrency/sweep-locked-setup.sql"
"${PSQL[@]}" -c "begin; select 1 from reels where id = '30000000-0000-0000-0000-0000000000a1' for update; select pg_sleep(3); commit;" &
LOCKER=$!
sleep 1
# Separate statements: one statement does not see the sweep's own writes.
STAMPED="select overdue_notified_at is not null from tasks where id = '50000000-0000-0000-0000-0000000000a1'"
got=$("${PSQL_OUT[@]}" -c "select public.sweep_tasks(now()) ->> 'skipped_locked'" -c "$STAMPED" | tr '\n' ' ')
wait "$LOCKER"
[ "$got" = "1 f " ] || { echo "FAIL: the sweep did not skip the locked reel ($got)"; exit 1; }
got=$("${PSQL_OUT[@]}" -c "select public.sweep_tasks(now()) ->> 'skipped_locked'" -c "$STAMPED" | tr '\n' ' ')
[ "$got" = "0 t " ] || { echo "FAIL: the sweep did not take the reel once unlocked ($got)"; exit 1; }

echo "OK: all migrations applied and all checks passed"
