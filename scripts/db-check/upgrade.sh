#!/usr/bin/env bash
# Upgrade harness (AC7): migrations up to the last Fase 0 one, a legacy
# fixture, then the Fase 1 migrations, the runbook steps and the checks in
# checks-upgrade/. Ends with the catalog guards in expand mode.
# Usage: scripts/db-check/upgrade.sh
set -euo pipefail

source "$(dirname "$0")/lib.sh"
start_pg 15

# Last migration that production runs before Fase 1.
LAST_FASE0=20261001130000

"${PSQL[@]}" -f "$HERE/shim.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  v=$(basename "$f" | cut -d_ -f1)
  [ "$v" -le "$LAST_FASE0" ] && apply_migration "$f"
done

echo "seed:    seed-legacy.sql"
"${PSQL[@]}" --single-transaction -f "$HERE/seed-legacy.sql"

for f in "$ROOT"/supabase/migrations/*.sql; do
  v=$(basename "$f" | cut -d_ -f1)
  [ "$v" -gt "$LAST_FASE0" ] && apply_migration "$f"
done

for f in "$HERE"/checks-upgrade/*.sql; do
  echo "check:   $(basename "$f")"
  "${PSQL[@]}" --single-transaction -f "$f"
done

echo "check:   00_guards.sql (expand)"
"${PSQL[@]}" -f "$HERE/checks/00_guards.sql"

echo "OK: upgrade from Fase 0 verified"
