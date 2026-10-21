# Edge Functions: the backend API

Four functions run on Supabase Edge Functions. All logic lives in [`_shared/`](_shared); each `index.ts` is a few lines. The same files run under Node in the tests (`npm run test:functions`) and under Deno on Supabase.

| Function | What it does | Needs sign-in |
|----------|--------------|---------------|
| `chat` | One question, one streamed answer | Yes |
| `summary` | Visit summary for a doctor from one to five chats | Yes |
| `delete-account` | Deletes the person and all their data | Yes |
| `health` | Up or down, for monitoring. No user data, no AI call | No |

Base URL: `https://<project>.supabase.co/functions/v1/<name>`.

**Sign-in.** Send the person's access token: `Authorization: Bearer <access_token>`. Guests are ordinary users with an `is_anonymous` claim. The platform's own JWT check is off in `config.toml` (it cannot read the new keys reliably); every function checks the token itself and answers `401 unauthenticated` without a valid one. Send the project's publishable key in an `apikey` header too, as the Supabase client does.

**Errors before a stream starts** are plain JSON with an HTTP status:

```json
{ "error": { "code": "quota_exceeded", "message": "…", "retryable": false, "limit": 8, "used": 9, "resets_at": "2026-10-20T18:30:00.000Z" } }
```

| `code` | Status | Meaning | What the app does |
|--------|--------|---------|-------------------|
| `unauthenticated` | 401 | Missing, expired or wrong token | Refresh the session once, else ask to sign in. Keep the typed text |
| `consent_required` | 403 | `missing: ["age_18","terms","ai_processing"]` not yet accepted at the current version | Show the consent step |
| `quota_exceeded` | 429 | Daily limit used. `resets_at` is midnight in India | Calm message with the time. **Emergencies are never refused** (see below) |
| `rate_limited` | 429 | Too fast. `Retry-After` header and `retry_after_s` | Wait and retry |
| `bad_request` | 400 | Empty, too long (over 4,000 characters), malformed | Show `message` |
| `not_found` | 404 | Conversation is not theirs or does not exist | Start a new chat |
| `internal` | 500 | Our fault. `retryable: true` | Retry once, then say so |

`message` is plain English for developers and fallbacks. **Show text chosen by `code`** (so it can be translated), not `message`.

## `POST /functions/v1/chat`

```jsonc
{
  "client_message_id": "uuid",        // required; makes retries safe
  "conversation_id": "uuid | null",   // generate it in the browser for a new chat, so a retry reuses it
  "message": "…",                     // 1 to 4,000 characters
  "history": [{ "role": "user|assistant", "text": "…" }],   // only used when nothing is saved
  "client": { "ui_lang": "en|hi" },
  "options": { "save": true, "use_profile": true }
}
```

- **Saving.** A chat is saved unless the account setting `save_chats` is off or `options.save` is `false`. When it is not saved, the browser sends the last few turns in `history` each time, and `conversation_id` in `meta` is `null`.
- **Health profile.** Used only for signed-in (non-guest) people who allow it and do not send `use_profile: false`.
- **Idempotent.** Send the same `client_message_id` and `conversation_id` again after a dropped connection: if the answer was already made, it is **replayed** (`done.replayed: true`) and nothing is counted or saved twice. If only the question was saved, the answer is finished without a second quota unit.
- The browser's own `client_flags` are **ignored** by the server. Only the server's rules decide what counts as an emergency.

### The response: `text/event-stream`

Headers: `Cache-Control: no-store`, `X-Accel-Buffering: no`. A comment line (`: connected`) goes first and `: ping` every 15 s. Events:

| Event | Payload | Notes |
|-------|---------|-------|
| `meta` | `{ conversation_id, message_id, user_message_id }` | First event. `message_id` is the answer's id |
| `status` | `{ step, state }` | `step`: `read`, `safety`, `medlineplus`, `fda`, `write`. `state`: `active`, `done`, `skipped`, `failed`. Real progress, in this order |
| `red_flag` | `{ level, rule_ids, crisis, signs, source }` | `level` is `emergency` or `ambulance`. **Open the emergency sheet** (or, if `crisis`, the calm support sheet). `signs` are plain labels or the person's own quoted words. `source`: `rules` (comes before anything else) or `model` (may follow after the question has been read) |
| `sources` | `[{ id, kind, publisher, title, url, retrieved_at, passage }]` | `id` is `S1`, `S2`… `kind`: `condition` or `medicine`. Real pages that were actually retrieved. `[]` when none |
| `field` | `{ name, value }` | One answer field, complete. See below |
| `done` | `{ message_id, usage, latency_ms, degraded, degraded_reason, saved, care_level, raised_by_rules, replayed }` | Last event. `saved: false` means show "not saved yet" |
| `error` | `{ code, message, retryable }` | Instead of `done`, only if the turn broke after the stream began |

**Fields**, always in this order, each sent once: `care_level`, `care_reason`, `headline`, `summary`, `likely_causes`, `try_tonight`, `see_doctor_if`, `emergency_if`, `medicines`, `questions_for_you`, `unknowns`, `questions_for_doctor`, `language`. A field is only sent when complete, and is the **final, checked value** (never raw model text). If a later field changes an earlier one (rare), the earlier field is sent again: **replace by `name`**.

Types: `care_level` is `selfcare | doctor | doctor24 | emergency | ambulance`. Claims are `{ text, source_ids[] }`; an empty `source_ids` is shown as **general guidance**. `medicines` entries are `{ name, note, source_ids[] }`. Questions are strings. Render everything as **plain text**, never HTML.

**`degraded` and `degraded_reason`.** The answer is a fixed or sources-only one, not a written one. Reasons: `ai_off` (kill switch, no key, or the daily token cap), `llm_error`, `incomplete`, `truncated`, `quota` (over the daily limit but an emergency, so answered for free), `consent` (not yet accepted, but an emergency), `db` (database unreachable, but an emergency). Show the answer; the `headline` already says what happened.

### Safety behavior to rely on

- The care level is **never below** what the red-flag rules found. If the AI said less, `care_level` is raised, `care_reason` says "We raised this because you mentioned: …", and `headline`/`summary` are replaced with fixed emergency wording.
- At `emergency` or `ambulance`, `try_tonight` is empty. No home remedies while someone should be getting help.
- **Earlier messages do not make a later question an emergency.** A rule that one message can trigger (chest pain, self-harm) counts only in the message that says it, and the AI's own safety flags need the person's words in the new message. Rules that need several facts together (a baby plus a fever) may use the last few messages, but only when the new message completes them. After a self-harm message the AI is told to check in gently and mention Tele-MANAS, then answer the new question.
- Self-harm (`red_flag.crisis`) uses a separate supportive prompt, no medical lookups, and always returns level `ambulance` with Tele-MANAS 14416 and 112 in the fixed fallback.
- **No amounts of medicine** appear anywhere: they are replaced by "Follow the instructions on the label, or ask a pharmacist how much to take." Prescription medicines get fixed wording. `medicines` lists only the medicines the person named.
- Web addresses and markup are stripped. Citation ids that were not retrieved are dropped. A citation that does not fit its claim is shown as general guidance.
- Emergencies (by the server's rules) are answered even with no consent, no quota, no AI, or no database, using the fixed wording. That costs nothing and sends nothing to anyone.

## `POST /functions/v1/summary`

```jsonc
{ "conversation_ids": ["uuid", …] }   // 1 to 5 of the person's own chats
```

Returns `200 { summary, degraded, prepared_at }` where `summary` is:

```jsonc
{ "title", "reason_for_visit",
  "timeline": [{ "when", "what" }], "details": [{ "label", "value" }],
  "medicines_and_allergies": [string],
  "warning_signs": { "present": [string], "not_present": [string] },
  "questions": [string] }
```

Only facts the person stated are included; any amount of medicine must also appear in their own words, or the line is dropped. If the AI is unavailable (`degraded: true`), it is the person's own words in date order plus the doctor questions saved with earlier answers. The function does not store anything: the app saves it into the `summaries` table, where the person can edit it. Counts as one question toward the daily limit. Requires consent.

## `POST /functions/v1/delete-account`

`{ "confirm": "DELETE" }` → `204`. Deletes the auth user; every table cascades. Rule events stay, no longer linked to anyone. Sign the person out afterwards.

## `GET /functions/v1/health`

`200 { ok, time, checks: { database, ai_configured, ai_enabled }, latency_ms }`, or `503` when the database cannot be reached. It never calls the AI (that would cost money).

## Settings (Supabase secrets)

Set with `bash scripts/set-function-secrets.sh`. The platform provides `SUPABASE_URL` and the keys itself.

| Name | Default | Meaning |
|------|---------|---------|
| `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL_MAIN` | none | The AI service (OpenAI chat-completions format). With any of these missing, the AI is off and answers are sources-only |
| `LLM_MODEL_FAST` | the main model | Reads the question and double-checks safety |
| `AI_ENABLED` | `true` | **Kill switch.** `false` turns every answer into the sources-only mode |
| `ALLOWED_ORIGINS` | `http://localhost:3000` | Comma-separated websites allowed to read answers |
| `QUOTA_GUEST`, `QUOTA_USER` | 8, 30 | Questions per day (India time) |
| `DAILY_TOKEN_CAP` | none | Total tokens a day across everyone, then the AI switches off until tomorrow |
| `RATE_PER_MINUTE` | 8 | Burst limit per person, kept per instance (best effort) |
| `NLM_EMAIL`, `OPENFDA_API_KEY` | none | Identify the app to MedlinePlus; raise the openFDA daily limit |
| `LLM_MAX_TOKENS_PARAM` | `max_tokens` | Set to `max_completion_tokens` for providers that require it |
| `LLM_ANSWER_MAX_TOKENS`, `LLM_TIMEOUT_MS`, `LLM_FIRST_TOKEN_TIMEOUT_MS`, `EXTRACT_TIMEOUT_MS`, `GROUND_SOURCE_TIMEOUT_MS`, `GROUND_TIMEOUT_MS` | 1400, 60000, 20000, 3500, 4000, 6000 | Limits |

## Logs

One JSON line per turn with ids, timings, rule ids, level, token counts and counters. **Never** message text, answers or names: an allow-list of field names is enforced in code and a test sends a unique phrase through a whole turn to prove it does not appear.

## Work and checks

```bash
npm test                      # shared code, copies in sync, 103 function tests, database tests
npm run typecheck             # web app and functions
bash scripts/set-function-secrets.sh
bash scripts/deploy-functions.sh
```

`_shared/vendor/` is generated from `packages/shared` by `node scripts/sync-shared.mjs` (a test fails if it is out of date). Edit the originals only.

## Checked live

`node scripts/live-check.mjs` (also `npm run live-check`; add `--show` to read the answers in full) signs in as a throwaway guest on the deployed project, runs a normal question, a retry, a medicine question, an emergency, a self-harm message, the summary and the account deletion, and prints PASS or FAIL for 25 checks. It last passed 25 of 25. Streaming through the Edge Runtime was measured with spike S1 (`node spikes/sse-client.mjs <url> 30`): unbuffered, no cut-off at 30 seconds.

## Not yet verified

- **A long stream.** Spike S1 ran 30 seconds. Answers take about 10 seconds. A 140-second run was not done.
- **The AI service's terms** and its Hindi quality. River AI's data policy could not be verified.
- **Account deletion with a real signed-in (non-guest) person.** Checked for a guest only.
- **Clinical content.** Every fixed sentence, the prompts, the brand table and the Hindi wording are drafts that need a physician, a pharmacist and a mental-health professional (PLAN.md 6.12).
- **Load.** Nothing has been tried with many people at once.
