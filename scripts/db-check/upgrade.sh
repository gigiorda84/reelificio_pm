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

# Expand applied, Fase 0 code still in charge.
upgrade_check() {
  echo "check:   $1"
  "${PSQL[@]}" --single-transaction -f "$HERE/checks-upgrade/$1"
}
guards() {
  echo "check:   00_guards.sql ($1)"
  PGOPTIONS="-c db_check.contract_applied=$([ "$1" = contract ] && echo on || echo off)" \
    "${PSQL[@]}" -f "$HERE/checks/00_guards.sql"
}
upgrade_check 01_fase1_mapping.sql
guards expand
for f in "$HERE"/checks-legacy/*.sql; do
  echo "check:   legacy/$(basename "$f")"
  "${PSQL[@]}" -f "$HERE/seed.sql" -f "$f"
done

# Contract (after the code deploy).
echo "migrate: fase1_r1_recontract.sql (contract)"
"${PSQL[@]}" --single-transaction -f "$ROOT/supabase/rollback/fase1_r1_recontract.sql"
upgrade_check 02_contract.sql
guards contract

# Rollback level 2: uncontract, the Fase 0 code moves reels again.
echo "migrate: fase1_r1_uncontract.sql (rollback)"
"${PSQL[@]}" --single-transaction -f "$ROOT/supabase/rollback/fase1_r1_uncontract.sql"
guards expand
upgrade_check 03_after_uncontract.sql

# Forward again: re-contract, then reconcile the tasks.
echo "migrate: fase1_r1_recontract.sql (forward again)"
"${PSQL[@]}" --single-transaction -f "$ROOT/supabase/rollback/fase1_r1_recontract.sql"
upgrade_check 04_reconcile.sql
guards contract

echo "OK: upgrade from Fase 0, contract, uncontract and reconcile verified"
