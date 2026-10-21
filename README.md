# Hale

A calm, sourced personal health guide. Plain-language answers checked against NIH MedlinePlus and FDA drug-label
data, a clear next step, emergencies sent to 112 first, and your records (health profile, diary, medicines, Thali food
log, doctor summaries) kept in your own private account.

Live at https://hale-three.vercel.app.

## Layout

| Path | What |
|------|------|
| `apps/web` | The frontend: Next.js 16 site and app (landing, emergency, sign-in, the chat at `/app`, Personalization, Health diary, Thali, Doctor summaries, Settings) |
| `supabase/` | The backend: database migrations, Edge Functions (`chat`, `summary`, `delete-account`, `health`; see `supabase/functions/README.md`), tests and `config.toml` |
| `packages/shared` | Safety code used by both: emergency and self-harm rules, redaction of personal details, consent versions |
| `scripts/` | Setup, deploy and check scripts |

## Commands

```bash
npm install                          # once
npm run dev                          # the web app at http://localhost:3000
npm test                             # shared code, function copies in sync, functions, screen logic, database
npm run typecheck && npm run build   # what CI runs: web app and functions
npm run live-check                   # end-to-end check against the deployed project (needs CAPTCHA_TOKEN=...)
bash scripts/connect-supabase.sh     # one time: log in, link the project, apply migrations, auth and email settings
bash scripts/set-function-secrets.sh # one time: tell the functions which AI service to use (key typed hidden)
bash scripts/deploy-functions.sh     # checks, then deploys chat, summary, delete-account, health
bash scripts/apply-email-settings.sh # sign-in emails from your own domain (Resend)
```

## Secrets

Public values (the Supabase URL, the publishable key and the Turnstile site key) go in `apps/web/.env.local`, copied
from `.env.example`. **Secret values never go in a file in this repo.** Set them in Supabase with
`bash scripts/set-function-secrets.sh`, or in the Supabase dashboard (the Turnstile secret lives under Authentication →
Attack Protection). Your database password is typed into the setup script, which keeps it in memory only.
