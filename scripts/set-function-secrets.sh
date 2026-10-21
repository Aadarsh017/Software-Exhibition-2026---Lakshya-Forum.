#!/usr/bin/env bash
# Sets the private settings the Edge Functions need: which AI service to call, and a few limits.
#
#   bash scripts/set-function-secrets.sh
#
# Nothing is stored in this folder. Your AI key is typed with hidden input, written to a private
# temporary file (owner-only, deleted when this script ends, even on error) and sent to Supabase's
# secret store with `supabase secrets set`. It never appears in a command line or a log.
# Leave an answer empty to keep the value Supabase already has.
set -euo pipefail

REF="${SUPABASE_PROJECT_REF:-xmcdubzdbmytlubfftzy}"
cd "$(dirname "$0")/.."
SB="npx --no-install supabase"

umask 077
WORK="$(mktemp -d)"
ENVFILE="$WORK/secrets.env"
trap 'rm -rf "$WORK"' EXIT
: > "$ENVFILE"

add() { # add NAME VALUE   (skips empty values; rejects line breaks)
  local name="$1" value="$2"
  [[ -z "$value" ]] && return 0
  if [[ "$value" == *$'\n'* || "$value" == *$'\r'* ]]; then echo "Skipped $name: it contains a line break."; return 0; fi
  printf '%s=%s\n' "$name" "$value" >> "$ENVFILE"
}
ask_line()  { local v; read -r -p "$1 " v; printf '%s' "$v"; }
ask_secret() { local v; read -r -s -p "$1 (hidden) " v; echo >&2; printf '%s' "$v"; }
ask_yes()   { local reply; read -r -p "$1 [y/N] " reply; [[ "$reply" =~ ^[Yy]$ ]]; }

cat <<'TXT'

The functions call an AI service that speaks the "OpenAI chat completions" format.
Pick one whose data terms you have read: zero retention and no training on your users' messages
(see PLAN.md 6.10). Leave everything empty to keep what is already set.

TXT

add LLM_BASE_URL    "$(ask_line 'AI base URL, ending in /v1 (for example https://api.example.com/v1):')"
add LLM_API_KEY     "$(ask_secret 'AI API key:')"
add LLM_MODEL_MAIN  "$(ask_line 'Main model name (writes the answers):')"
add LLM_MODEL_FAST  "$(ask_line 'Fast model name (reads the question; empty = same as main):')"
add ALLOWED_ORIGINS "$(ask_line 'Websites allowed to call the functions, comma separated (default http://localhost:3000):')"
add NLM_EMAIL       "$(ask_line 'Contact email sent to MedlinePlus so they can reach you if needed (optional):')"
add OPENFDA_API_KEY "$(ask_secret 'openFDA API key (optional; raises the daily limit from 1,000 to 120,000):')"
add QUOTA_GUEST     "$(ask_line 'Questions per day for guests (default 8):')"
add QUOTA_USER      "$(ask_line 'Questions per day for signed-in people (default 30):')"
add DAILY_TOKEN_CAP "$(ask_line 'Switch the AI off for everyone after this many tokens a day (empty = no cap):')"

if [[ ! -s "$ENVFILE" ]]; then
  echo "Nothing to set."
  exit 0
fi

echo
echo "Will set these names on project $REF (values are not shown):"
cut -d= -f1 "$ENVFILE" | sed 's/^/  - /'
if ask_yes "Send them to Supabase now?"; then
  $SB secrets set --project-ref "$REF" --env-file "$ENVFILE"
  echo
  $SB secrets list --project-ref "$REF"
else
  echo "Nothing was sent."
fi
