# Shared by run.sh, upgrade.sh and rehearse-dump.sh: a throwaway Postgres.
#
# Toolchain (docs/fase1-plan.md §S1, I10):
# - PG_BIN: server binaries, PostgreSQL 16 by default for daily iteration;
#   PG_BIN=/opt/homebrew/opt/postgresql@17/bin before a release (production
#   runs 17).
# - PSQL: psql from libpq@18, which also reads pg_dump 18 output.
# shellcheck shell=bash

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
HERE="$ROOT/scripts/db-check"
PG_BIN=${PG_BIN:-/opt/homebrew/opt/postgresql@16/bin}
PSQL_BIN=${PSQL_BIN:-/opt/homebrew/opt/libpq@18/bin/psql}
PORT=${DB_CHECK_PORT:-54399}
# Postgres on macOS refuses to start without a valid locale in LC_ALL.
export LC_ALL=C

pg_major() {
  "$PG_BIN/postgres" --version | sed -E 's/^[^0-9]*([0-9]+).*/\1/'
}

# start_pg <min-major> [<exact-major>]
start_pg() {
  local min=$1 exact=${2:-}
  [ -x "$PG_BIN/postgres" ] || { echo "no postgres in PG_BIN=$PG_BIN" >&2; exit 1; }
  [ -x "$PSQL_BIN" ] || { echo "no psql at PSQL_BIN=$PSQL_BIN (brew install libpq)" >&2; exit 1; }
  local major
  major=$(pg_major)
  if [ "$major" -lt "$min" ]; then
    echo "need PostgreSQL >= $min, PG_BIN=$PG_BIN is $major" >&2; exit 1
  fi
  if [ -n "$exact" ] && [ "$major" != "$exact" ]; then
    echo "need PostgreSQL $exact exactly, PG_BIN=$PG_BIN is $major" >&2; exit 1
  fi

  TMP=$(mktemp -d)
  "$PG_BIN/initdb" -D "$TMP/data" -U postgres -A trust --no-locale -E UTF8 >/dev/null
  "$PG_BIN/pg_ctl" -D "$TMP/data" -o "-p $PORT -k $TMP -c listen_addresses=''" \
    -l "$TMP/postgres.log" -w start >/dev/null
  trap 'stop_pg' EXIT

  PSQL=("$PSQL_BIN" -h "$TMP" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X -o /dev/null)
  PSQL_OUT=("$PSQL_BIN" -h "$TMP" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X -At)
  echo "postgres: $("${PSQL_OUT[@]}" -c 'show server_version_num')"
}

stop_pg() {
  [ -n "${REST_PID:-}" ] && kill "$REST_PID" 2>/dev/null
  [ -n "${TMP:-}" ] && "$PG_BIN/pg_ctl" -D "$TMP/data" -m immediate stop >/dev/null 2>&1
  [ -n "${TMP:-}" ] && rm -rf "$TMP"
  return 0
}

# Each migration file runs as one transaction, like `supabase db push`.
apply_migration() {
  echo "migrate: $(basename "$1")"
  "${PSQL[@]}" --single-transaction -f "$1"
}
