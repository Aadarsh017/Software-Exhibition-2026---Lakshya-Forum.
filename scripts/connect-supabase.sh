#!/usr/bin/env bash
# One-time setup: log in, link this repo to your Supabase project, apply the migrations,
# and apply the auth and email settings.
#
#   bash scripts/connect-supabase.sh
#
# You type your database password and your Resend API key yourself. Both are read without echo,
# kept only in this process, and never written to a file or shown in a log. Every change asks first.
set -euo pipefail

REF="${SUPABASE_PROJECT_REF:-xmcdubzdbmytlubfftzy}"
cd "$(dirname "$0")/.."
SB="npx --no-install supabase"

ask() { local reply; read -r -p "$1 [y/N] " reply; [[ "$reply" =~ ^[Yy]$ ]]; }

echo
echo "Step 1 of 4: log in. A browser window opens; approve it there."
$SB login

echo
echo "Step 2 of 4: link this folder to project $REF."
read -r -s -p "Database password (typing is hidden, nothing is saved): " SUPABASE_DB_PASSWORD
echo
export SUPABASE_DB_PASSWORD
$SB link --project-ref "$REF"

echo
echo "Step 3 of 4: migrations. This is what would be applied:"
$SB db push --dry-run
if ask "Apply these migrations to project $REF now?"; then
  $SB db push
else
  echo "Skipped. Run  npx supabase db push  when you are ready."
fi

echo
echo "Step 4 of 4: auth and email settings from supabase/config.toml:"
echo "  guest sign-in, 6-digit codes (15 minutes), sign-in email sent through Resend"
echo "  from no-reply@thedrawingboard.tech, and the branded email templates."
if [[ -z "${RESEND_API_KEY:-}" ]]; then
  read -r -s -p "Resend API key (typing is hidden, nothing is saved): " RESEND_API_KEY
  echo
fi
if [[ -z "${RESEND_API_KEY:-}" ]]; then
  echo "No key given, so nothing was changed. (Pushing without it would leave email with no password.)"
else
  export RESEND_API_KEY
  echo "The next command shows a difference and asks before changing anything."
  if ask "Review and apply the auth and email settings?"; then
    $SB config push
  else
    echo "Skipped."
  fi
fi

echo
echo "Done."
