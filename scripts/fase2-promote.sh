#!/usr/bin/env bash
# Promotion of the Fase 2 SQL (docs/fase2-plan.md D-A, §8): moves
# supabase/fase2/NNN_<name>.sql into supabase/migrations/<ts>_fase2_<name>.sql
# with fresh timestamps in file order, so Fase 2 sorts after R1, R2 and every
# hotfix. Run it at most a week before the production release, together with
# the staging push; from then until production, Fase 1 migrations are frozen.
#
#   scripts/fase2-promote.sh --dry-run   # print the new names, change nothing
#   scripts/fase2-promote.sh             # git mv the files
#   scripts/fase2-promote.sh --check     # after promotion: does any Fase 1
#                                        # migration sort after Fase 2?
#   scripts/fase2-promote.sh --rebase    # after promotion: re-timestamp the
#                                        # Fase 2 migrations after the newest one
#
# After --rebase, staging only needs bookkeeping (same content):
#   supabase migration repair --status reverted <old versions>
#   supabase migration repair --status applied  <new versions>
# then the dump rehearsal again.
set -euo pipefail

cd "$(dirname "$0")/.."
MIG=supabase/migrations
SRC=supabase/fase2
MODE=${1:-promote}

fail() { echo "fase2-promote: $*" >&2; exit 1; }
now_ts() { date -u +%Y%m%d%H%M%S; }
# Timestamp + n seconds, in UTC (BSD date on macOS, GNU date elsewhere).
ts_plus() {
  date -u -j -v+"$2"S -f %Y%m%d%H%M%S "$1" +%Y%m%d%H%M%S 2>/dev/null ||
    date -u -d "$(echo "$1" | sed -E 's/(....)(..)(..)(..)(..)(..)/\1-\2-\3 \4:\5:\6/') + $2 seconds" +%Y%m%d%H%M%S
}
version() { basename "$1" | cut -d_ -f1; }

fase2_migrations() { ls "$MIG"/*_fase2_*.sql 2>/dev/null || true; }
other_migrations() { ls "$MIG"/*.sql | grep -v '_fase2_' || true; }
newest_other() { other_migrations | xargs -n1 basename | cut -d_ -f1 | sort | tail -1; }

# New names starting one second after $1, for the files listed on stdin.
plan_names() {
  local base=$1 n=0 f name
  while read -r f; do
    n=$((n + 1))
    name=$(basename "$f" .sql)
    name=${name#*_}                 # NNN_bible -> bible, or <ts>_fase2_bible -> fase2_bible
    name=${name#fase2_}
    echo "$f $MIG/$(ts_plus "$base" "$n")_fase2_$name.sql"
  done
}

case "$MODE" in
  --check)
    [ -n "$(fase2_migrations)" ] || fail "nothing promoted yet (files still in $SRC/)"
    first=$(fase2_migrations | head -1 | xargs basename | cut -d_ -f1)
    later=$(other_migrations | while read -r f; do [ "$(version "$f")" -gt "$first" ] && basename "$f"; done || true)
    if [ -n "$later" ]; then
      echo "fase2-promote: Fase 1 migrations newer than Fase 2 ($first):"
      echo "$later" | sed 's/^/  /'
      echo "Run scripts/fase2-promote.sh --rebase, then repair the staging history (see the header)."
      exit 1
    fi
    echo "fase2-promote: OK, Fase 2 ($first…) sorts after every other migration"
    ;;

  --rebase)
    [ -n "$(fase2_migrations)" ] || fail "nothing promoted yet"
    base=$(newest_other)
    [ "$base" -lt "$(now_ts)" ] || fail "a migration is dated in the future ($base): stopped"
    fase2_migrations | plan_names "$(now_ts)" | while read -r from to; do
      git mv "$from" "$to"
      echo "renamed: $(basename "$from") -> $(basename "$to")"
    done
    ;;

  --dry-run | promote)
    [ -z "$(fase2_migrations)" ] || fail "already promoted; use --check or --rebase"
    ls "$SRC"/*.sql >/dev/null 2>&1 || fail "no files in $SRC/"
    ls "$MIG"/*_fase1_r1_contract.sql >/dev/null 2>&1 ||
      fail "the R1 contract is not a migration yet: Fase 2 is promoted only after R1 and R2"
    newest=$(newest_other)
    now=$(now_ts)
    [ "$newest" -lt "$now" ] || fail "a migration is dated in the future ($newest): stopped"
    ls "$SRC"/*.sql | sort | plan_names "$now" | while read -r from to; do
      if [ "$MODE" = --dry-run ]; then
        echo "would move: $from -> $to"
      else
        git mv "$from" "$to"
        echo "moved: $from -> $to"
      fi
    done
    ;;

  *)
    fail "usage: scripts/fase2-promote.sh [--dry-run | --check | --rebase]"
    ;;
esac
