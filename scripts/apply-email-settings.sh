#!/usr/bin/env bash
# Turns on sign-in emails from your own domain: Resend as the sender, and the branded email templates.
#
#   bash scripts/apply-email-settings.sh
#
# Create a Resend API key with "sending access" only. You type it here with hidden input; it is used for this
# one command and never written anywhere.
# Until this is done, Supabase's built-in sender is used: it only delivers to your own team's addresses
# (enough for you to test sign-in), at about 2 emails an hour.
set -euo pipefail

REF="${SUPABASE_PROJECT_REF:-xmcdubzdbmytlubfftzy}"
cd "$(dirname "$0")/.."
SB="npx --no-install supabase"

read -r -s -p "Resend API key (hidden): " RESEND_API_KEY
echo
if [[ -z "$RESEND_API_KEY" ]]; then
  echo "No key given, nothing changed."
  exit 0
fi
export RESEND_API_KEY

echo
echo "This is what will change (the key itself is hidden):"
$SB config diff --project-ref "$REF" | python3 -I -c "
import sys, json
line = [l for l in sys.stdin.read().splitlines() if l.startswith('{')][-1]
for change in json.loads(line)['changes']:
    print(' ', change['class'], '.'.join(change['path']))
"
read -r -p "Apply these to project $REF? [y/N] " reply
[[ "$reply" =~ ^[Yy]$ ]] || { echo "Nothing changed."; exit 0; }
$SB config push --project-ref "$REF" --yes
echo
echo "Done. One more step so the login page shows the code boxes:"
echo "  add  NEXT_PUBLIC_EMAIL_CODE=true  to apps/web/.env.local  and restart the web server."
echo "Then sign in with your email in the app to see the new email."
