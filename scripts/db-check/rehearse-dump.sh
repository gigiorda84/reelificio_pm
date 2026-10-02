#!/usr/bin/env bash
# Rehearsal of the R1 migration on a real production dump (docs/fase1-plan.md
# §S1 and release steps 0a/0b), on PostgreSQL 17 like production.
#
# Usage:
#   scripts/db-check/rehearse-dump.sh <dump-dir> [--release r1] [--upto <version>]
#     [--allowlist <file>] [--csv <file>] [--config <file>] [--as <admin email>]
#
# <dump-dir> (supabase/backups/<date>-prod/) holds data.sql and, in the format
# fixed in iter3, schema-public.sql and migrations.txt. Without
# migrations.txt pass --upto <last production version>; without
# schema-public.sql the schema comparison is skipped (and said so).
# Defaults: allowlist supabase/backups/fase1/internal-emails.txt, CSV
# supabase/backups/fase1/collaborators.csv, config scripts/fase1-prod-config.sql,
# acting admin = the first admin in the dump.
#
# Steps: rebuild production's schema → compare it with schema-public.sql
# (differences outside drift-allow.txt stop) → load the data → report
# "before" (stops if a profile is not on the internal allowlist) → Fase 1
# migrations → externals from the CSV → config → backfill → report "after"
# → counters compared with "before" → catalog guards. Reports are saved in
# <dump-dir>/rehearsal-<time>/ (not in git: they hold personal data).
set -euo pipefail

PG_BIN=${PG_BIN:-/opt/homebrew/opt/postgresql@17/bin}
source "$(dirname "$0")/lib.sh"
PG_DUMP=${PG_DUMP:-/opt/homebrew/opt/libpq@18/bin/pg_dump}

DUMP=${1:?usage: rehearse-dump.sh <dump-dir> [options]}
shift
RELEASE=r1
UPTO=""
ALLOWLIST="$ROOT/supabase/backups/fase1/internal-emails.txt"
CSV="$ROOT/supabase/backups/fase1/collaborators.csv"
CONFIG="$ROOT/scripts/fase1-prod-config.sql"
AS_EMAIL=""
while [ $# -gt 0 ]; do
  case "$1" in
    --release) RELEASE=$2; shift 2 ;;
    --upto) UPTO=$2; shift 2 ;;
    --allowlist) ALLOWLIST=$2; shift 2 ;;
    --csv) CSV=$2; shift 2 ;;
    --config) CONFIG=$2; shift 2 ;;
    --as) AS_EMAIL=$2; shift 2 ;;
    *) echo "unknown option $1" >&2; exit 1 ;;
  esac
done
[ "$RELEASE" = r1 ] || { echo "--release $RELEASE: only r1 exists until S5 (I2)" >&2; exit 1; }
for f in "$DUMP/data.sql" "$ALLOWLIST" "$CSV" "$CONFIG"; do
  [ -f "$f" ] || { echo "STOP: missing $f" >&2; exit 1; }
done

OUT="$DUMP/rehearsal-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT"
stop() { echo "STOP: $*" | tee -a "$OUT/STOP.txt" >&2; exit 1; }

start_pg 17 17

# 1. Production's migration version.
LOCAL_VERSIONS=$(ls "$ROOT"/supabase/migrations/*.sql | xargs -n1 basename | cut -d_ -f1)
if [ -f "$DUMP/migrations.txt" ]; then
  REMOTE_VERSIONS=$(awk -F'|' 'NR>2 { gsub(/ /, "", $2); if ($2 ~ /^[0-9]+$/) print $2 }' "$DUMP/migrations.txt")
  [ -n "$REMOTE_VERSIONS" ] || stop "no remote versions in migrations.txt"
  LAST=$(echo "$REMOTE_VERSIONS" | sort | tail -1)
  for v in $REMOTE_VERSIONS; do
    echo "$LOCAL_VERSIONS" | grep -qx "$v" || stop "production has migration $v, missing locally"
  done
  for v in $LOCAL_VERSIONS; do
    if [ "$v" -le "$LAST" ] && ! echo "$REMOTE_VERSIONS" | grep -qx "$v"; then
      stop "local migration $v (≤ $LAST) is not in production"
    fi
  done
else
  [ -n "$UPTO" ] || stop "no migrations.txt: pass --upto <version>"
  LAST=$UPTO
  echo "note:    no migrations.txt, rebuilding up to --upto $LAST"
fi
echo "release: $RELEASE · production at $LAST"

"${PSQL[@]}" -f "$HERE/shim.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  v=$(basename "$f" | cut -d_ -f1)
  [ "$v" -le "$LAST" ] && apply_migration "$f"
done

# 2. Schema comparison with production.
if [ -f "$DUMP/schema-public.sql" ]; then
  "$PG_DUMP" -h "$TMP" -p "$PORT" -U postgres --schema-only --schema=public --no-owner postgres >"$OUT/schema-rebuilt.sql"
  node "$HERE/dump-tools.mjs" normalize-schema "$OUT/schema-rebuilt.sql" >"$OUT/rebuilt.norm"
  node "$HERE/dump-tools.mjs" normalize-schema "$DUMP/schema-public.sql" >"$OUT/prod.norm"
  { comm -23 "$OUT/rebuilt.norm" "$OUT/prod.norm" | sed 's/^/+ /'
    comm -13 "$OUT/rebuilt.norm" "$OUT/prod.norm" | sed 's/^/- /'; } >"$OUT/schema-diff.txt"
  grep -vxF -f <(grep -v '^#' "$HERE/drift-allow.txt" | sed '/^$/d') "$OUT/schema-diff.txt" >"$OUT/schema-drift.txt" || true
  if [ -s "$OUT/schema-drift.txt" ]; then
    echo "schema differences not in drift-allow.txt:" >&2
    cat "$OUT/schema-drift.txt" >&2
    stop "production schema drift ($(wc -l <"$OUT/schema-drift.txt" | tr -d ' ') lines, see $OUT/schema-drift.txt)"
  fi
  echo "schema:  matches production (allowed differences: $(wc -l <"$OUT/schema-diff.txt" | tr -d ' '))"
else
  echo "schema:  SKIPPED, no schema-public.sql in $DUMP"
fi

# 3. Data: public tables and auth.users (staging table → id, email, metadata).
node "$HERE/dump-tools.mjs" filter-data "$DUMP/data.sql" "$TMP/data.sql"
"${PSQL[@]}" --single-transaction -f "$TMP/data.sql"
"${PSQL[@]}" --single-transaction -c "
  set session_replication_role = replica;
  insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data, created_at)
  select id::uuid, email, coalesce(raw_app_meta_data, '{}')::jsonb,
         coalesce(raw_user_meta_data, '{}')::jsonb, created_at::timestamptz
    from rehearse_stage.auth_users;
  set session_replication_role = origin;"
rm -f "$TMP/data.sql"

# 4. Report before (stops on a profile outside the internal allowlist).
ALLOW=$(sed -e 's/#.*//' -e 's/[[:space:]]//g' "$ALLOWLIST" | sed '/^$/d' | paste -sd, -)
"${PSQL_OUT[@]}" -v phase=before -v allowlist="$ALLOW" -f "$ROOT/scripts/fase1-migration-report.sql" \
  >"$OUT/report-before.txt" 2>&1 || { cat "$OUT/report-before.txt" >&2; stop "report before"; }

# 5. Fase 1 migrations.
for f in "$ROOT"/supabase/migrations/*.sql; do
  v=$(basename "$f" | cut -d_ -f1)
  [ "$v" -gt "$LAST" ] && apply_migration "$f"
done

# 6. External accounts from the same CSV as release step 6b.
ADMIN_SQL="select id from profiles where is_admin order by created_at limit 1"
[ -n "$AS_EMAIL" ] && ADMIN_SQL="select id from profiles where is_admin and lower(email) = lower('$AS_EMAIL')"
ADMIN_ID=$("${PSQL_OUT[@]}" -c "$ADMIN_SQL")
[ -n "$ADMIN_ID" ] || stop "no acting admin in the dump"
"${PSQL[@]}" -c "
create function rehearse_stage.add_external(p_email text, p_name text, p_kind external_kind, p_drive text)
returns void language plpgsql as \$\$
declare
  v_id uuid;
  v_type account_type;
  v_code text;
begin
  select id, account_type into v_id, v_type from profiles where lower(email) = lower(p_email);
  if v_type = 'internal' then
    raise exception 'STOP: % is an internal profile (review it as an existing external, I11)', p_email;
  end if;
  if v_id is null then
    v_id := gen_random_uuid();
    insert into auth.users (id, email, raw_app_meta_data) values (v_id, p_email, '{\"account_type\":\"external\"}');
  end if;
  v_code := public.set_collaborator_as('$ADMIN_ID', v_id, 'external', p_kind, p_drive, p_name);
  if v_code <> 'ok' then
    raise exception 'STOP: set_collaborator_as % → %', p_email, v_code;
  end if;
end \$\$;"
pnpm --silent exec tsx "$HERE/collaborators-to-sql.ts" "$CSV" >"$TMP/collaborators.sql"
CSV_ROWS=$(grep -c . "$TMP/collaborators.sql" || true)
"${PSQL[@]}" --single-transaction -f "$TMP/collaborators.sql"
echo "externals: $CSV_ROWS from $(basename "$CSV")"

# 7. Configuration, backfill, report after.
"${PSQL[@]}" -f "$CONFIG"
"${PSQL_OUT[@]}" -c "select public.fase1_backfill_open_tasks()" | tee "$OUT/backfill.txt"
"${PSQL_OUT[@]}" -c "select public.fase1_backfill_open_tasks()" >"$OUT/backfill-second.txt"
grep -q '"tasks_created": 0' "$OUT/backfill-second.txt" || stop "backfill not idempotent"
"${PSQL_OUT[@]}" -v phase=after -f "$ROOT/scripts/fase1-migration-report.sql" \
  >"$OUT/report-after.txt" 2>&1 || { cat "$OUT/report-after.txt" >&2; stop "report after"; }

# Counters must match; profiles grow by exactly the CSV rows.
counters() { grep -E '^counter:' "$1" | sort; }
diff <(counters "$OUT/report-before.txt" | grep -v '^counter:profiles_total|') \
     <(counters "$OUT/report-after.txt" | grep -v '^counter:profiles_total|') >"$OUT/counters-diff.txt" \
  || { cat "$OUT/counters-diff.txt" >&2; stop "counters changed"; }
P_BEFORE=$(grep '^counter:profiles_total|' "$OUT/report-before.txt" | cut -d'|' -f2)
P_AFTER=$(grep '^counter:profiles_total|' "$OUT/report-after.txt" | cut -d'|' -f2)
[ "$P_AFTER" -eq $((P_BEFORE + CSV_ROWS)) ] || stop "profiles $P_BEFORE → $P_AFTER with $CSV_ROWS CSV rows"

"${PSQL[@]}" -f "$HERE/checks/00_guards.sql" || stop "catalog guards"

echo "OK: rehearsal green · reports in $OUT"
