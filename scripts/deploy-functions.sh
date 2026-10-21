#!/usr/bin/env bash
# Checks the Edge Functions, then deploys chat, summary, delete-account and health.
#
#   bash scripts/deploy-functions.sh
#
# Run `bash scripts/connect-supabase.sh` first (login, link, database) and
# `bash scripts/set-function-secrets.sh` (AI settings). No Docker is needed (--use-api).
set -euo pipefail

REF="${SUPABASE_PROJECT_REF:-xmcdubzdbmytlubfftzy}"
cd "$(dirname "$0")/.."
SB="npx --no-install supabase"
ask() { local reply; read -r -p "$1 [y/N] " reply; [[ "$reply" =~ ^[Yy]$ ]]; }

echo "Step 1 of 3: checks (copies of the shared safety code, type check, tests)."
node scripts/sync-shared.mjs --check
npx --no-install tsc -p supabase/functions/tsconfig.json
npm run test:functions --silent

echo
echo "Step 2 of 3: deploy to project $REF."
if ask "Deploy chat, summary, delete-account and health?"; then
  # verify_jwt is off in config.toml on purpose: each function checks the sign-in token itself.
  $SB functions deploy chat summary delete-account health --project-ref "$REF" --use-api
else
  echo "Skipped."
  exit 0
fi

echo
echo "Step 3 of 3: is it up?"
curl -sS -m 20 "https://$REF.supabase.co/functions/v1/health" || true
echo
echo "Expected: {\"ok\":true,...,\"checks\":{\"database\":true,\"ai_configured\":true,...}}"
echo "If ai_configured is false, run  bash scripts/set-function-secrets.sh"
