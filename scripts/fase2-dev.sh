#!/usr/bin/env bash
# Dev server for Fase 2 (docs/fase2-plan.md D-A, DB1): Next on the sandbox
# project, never on staging or production.
#
#   scripts/fase2-dev.sh            # pnpm dev with .env.fase2.local
#   scripts/fase2-dev.sh --check    # only the checks below
#
# - Loads .env.fase2.local into the environment. Next does not override
#   variables already set, but it would still fill the missing ones from
#   .env.local / .env.development.local: so neither may exist in this
#   worktree, and the script stops if one does.
# - The Supabase URL must carry the sandbox ref, and the variables that
#   would reach staging services (Drive, Telegram, Sentry) must be empty.
set -euo pipefail

cd "$(dirname "$0")/.."
SANDBOX_REF=vgpjcqttekxxnkaeyhmh
ENV_FILE=.env.fase2.local

fail() { echo "fase2-dev: $*" >&2; exit 1; }

[ -f "$ENV_FILE" ] || fail "$ENV_FILE is missing (see docs/fase2-plan.md D-A)"
for f in .env.local .env.development.local .env; do
  [ ! -e "$f" ] || fail "$f exists in this worktree: Next would fill missing variables from it. Remove it."
done

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

case "${NEXT_PUBLIC_SUPABASE_URL:-}" in
  "https://$SANDBOX_REF.supabase.co") ;;
  *) fail "NEXT_PUBLIC_SUPABASE_URL is '${NEXT_PUBLIC_SUPABASE_URL:-}', not the sandbox $SANDBOX_REF: stopped" ;;
esac
[ -n "${NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:-}" ] || fail "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is empty"
[ -n "${SUPABASE_SECRET_KEY:-}" ] || fail "SUPABASE_SECRET_KEY is empty"
[ -n "${CRON_SECRET:-}" ] || fail "CRON_SECRET is empty"
for v in GOOGLE_SHARED_DRIVE_ID TELEGRAM_BOT_TOKEN TELEGRAM_WEBHOOK_SECRET NEXT_PUBLIC_SENTRY_DSN; do
  [ -z "${!v:-}" ] || fail "$v must be empty on the sandbox"
done
case "${AI_PROVIDER:-fake}" in
  fake | openrouter) ;;
  *) fail "AI_PROVIDER must be fake or openrouter" ;;
esac

echo "fase2-dev: sandbox $SANDBOX_REF · AI_PROVIDER=${AI_PROVIDER:-fake}"
[ "${1:-}" = "--check" ] && exit 0
exec pnpm dev
