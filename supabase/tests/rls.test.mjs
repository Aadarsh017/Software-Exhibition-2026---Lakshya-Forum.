// Security tests for the database (PLAN.md 7.2, 7.5): who can read or write what.
// They run our real migrations on an in-process Postgres, so no Docker is needed.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  createDb, withRole, asUser, asGuest, asAnon, asService,
  createUser, createConversation, createMessage, daysAgo,
} from "./support/db.mjs";

let db;
before(async () => { db = await createDb(); });
after(async () => { await db.close(); });

const TABLES = [
  "profiles", "health_profile", "lab_results", "health_log", "medicine_schedule", "dose_log", "consents", "conversations",
  "messages", "summaries", "feedback", "feature_flags", "source_cache", "usage_daily", "rule_events", "usage_global_daily",
];

/** Asserts that the promise rejects with an error message matching `pattern`. */
const rejects = (promise, pattern) =>
  assert.rejects(promise, (error) => pattern.test(String(error?.message ?? error)));

// ---------------------------------------------------------------------------
test("every table in public has row level security on", async () => {
  const result = await db.query(`
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity order by 1`);
  assert.deepEqual(result.rows.map((row) => row.relname), []);
});

test("default-deny: a table created later is not reachable by browser roles", async () => {
  await db.exec("create table public.zz_later (id int)");
  const user = await createUser(db);
  await rejects(asUser(db, user, (d) => d.query("select * from public.zz_later")), /permission denied/i);
  await rejects(asAnon(db, (d) => d.query("select * from public.zz_later")), /permission denied/i);
  await db.exec("drop table public.zz_later");
});

test("the anon role cannot read any table", async () => {
  for (const table of TABLES) {
    await rejects(asAnon(db, (d) => d.query(`select 1 from public.${table} limit 1`)), /permission denied/i);
  }
});

// ---------------------------------------------------------------------------
test("a profile is created for every new user, guests included, with safe defaults", async () => {
  const member = await createUser(db);
  const guest = await createUser(db, { anonymous: true });
  const rows = await db.query(
    "select id, language, theme, save_chats, voice_enabled from public.profiles where id = any($1)",
    [[member, guest]]
  );
  assert.equal(rows.rows.length, 2);
  for (const row of rows.rows) {
    assert.equal(row.language, "en");
    assert.equal(row.theme, "auto");
    assert.equal(row.save_chats, true);
    assert.equal(row.voice_enabled, false, "voice typing must be opt-in");
  }
});

test("profiles: each person sees and edits only their own", async () => {
  const a = await createUser(db);
  const b = await createUser(db);
  const seen = await asUser(db, a, (d) => d.query("select id from public.profiles"));
  assert.deepEqual(seen.rows.map((row) => row.id), [a]);

  const own = await asUser(db, a, (d) =>
    d.query("update public.profiles set language = 'hi' where id = $1 returning language", [a]));
  assert.equal(own.rows[0].language, "hi");

  const other = await asUser(db, a, (d) =>
    d.query("update public.profiles set language = 'hi' where id = $1 returning id", [b]));
  assert.equal(other.rows.length, 0, "must not be able to edit someone else's profile");

  await rejects(asUser(db, a, (d) => d.query("update public.profiles set created_at = now() where id = $1", [a])),
    /permission denied/i);
  await rejects(asUser(db, a, (d) => d.query("insert into public.profiles (id) values (gen_random_uuid())")),
    /permission denied/i);
  await rejects(asUser(db, a, (d) => d.query("delete from public.profiles where id = $1", [a])),
    /permission denied/i);
});

// ---------------------------------------------------------------------------
test("consents: own rows only, append-only, versions recorded", async () => {
  const a = await createUser(db);
  const b = await createUser(db);

  const inserted = await asUser(db, a, (d) =>
    d.query("insert into public.consents (doc_type, version) values ('ai_processing', 'v1') returning user_id, accepted_at"));
  assert.equal(inserted.rows[0].user_id, a, "user_id comes from the token, not from the caller");
  assert.ok(inserted.rows[0].accepted_at);

  await db.query("insert into public.consents (user_id, doc_type, version) values ($1, 'terms', 'v1')", [b]);
  const seen = await asUser(db, a, (d) => d.query("select user_id from public.consents"));
  assert.ok(seen.rows.every((row) => row.user_id === a));

  await rejects(asUser(db, a, (d) =>
    d.query("insert into public.consents (user_id, doc_type, version) values ($1, 'terms', 'v1')", [b])),
    /permission denied/i);
  await rejects(asUser(db, a, async (d) => {
    await d.query("insert into public.consents (doc_type, version) values ('terms', 'v1')");
    await d.query("insert into public.consents (doc_type, version) values ('terms', 'v1')");
  }), /duplicate key/i);
  await rejects(asUser(db, a, (d) => d.query("update public.consents set version = 'v2'")), /permission denied/i);
  await rejects(asUser(db, a, (d) => d.query("delete from public.consents")), /permission denied/i);
});

// ---------------------------------------------------------------------------
test("conversations: the browser can read, rename and delete its own, never create or re-level", async () => {
  const a = await createUser(db);
  const b = await createUser(db);
  const conv = await createConversation(db, a, "My headache");

  assert.deepEqual((await asUser(db, a, (d) => d.query("select id from public.conversations"))).rows.map((r) => r.id), [conv]);
  assert.equal((await asUser(db, b, (d) => d.query("select id from public.conversations"))).rows.length, 0);

  const renamed = await asUser(db, a, (d) =>
    d.query("update public.conversations set title = 'Renamed' where id = $1 returning title", [conv]));
  assert.equal(renamed.rows[0].title, "Renamed");
  const stranger = await asUser(db, b, (d) =>
    d.query("update public.conversations set title = 'Hacked' where id = $1 returning id", [conv]));
  assert.equal(stranger.rows.length, 0);

  await rejects(asUser(db, a, (d) => d.query("update public.conversations set max_care_level = 'selfcare' where id = $1", [conv])),
    /permission denied/i);
  await rejects(asUser(db, a, (d) => d.query("insert into public.conversations (user_id, title) values ($1, 'x')", [a])),
    /permission denied/i);

  const gone = await asUser(db, a, (d) => d.query("delete from public.conversations where id = $1 returning id", [conv]));
  assert.equal(gone.rows.length, 1);

  const viaService = await asService(db, (d) =>
    d.query("insert into public.conversations (user_id, title) values ($1, 'by function') returning id", [a]));
  assert.equal(viaService.rows.length, 1, "the service role can create conversations");
});

// ---------------------------------------------------------------------------
test("messages: browser can read its own, can never forge, edit or delete one (security review 2026-10-20)", async () => {
  const a = await createUser(db);
  const b = await createUser(db);
  const conv = await createConversation(db, a);
  const mine = await createMessage(db, conv, a, "assistant", { content: "answer" });

  assert.deepEqual((await asUser(db, a, (d) => d.query("select id from public.messages"))).rows.map((r) => r.id), [mine]);
  assert.equal((await asUser(db, b, (d) => d.query("select id from public.messages"))).rows.length, 0);

  await rejects(asUser(db, a, (d) =>
    d.query("insert into public.messages (conversation_id, user_id, role, content) values ($1, $2, 'assistant', 'forged')", [conv, a])),
    /permission denied/i);
  await rejects(asUser(db, a, (d) => d.query("update public.messages set content = 'edited' where id = $1", [mine])),
    /permission denied/i);

  // Deleting a single answer let it be re-asked free; whole chats are still deleted, with their messages, by cascade.
  await rejects(asUser(db, b, (d) => d.query("delete from public.messages where id = $1", [mine])), /permission denied/i);
  await rejects(asUser(db, a, (d) => d.query("delete from public.messages where id = $1", [mine])), /permission denied/i);
  await asUser(db, a, (d) => d.query("delete from public.conversations where id = $1", [conv]));
});

test("messages: a message must belong to a conversation of the same user", async () => {
  const a = await createUser(db);
  const b = await createUser(db);
  const conv = await createConversation(db, a);
  await rejects(createMessage(db, conv, b, "user"), /foreign key/i);
});

test("messages: retries with the same client_message_id cannot duplicate", async () => {
  const a = await createUser(db);
  const conv = await createConversation(db, a);
  const key = "11111111-1111-4111-8111-111111111111";
  await createMessage(db, conv, a, "user", { clientMessageId: key });
  await rejects(createMessage(db, conv, a, "user", { clientMessageId: key }), /duplicate key/i);
});

test("a conversation's highest care level can only go up", async () => {
  const a = await createUser(db);
  const conv = await createConversation(db, a);
  const level = async () => (await db.query("select max_care_level from public.conversations where id = $1", [conv])).rows[0].max_care_level;

  await createMessage(db, conv, a, "assistant", { careLevel: "doctor24" });
  assert.equal(await level(), "doctor24");
  await createMessage(db, conv, a, "assistant", { careLevel: "selfcare" });
  assert.equal(await level(), "doctor24", "a later calmer answer must not lower it");
  await createMessage(db, conv, a, "assistant", { careLevel: "emergency" });
  assert.equal(await level(), "emergency");
  await createMessage(db, conv, a, "assistant", { careLevel: "doctor" });
  assert.equal(await level(), "emergency");
});

// ---------------------------------------------------------------------------
test("summaries: own only, and cannot attach to someone else's conversation", async () => {
  const a = await createUser(db);
  const b = await createUser(db);
  const convA = await createConversation(db, a);

  const own = await asUser(db, a, (d) =>
    d.query("insert into public.summaries (conversation_id, title, content) values ($1, 'Visit', '{\"why\":\"headache\"}') returning user_id", [convA]));
  assert.equal(own.rows[0].user_id, a);

  await rejects(asUser(db, b, (d) =>
    d.query("insert into public.summaries (conversation_id, title, content) values ($1, 'x', '{}')", [convA])),
    /row-level security/i);
  await rejects(asUser(db, a, (d) =>
    d.query("insert into public.summaries (user_id, content) values ($1, '{}')", [b])),
    /permission denied/i);
  await rejects(asUser(db, a, (d) =>
    d.query("insert into public.summaries (title, content) values ('bad', '[1,2]')")),
    /check constraint/i);

  await db.query("insert into public.summaries (user_id, title, content) values ($1, 'B summary', '{}')", [b]);
  const seen = await asUser(db, a, (d) => d.query("select user_id from public.summaries"));
  assert.ok(seen.rows.every((row) => row.user_id === a));
});

// ---------------------------------------------------------------------------
test("feedback: only on your own assistant answers, one rating each", async () => {
  const a = await createUser(db);
  const b = await createUser(db);
  const conv = await createConversation(db, a);
  const question = await createMessage(db, conv, a, "user");
  const answer = await createMessage(db, conv, a, "assistant");

  const good = await asUser(db, a, (d) =>
    d.query("insert into public.feedback (message_id, rating, reason) values ($1, -1, 'too_scary') returning user_id", [answer]));
  assert.equal(good.rows[0].user_id, a);

  await rejects(asUser(db, b, (d) =>
    d.query("insert into public.feedback (message_id, rating) values ($1, 1)", [answer])), /row-level security/i);
  await rejects(asUser(db, a, (d) =>
    d.query("insert into public.feedback (message_id, rating) values ($1, 1)", [question])), /row-level security/i);
  await rejects(asUser(db, a, async (d) => {
    await d.query("insert into public.feedback (message_id, rating) values ($1, 1)", [answer]);
    await d.query("insert into public.feedback (message_id, rating) values ($1, -1)", [answer]);
  }), /duplicate key/i);
});

// ---------------------------------------------------------------------------
test("health profile: members only, guests are shut out", async () => {
  const member = await createUser(db);
  const guest = await createUser(db, { anonymous: true });

  const saved = await asUser(db, member, (d) =>
    d.query("insert into public.health_profile (user_id, age_range, allergies) values ($1, '25-34', array['penicillin']) returning user_id", [member]));
  assert.equal(saved.rows.length, 1);

  await rejects(asGuest(db, guest, (d) =>
    d.query("insert into public.health_profile (user_id, age_range) values ($1, '25-34')", [guest])),
    /row-level security/i);

  // The insert above was rolled back, so store real rows for both to test reading.
  // A guest who already has a row (for example after a bug during an upgrade) still cannot read it.
  await db.query("insert into public.health_profile (user_id, age_range) values ($1, '25-34')", [member]);
  await db.query("insert into public.health_profile (user_id, age_range) values ($1, '25-34')", [guest]);
  assert.equal((await asGuest(db, guest, (d) => d.query("select * from public.health_profile"))).rows.length, 0);
  assert.equal((await asUser(db, member, (d) => d.query("select * from public.health_profile"))).rows.length, 1);
});

// ---------------------------------------------------------------------------
test("feature flags: readable when signed in, never writable, hidden from anon", async () => {
  const user = await createUser(db);
  const flags = await asUser(db, user, (d) => d.query("select key, value from public.feature_flags"));
  assert.ok(flags.rows.some((row) => row.key === "care_level_display"));
  await rejects(asUser(db, user, (d) => d.query("update public.feature_flags set value = 'false'")), /permission denied/i);
  await rejects(asUser(db, user, (d) => d.query("insert into public.feature_flags (key, value) values ('x', '1')")), /permission denied/i);
  await rejects(asAnon(db, (d) => d.query("select * from public.feature_flags")), /permission denied/i);
});

test("server-only tables are invisible to the browser but writable by the service role", async () => {
  const user = await createUser(db);
  for (const table of ["source_cache", "usage_daily", "rule_events"]) {
    await rejects(asUser(db, user, (d) => d.query(`select * from public.${table}`)), /permission denied/i);
    await rejects(asUser(db, user, (d) => d.query(`delete from public.${table}`)), /permission denied/i);
  }
  const event = await asService(db, (d) =>
    d.query("insert into public.rule_events (user_id, rule_ids, level) values ($1, array['chest-pain'], 'ambulance') returning id", [user]));
  assert.equal(event.rows.length, 1);
  const cached = await asService(db, (d) =>
    d.query("insert into public.source_cache (key, source, payload, expires_at) values ('k', 'medlineplus', '{}', now() + interval '1 day') returning key"));
  assert.equal(cached.rows.length, 1);
});

// ---------------------------------------------------------------------------
test("quota: counts atomically, enforces the limit, only the service role may call it", async () => {
  const user = await createUser(db);
  const rows = await asService(db, async (d) => {
    const out = [];
    for (let i = 0; i < 4; i++) out.push((await d.query("select * from public.consume_quota($1, 3)", [user])).rows[0]);
    return out;
  });
  assert.deepEqual(rows.map((r) => [r.allowed, r.used, r.remaining]), [[true, 1, 2], [true, 2, 1], [true, 3, 0], [false, 4, 0]]);

  await rejects(asUser(db, user, (d) => d.query("select * from public.consume_quota($1, 3)", [user])), /permission denied/i);
  await rejects(asGuest(db, user, (d) => d.query("select * from public.consume_quota($1, 3)", [user])), /permission denied/i);
  await rejects(asAnon(db, (d) => d.query("select * from public.consume_quota($1, 3)", [user])), /permission denied/i);
});

test("quota: a new day starts from one, and token counts add up", async () => {
  const user = await createUser(db);
  await db.query("insert into public.usage_daily (user_id, day, messages) values ($1, current_date - 1, 99)", [user]);
  const result = await asService(db, async (d) => {
    const first = (await d.query("select * from public.consume_quota($1, 5)", [user])).rows[0];
    await d.query("select public.add_usage_tokens($1, 100, 50)", [user]);
    await d.query("select public.add_usage_tokens($1, 20, 5)", [user]);
    const totals = (await d.query(
      "select messages, tokens_in::int as tin, tokens_out::int as tout from public.usage_daily where user_id = $1 and day <> current_date - 1 order by day desc limit 1", [user])).rows[0];
    return { first, totals };
  });
  assert.equal(result.first.used, 1);
  assert.deepEqual([result.totals.messages, result.totals.tin, result.totals.tout], [1, 120, 55]);
});

// ---------------------------------------------------------------------------
test("clean-up: stale guests are removed with all their data, members and recent guests are kept", async () => {
  const oldGuest = await createUser(db, { anonymous: true, lastSignInAt: daysAgo(40), createdAt: daysAgo(41) });
  const recentGuest = await createUser(db, { anonymous: true, lastSignInAt: daysAgo(2) });
  const oldMember = await createUser(db, { email: "old@example.com", lastSignInAt: daysAgo(400) });
  const conv = await createConversation(db, oldGuest);
  await createMessage(db, conv, oldGuest, "user");

  const purged = await asService(db, (d) => d.query("select public.purge_stale_guests(30) as n", []), true);
  assert.equal(purged.rows[0].n, 1);

  const left = (await db.query("select id from auth.users where id = any($1)", [[oldGuest, recentGuest, oldMember]])).rows.map((r) => r.id).sort();
  assert.deepEqual(left, [recentGuest, oldMember].sort());
  assert.equal((await db.query("select count(*)::int as c from public.messages where user_id = $1", [oldGuest])).rows[0].c, 0);
  assert.equal((await db.query("select count(*)::int as c from public.profiles where id = $1", [oldGuest])).rows[0].c, 0);

  await rejects(asUser(db, recentGuest, (d) => d.query("select public.purge_stale_guests(0)")), /permission denied/i);
});

test("clean-up: expired cache and old rule events go, fresh ones stay", async () => {
  await db.query("insert into public.source_cache (key, source, payload, expires_at) values ('old', 'openfda', '{}', now() - interval '1 hour'), ('fresh', 'openfda', '{}', now() + interval '1 hour')");
  await db.query("insert into public.rule_events (rule_ids, level, created_at) values (array['seizure'], 'ambulance', now() - interval '100 days'), (array['stroke'], 'ambulance', now())");
  const result = await asService(db, async (d) => ({
    cache: (await d.query("select public.purge_expired_cache() as n")).rows[0].n,
    events: (await d.query("select public.purge_old_rule_events(90) as n")).rows[0].n,
  }), true);
  assert.ok(result.cache >= 1 && result.events >= 1);
  assert.equal((await db.query("select count(*)::int as c from public.source_cache where key = 'old'")).rows[0].c, 0);
  assert.equal((await db.query("select count(*)::int as c from public.source_cache where key = 'fresh'")).rows[0].c, 1);
});

// ---------------------------------------------------------------------------
test("deleting an account removes all its data and unlinks, but keeps, anonymous rule events", async () => {
  const user = await createUser(db, { email: "gone@example.com" });
  const conv = await createConversation(db, user);
  const answer = await createMessage(db, conv, user, "assistant", { careLevel: "emergency" });
  await db.query("insert into public.summaries (user_id, content) values ($1, '{}')", [user]);
  await db.query("insert into public.consents (user_id, doc_type, version) values ($1, 'terms', 'v1')", [user]);
  await db.query("insert into public.feedback (user_id, message_id, rating) values ($1, $2, 1)", [user, answer]);
  await db.query("insert into public.health_profile (user_id) values ($1)", [user]);
  await db.query("insert into public.lab_results (user_id, marker, value, unit) values ($1, 'vitamin_d', 14, 'ng/mL')", [user]);
  await db.query("insert into public.health_log (user_id, feeling) values ($1, 'better')", [user]);
  const schedule = (await db.query("insert into public.medicine_schedule (user_id, medicine, slots) values ($1, 'Amlodipine', '{morning}') returning id", [user])).rows[0].id;
  await db.query("insert into public.dose_log (user_id, schedule_id, slot, taken_on) values ($1, $2, 'morning', current_date)", [user, schedule]);
  await db.query("insert into public.usage_daily (user_id, day, messages) values ($1, current_date, 3)", [user]);
  await db.query("insert into public.rule_events (user_id, rule_ids, level) values ($1, array['chest-pain'], 'ambulance')", [user]);

  await db.query("delete from auth.users where id = $1", [user]);

  for (const [table, column] of [["profiles", "id"], ["health_profile", "user_id"], ["lab_results", "user_id"], ["health_log", "user_id"], ["medicine_schedule", "user_id"], ["dose_log", "user_id"], ["consents", "user_id"],
    ["conversations", "user_id"], ["messages", "user_id"], ["summaries", "user_id"], ["feedback", "user_id"], ["usage_daily", "user_id"]]) {
    const count = (await db.query(`select count(*)::int as c from public.${table} where ${column} = $1`, [user])).rows[0].c;
    assert.equal(count, 0, `${table} should be empty after account deletion`);
  }
  const events = (await db.query("select user_id from public.rule_events where rule_ids = array['chest-pain'] order by id desc limit 1")).rows[0];
  assert.equal(events.user_id, null, "the rule event stays, but no longer points at a person");
});

// ---------------------------------------------------------------------------
// Chat support (migration 20261019040300)
// ---------------------------------------------------------------------------
test("an answer points at its question: one answer per question, removed with it", async () => {
  const a = await createUser(db);
  const conv = await createConversation(db, a);
  const question = await createMessage(db, conv, a, "user", { clientMessageId: "33333333-3333-4333-8333-333333333333" });
  const insertAnswer = () =>
    db.query(
      "insert into public.messages (conversation_id, user_id, role, content, reply_to) values ($1, $2, 'assistant', 'answer', $3) returning id",
      [conv, a, question]
    );
  const first = (await insertAnswer()).rows[0].id;
  await rejects(insertAnswer(), /duplicate key/i);

  assert.deepEqual((await asUser(db, a, (d) => d.query("select reply_to from public.messages where id = $1", [first]))).rows[0].reply_to, question);
  // The browser still cannot write messages, and deleting the question removes its answer.
  await rejects(asUser(db, a, (d) => d.query("update public.messages set reply_to = null where id = $1", [first])), /permission denied/i);
  // People can't delete single messages any more (security review 2026-10-20); the server's cascade still applies.
  await db.query("delete from public.messages where id = $1", [question]);
  assert.equal((await db.query("select 1 from public.messages where id = $1", [first])).rows.length, 0);
});

test("usage_totals_today: sums today across people, for the service role only", async () => {
  const a = await createUser(db);
  const b = await createUser(db);
  const before = (await asService(db, (d) => d.query("select * from public.usage_totals_today()"))).rows[0];
  await asService(db, async (d) => {
    await d.query("select public.consume_quota($1, 10)", [a]);
    await d.query("select public.consume_quota($1, 10)", [b]);
    await d.query("select public.add_usage_tokens($1, 100, 40)", [a]);
    await d.query("select public.add_usage_tokens($1, 10, 5)", [b]);
  }, true);
  const after = (await asService(db, (d) => d.query("select * from public.usage_totals_today()"))).rows[0];
  assert.deepEqual(
    [Number(after.messages) - Number(before.messages), Number(after.tokens_in) - Number(before.tokens_in), Number(after.tokens_out) - Number(before.tokens_out)],
    [2, 110, 45]
  );
  await rejects(asUser(db, a, (d) => d.query("select * from public.usage_totals_today()")), /permission denied/i);
  await rejects(asAnon(db, (d) => d.query("select * from public.usage_totals_today()")), /permission denied/i);
});

// ---------------------------------------------------------------------------
// Personalization (migration 20261019050000)
// ---------------------------------------------------------------------------
test("blood results: members only, each person sees only their own, guests are shut out", async () => {
  const member = await createUser(db);
  const other = await createUser(db);
  const guest = await createUser(db, { anonymous: true });

  const saved = await asUser(db, member, (d) =>
    d.query("insert into public.lab_results (marker, value, unit, test_date) values ('vitamin_d', 14, 'ng/mL', current_date) returning user_id"));
  assert.equal(saved.rows[0].user_id, member, "the owner defaults to the signed-in person");

  await rejects(asGuest(db, guest, (d) => d.query("insert into public.lab_results (marker, value, unit) values ('hba1c', 6.1, '%')")), /row-level security/i);
  await rejects(asUser(db, member, (d) => d.query("insert into public.lab_results (user_id, marker, value, unit) values ($1, 'hba1c', 6.1, '%')", [other])), /row-level security/i);

  await db.query("insert into public.lab_results (user_id, marker, value, unit) values ($1, 'tsh', 2.1, 'mIU/L')", [member]);
  await db.query("insert into public.lab_results (user_id, marker, value, unit) values ($1, 'tsh', 2.1, 'mIU/L')", [other]);
  await db.query("insert into public.lab_results (user_id, marker, value, unit) values ($1, 'tsh', 2.1, 'mIU/L')", [guest]);
  assert.equal((await asUser(db, member, (d) => d.query("select * from public.lab_results"))).rows.length, 1);
  assert.equal((await asGuest(db, guest, (d) => d.query("select * from public.lab_results"))).rows.length, 0);
  await rejects(asAnon(db, (d) => d.query("select * from public.lab_results")), /permission denied/i);
});

test("blood results: values are checked (other needs a name, no negatives, sane dates)", async () => {
  const member = await createUser(db);
  const insert = (sql) => asUser(db, member, (d) => d.query(sql));
  await rejects(insert("insert into public.lab_results (marker, value, unit) values ('other', 5, 'mg/dL')"), /check/i);
  await rejects(insert("insert into public.lab_results (marker, value, unit) values ('vitamin_d', -1, 'ng/mL')"), /check/i);
  await rejects(insert("insert into public.lab_results (marker, value, unit, test_date) values ('vitamin_d', 20, 'ng/mL', current_date + 30)"), /check/i);
  await rejects(insert("insert into public.lab_results (marker, value, unit) values ('Vitamin D!', 20, 'ng/mL')"), /check/i);
  const ok = await insert("insert into public.lab_results (marker, label, value, unit) values ('other', 'Homocysteine', 12, 'µmol/L') returning id");
  assert.equal(ok.rows.length, 1);
});

test("health profile: the new personal fields are optional and checked", async () => {
  const member = await createUser(db);
  // Each asUser call is rolled back, so the row the updates below need is stored first.
  await db.query("insert into public.health_profile (user_id) values ($1)", [member]);
  const row = await asUser(db, member, (d) =>
    d.query("update public.health_profile set height_cm = 175, weight_kg = 72.5, smoking = 'never', alcohol = 'occasional', activity = 'moderate', family_history = array['Diabetes'] where user_id = $1 returning height_cm, family_history", [member]));
  assert.equal(Number(row.rows[0].height_cm), 175);
  assert.deepEqual(row.rows[0].family_history, ["Diabetes"]);
  await rejects(asUser(db, member, (d) => d.query("update public.health_profile set smoking = 'sometimes' where user_id = $1", [member])), /check/i);
  await rejects(asUser(db, member, (d) => d.query("update public.health_profile set height_cm = 400 where user_id = $1", [member])), /check/i);
});

// ---------------------------------------------------------------------------
// Continuity of care (migration 20261019060000)
// ---------------------------------------------------------------------------
test("health diary: members only, own entries only, a check-in can only point at the person's own chat", async () => {
  const member = await createUser(db);
  const other = await createUser(db);
  const guest = await createUser(db, { anonymous: true });
  const mine = await createConversation(db, member, "Fever");
  const theirs = await createConversation(db, other, "Cough");

  const saved = await asUser(db, member, (d) =>
    d.query("insert into public.health_log (symptom, severity, temperature_c, feeling, conversation_id) values ('Fever', 6, 38.2, 'worse', $1) returning user_id", [mine]));
  assert.equal(saved.rows[0].user_id, member);
  await rejects(asUser(db, member, (d) => d.query("insert into public.health_log (feeling, conversation_id) values ('better', $1)", [theirs])), /row-level security/i);
  await rejects(asGuest(db, guest, (d) => d.query("insert into public.health_log (feeling) values ('better')")), /row-level security/i);

  await db.query("insert into public.health_log (user_id, feeling) values ($1, 'same')", [member]);
  await db.query("insert into public.health_log (user_id, feeling) values ($1, 'same')", [other]);
  assert.equal((await asUser(db, member, (d) => d.query("select * from public.health_log"))).rows.length, 1);
  await rejects(asAnon(db, (d) => d.query("select * from public.health_log")), /permission denied/i);
});

test("health diary: entries are checked, and a deleted chat leaves its check-ins in place", async () => {
  const member = await createUser(db);
  const insert = (sql, args = []) => asUser(db, member, (d) => d.query(sql, args));
  await rejects(insert("insert into public.health_log (user_id) values ($1)", [member]), /check/i);
  await rejects(insert("insert into public.health_log (temperature_c) values (45)"), /check/i);
  await rejects(insert("insert into public.health_log (severity) values (11)"), /check/i);
  await rejects(insert("insert into public.health_log (feeling) values ('great')"), /check/i);

  const conv = await createConversation(db, member, "Fever");
  await db.query("insert into public.health_log (user_id, feeling, conversation_id) values ($1, 'better', $2)", [member, conv]);
  await db.query("delete from public.conversations where id = $1", [conv]);
  const left = (await db.query("select conversation_id from public.health_log where user_id = $1", [member])).rows;
  assert.deepEqual(left, [{ conversation_id: null }]);
});

test("readings: blood pressure, pulse, sugar and weight are checked, and a reading alone is an entry", async () => {
  const member = await createUser(db);
  const insert = (sql, args = []) => asUser(db, member, (d) => d.query(sql, args));
  const ok = await insert("insert into public.health_log (bp_systolic, bp_diastolic, pulse) values (138, 88, 76) returning bp_systolic, bp_diastolic, pulse");
  assert.deepEqual(ok.rows[0], { bp_systolic: 138, bp_diastolic: 88, pulse: 76 });
  await insert("insert into public.health_log (glucose_mgdl, glucose_timing) values (112, 'fasting')");
  await insert("insert into public.health_log (weight_kg) values (72.4)");
  await insert("insert into public.health_log (pulse) values (64)");
  await rejects(insert("insert into public.health_log (bp_systolic) values (130)"), /check/i, "both numbers or neither");
  await rejects(insert("insert into public.health_log (bp_systolic, bp_diastolic) values (80, 120)"), /check/i, "the top number is higher");
  await rejects(insert("insert into public.health_log (bp_systolic, bp_diastolic) values (400, 90)"), /check/i);
  await rejects(insert("insert into public.health_log (glucose_mgdl) values (5)"), /check/i, "mmol/L typed as mg/dL");
  await rejects(insert("insert into public.health_log (glucose_timing) values ('fasting')"), /check/i, "a timing needs a reading");
  await rejects(insert("insert into public.health_log (glucose_mgdl, glucose_timing) values (100, 'tea time')"), /check/i);
  await rejects(insert("insert into public.health_log (weight_kg) values (0.5)"), /check/i);
  await rejects(insert("insert into public.health_log (user_id) values ($1)", [member]), /check/i, "still has to say something");
  const guest = await createUser(db, { anonymous: true });
  await rejects(asGuest(db, guest, (d) => d.query("insert into public.health_log (weight_kg) values (70)")), /row-level security/i);
});

test("emergency card: blood group and a contact are checked", async () => {
  const member = await createUser(db);
  await db.query("insert into public.health_profile (user_id) values ($1)", [member]);
  const ok = await asUser(db, member, (d) =>
    d.query("update public.health_profile set blood_group = 'O+', emergency_contact_name = 'Mum', emergency_contact_phone = '+91 98765 43210' where user_id = $1 returning blood_group", [member]));
  assert.equal(ok.rows[0].blood_group, "O+");
  await rejects(asUser(db, member, (d) => d.query("update public.health_profile set blood_group = 'Z' where user_id = $1", [member])), /check/i);
  await rejects(asUser(db, member, (d) => d.query("update public.health_profile set emergency_contact_phone = 'call me' where user_id = $1", [member])), /check/i);
});

// ---------------------------------------------------------------------------
// Medicines today (migration 20261019080000)
// ---------------------------------------------------------------------------
const addSchedule = async (userId, medicine = "Amlodipine", slots = "{morning}", pills = null) =>
  (await db.query("insert into public.medicine_schedule (user_id, medicine, slots, pills_left) values ($1, $2, $3, $4) returning id", [userId, medicine, slots, pills])).rows[0].id;

test("medicines: members only, own rows only, a tick can only point at the person's own medicine", async () => {
  const member = await createUser(db);
  const other = await createUser(db);
  const guest = await createUser(db, { anonymous: true });

  const saved = await asUser(db, member, (d) =>
    d.query("insert into public.medicine_schedule (medicine, slots) values ('Metformin', '{morning,night}') returning user_id"));
  assert.equal(saved.rows[0].user_id, member, "user_id comes from the token");
  await rejects(asGuest(db, guest, (d) => d.query("insert into public.medicine_schedule (medicine, slots) values ('Metformin', '{morning}')")), /row-level security/i);
  await rejects(asUser(db, member, (d) => d.query("insert into public.medicine_schedule (user_id, medicine, slots) values ($1, 'X', '{morning}')", [other])), /row-level security/i);

  const mine = await addSchedule(member);
  const theirs = await addSchedule(other);
  assert.deepEqual((await asUser(db, member, (d) => d.query("select id from public.medicine_schedule"))).rows.map((row) => row.id), [mine]);
  const tick = await asUser(db, member, (d) => d.query("insert into public.dose_log (schedule_id, slot, taken_on) values ($1, 'morning', current_date) returning user_id", [mine]));
  assert.equal(tick.rows[0].user_id, member);
  await rejects(asUser(db, member, (d) => d.query("insert into public.dose_log (schedule_id, slot, taken_on) values ($1, 'morning', current_date)", [theirs])), /row-level security/i);
  await rejects(asGuest(db, guest, (d) => d.query("insert into public.dose_log (schedule_id, slot, taken_on) values ($1, 'morning', current_date)", [mine])), /row-level security/i);

  await db.query("insert into public.dose_log (user_id, schedule_id, slot, taken_on) values ($1, $2, 'morning', current_date)", [other, theirs]);
  assert.equal((await asUser(db, member, (d) => d.query("select * from public.dose_log"))).rows.length, 0);
  const removed = await asUser(db, member, (d) => d.query("delete from public.medicine_schedule where id = $1 returning id", [theirs]));
  assert.equal(removed.rows.length, 0, "must not be able to remove someone else's medicine");
  await rejects(asAnon(db, (d) => d.query("select * from public.medicine_schedule")), /permission denied/i);
  await rejects(asAnon(db, (d) => d.query("select * from public.dose_log")), /permission denied/i);
});

test("medicines: times and ticks are checked, one tick per medicine, time and day, never edited", async () => {
  const member = await createUser(db);
  const insert = (sql, args = []) => asUser(db, member, (d) => d.query(sql, args));
  await rejects(insert("insert into public.medicine_schedule (medicine, slots) values ('A', '{}')"), /check/i, "at least one time");
  await rejects(insert("insert into public.medicine_schedule (medicine, slots) values ('A', '{lunch}')"), /check/i);
  await rejects(insert("insert into public.medicine_schedule (medicine, slots, pills_left) values ('A', '{night}', -1)"), /check/i);
  await rejects(insert("insert into public.medicine_schedule (medicine, slots, times_set_at) values ('A', '{night}', now() - interval '30 days')"), /permission denied/i, "the stamps are the database's own");

  const schedule = await addSchedule(member, "Amlodipine");
  await rejects(insert("insert into public.medicine_schedule (medicine, slots) values ('amlodipine', '{night}')"), /duplicate key/i, "one row per medicine, ignoring case");
  await rejects(insert("insert into public.dose_log (schedule_id, slot, taken_on) values ($1, 'lunch', current_date)", [schedule]), /check/i);
  await rejects(insert("insert into public.dose_log (schedule_id, slot, taken_on) values ($1, 'morning', current_date + 5)", [schedule]), /check/i);
  await rejects(insert("insert into public.dose_log (schedule_id, slot, taken_on, created_at) values ($1, 'morning', current_date, now() - interval '1 day')", [schedule]), /permission denied/i);
  await rejects(asUser(db, member, async (d) => {
    await d.query("insert into public.dose_log (schedule_id, slot, taken_on) values ($1, 'morning', current_date)", [schedule]);
    await d.query("insert into public.dose_log (schedule_id, slot, taken_on) values ($1, 'morning', current_date)", [schedule]);
  }), /duplicate key/i);
  const again = await asUser(db, member, async (d) => {
    await d.query("insert into public.dose_log (schedule_id, slot, taken_on) values ($1, 'morning', current_date)", [schedule]);
    return d.query("insert into public.dose_log (schedule_id, slot, taken_on) values ($1, 'morning', current_date) on conflict (schedule_id, slot, taken_on) do nothing returning id", [schedule]);
  });
  assert.equal(again.rows.length, 0, "\"Log all\" can send a tick that is already there");
  await db.query("insert into public.dose_log (user_id, schedule_id, slot, taken_on) values ($1, $2, 'morning', current_date)", [member, schedule]);
  await rejects(insert("update public.dose_log set taken_on = current_date - 1"), /permission denied/i);

  // Removing a medicine removes its ticks.
  await db.query("delete from public.medicine_schedule where id = $1", [schedule]);
  assert.equal((await db.query("select count(*)::int as c from public.dose_log where schedule_id = $1", [schedule])).rows[0].c, 0);
});

test("medicines: a tick counts a pill down, undoing it puts it back, and the database keeps the stamps", async () => {
  const member = await createUser(db);
  const schedule = await addSchedule(member, "Metformin", "{morning,night}", 10);
  await db.query("update public.medicine_schedule set times_set_at = now() - interval '9 days', pills_counted_at = now() - interval '1 day' where id = $1", [schedule]);
  const row = (d) => d.query("select pills_left, times_set_at < now() - interval '8 days' as times_old, pills_counted_at < now() - interval '20 hours' as count_old from public.medicine_schedule where id = $1", [schedule]).then((result) => result.rows[0]);

  await asUser(db, member, async (d) => {
    await d.query("insert into public.dose_log (schedule_id, slot, taken_on) values ($1, 'morning', current_date)", [schedule]);
    assert.deepEqual(await row(d), { pills_left: 9, times_old: true, count_old: true }, "a tick is not a new count");
    await d.query("insert into public.dose_log (schedule_id, slot, taken_on) values ($1, 'night', current_date) on conflict do nothing", [schedule]);
    assert.equal((await row(d)).pills_left, 8);
    await d.query("delete from public.dose_log where schedule_id = $1 and slot = 'night'", [schedule]);
    assert.equal((await row(d)).pills_left, 9, "undo puts the pill back");
    await d.query("update public.medicine_schedule set slots = '{morning}' where id = $1", [schedule]);
    assert.equal((await row(d)).times_old, false, "new times are stamped");
    await d.query("update public.medicine_schedule set pills_left = 30 where id = $1", [schedule]);
    assert.equal((await row(d)).count_old, false, "a typed count is stamped");
  });

  // A tick from before the last count doesn't put a pill back when undone.
  await db.query("insert into public.dose_log (user_id, schedule_id, slot, taken_on, created_at) values ($1, $2, 'morning', current_date - 2, now() - interval '2 days')", [member, schedule]);
  await asUser(db, member, async (d) => {
    assert.equal((await row(d)).pills_left, 9);
    await d.query("delete from public.dose_log where schedule_id = $1", [schedule]);
    assert.equal((await row(d)).pills_left, 9, "counted again since: the pill stays counted");
  });
  const none = await addSchedule(member, "Vitamin D", "{morning}");
  await asUser(db, member, async (d) => {
    await d.query("insert into public.dose_log (schedule_id, slot, taken_on) values ($1, 'morning', current_date)", [none]);
    const left = await d.query("select pills_left from public.medicine_schedule where id = $1", [none]);
    assert.equal(left.rows[0].pills_left, null, "no count, nothing counted down");
  });
});

test("medicines: at most 50 per person, ticks capped, and ticks older than about 13 months cleared", async () => {
  const member = await createUser(db);
  await db.query("insert into public.medicine_schedule (user_id, medicine, slots) select $1, 'Medicine ' || n, '{morning}' from generate_series(1, 50) n", [member]);
  await rejects(asUser(db, member, (d) => d.query("insert into public.medicine_schedule (medicine, slots) values ('One more', '{night}')")), /too many medicines/i);

  const first = (await db.query("select id from public.medicine_schedule where user_id = $1 and medicine = 'Medicine 1'", [member])).rows[0].id;
  // Planted without triggers: the cap trigger (after insert since 2026-10-20) would prune it at once.
  await db.exec("begin; set local session_replication_role = replica;");
  await db.query("insert into public.dose_log (user_id, schedule_id, slot, taken_on) values ($1, $2, 'morning', current_date - 500)", [member, first]);
  await db.exec("commit");
  await asUser(db, member, async (d) => {
    await d.query("insert into public.dose_log (schedule_id, slot, taken_on) values ($1, 'morning', current_date)", [first]);
    const days = await d.query("select (current_date - taken_on) as age from public.dose_log where schedule_id = $1", [first]);
    assert.deepEqual(days.rows.map((r) => r.age), [0], "the 500-day-old tick is cleared");
  });

  // Fill to the cap without firing triggers (fast), then one more tick is refused.
  await db.exec("begin; set local session_replication_role = replica;");
  await db.query(`insert into public.dose_log (user_id, schedule_id, slot, taken_on)
    select $1, s.id, slot, current_date - d from public.medicine_schedule s, unnest(array['morning','afternoon','evening','night']) slot, generate_series(1, 100) d
    where s.user_id = $1`, [member]);
  await db.exec("commit");
  assert.equal((await db.query("select count(*)::int as c from public.dose_log where user_id = $1", [member])).rows[0].c, 20001);
  await rejects(asUser(db, member, (d) => d.query("insert into public.dose_log (schedule_id, slot, taken_on) values ($1, 'night', current_date)", [first])), /too many medicine ticks/i);
});

test("thali: members only, own meals only, one row per meal per day, items and water checked", async () => {
  const member = await createUser(db);
  const other = await createUser(db);
  const guest = await createUser(db, { anonymous: true });
  const insert = (sql, args = []) => asUser(db, member, (d) => d.query(sql, args));

  const saved = await insert("insert into public.food_log (day, meal, items, portion, outside) values (current_date, 'lunch', array['Dal', 'Rice', 'Salad'], 'regular', true) returning user_id, items");
  assert.equal(saved.rows[0].user_id, member);
  assert.deepEqual(saved.rows[0].items, ["Dal", "Rice", "Salad"]);
  await insert("insert into public.food_log (day, meal, note) values (current_date, 'snacks', 'A few biscuits')");
  // Each asUser() call is rolled back, so the meal that must already exist is stored directly.
  await db.query("insert into public.food_log (user_id, day, meal, items) values ($1, current_date, 'lunch', array['Dal'])", [member]);
  await rejects(insert("insert into public.food_log (day, meal, items) values (current_date, 'lunch', array['Roti'])"), /duplicate key|unique/i, "one row per meal per day");
  const updated = await insert("insert into public.food_log (day, meal, items) values (current_date, 'lunch', array['Roti']) on conflict (user_id, day, meal) do update set items = excluded.items returning items");
  assert.deepEqual(updated.rows[0].items, ["Roti"], "editing a meal replaces it");

  await rejects(insert("insert into public.food_log (day, meal) values (current_date, 'dinner')"), /check/i, "says what was eaten");
  await rejects(insert("insert into public.food_log (day, meal, items) values (current_date, 'brunch', array['Poha'])"), /check/i);
  await rejects(insert("insert into public.food_log (day, meal, items) values (current_date, 'dinner', array[''])"), /check/i, "no empty items");
  await rejects(insert("insert into public.food_log (day, meal, items) values (current_date, 'dinner', array[repeat('x', 61)])"), /check/i, "items up to 60 characters");
  await rejects(insert("insert into public.food_log (day, meal, items, portion) values (current_date, 'dinner', array['Dal'], 'huge')"), /check/i);
  await rejects(insert("insert into public.food_log (day, meal, items) values (current_date + 5, 'dinner', array['Dal'])"), /check/i, "never in the future");

  await insert("insert into public.water_log (day, glasses) values (current_date, 6)");
  await rejects(insert("insert into public.water_log (day, glasses) values (current_date - 1, 31)"), /check/i);

  await db.query("insert into public.food_log (user_id, day, meal, items) values ($1, current_date, 'dinner', array['Fish'])", [other]);
  assert.equal((await asUser(db, member, (d) => d.query("select * from public.food_log"))).rows.length, 1, "only their own meals (the stored lunch)");
  await rejects(asGuest(db, guest, (d) => d.query("insert into public.food_log (day, meal, items) values (current_date, 'lunch', array['Dal'])")), /row-level security/i);
  await rejects(asGuest(db, guest, (d) => d.query("insert into public.water_log (day, glasses) values (current_date, 2)")), /row-level security/i);
  await rejects(asAnon(db, (d) => d.query("select * from public.food_log")), /permission denied/i);
});

test("security review 2026-10-20: sizes and caps hold, caps never run on someone else's id, new functions aren't public", async () => {
  const member = await createUser(db);
  const victim = await createUser(db);
  const as = (sql, args = []) => asUser(db, member, (d) => d.query(sql, args));
  await db.query("insert into public.health_profile (user_id) values ($1)", [member]);
  await rejects(as("update public.health_profile set conditions = array[repeat('x', 81)] where user_id = $1", [member]), /check/i, "profile items stay short");
  await as("update public.health_profile set conditions = array['Asthma'] where user_id = $1", [member]);
  await rejects(as("insert into public.summaries (title, content) values ('t', jsonb_build_object('x', repeat('y', 70000)))"), /check/i, "a summary is at most 64 KB");
  await rejects(as("insert into public.consents (doc_type, version) values ('terms', 'x y z <script>')"), /check/i, "a consent version is short and plain");
  // A row for someone else fails the row-level check first, so the cap can't tell how many rows they have.
  await rejects(as("insert into public.lab_results (user_id, marker, value, unit, test_date) values ($1, 'vitamin_d', 10, 'ng/mL', current_date)", [victim]), /row-level security/i);
  // Functions created from now on are not callable by anyone unless granted.
  await db.exec("create function public.zz_probe() returns integer language sql as $$ select 1 $$");
  const can = (await db.query("select has_function_privilege('anon', 'public.zz_probe()', 'execute') as anon, has_function_privilege('authenticated', 'public.zz_probe()', 'execute') as auth")).rows[0];
  assert.deepEqual(can, { anon: false, auth: false });
  await db.exec("drop function public.zz_probe()");
});

test("bug review 2026-10-20: today's AI total survives deleting an account; refunds; only empty chats are removed", async () => {
  const total = async () => (await db.query("select * from public.usage_totals_today()")).rows[0];
  const a = await createUser(db);
  const b = await createUser(db);
  const start = await total();
  await db.query("select public.consume_quota($1, 10)", [a]);
  await db.query("select public.add_usage_tokens($1, 1000, 500)", [a]);
  await db.query("delete from auth.users where id = $1", [a]);
  const after = await total();
  assert.equal(Number(after.tokens_in) - Number(start.tokens_in), 1000, "a deleted account's spending still counts today");
  assert.equal(Number(after.messages) - Number(start.messages), 1);

  await db.query("select public.consume_quota($1, 10)", [b]);
  await db.query("select public.release_quota($1)", [b]);
  assert.equal(Number((await db.query("select messages from public.usage_daily where user_id = $1", [b])).rows[0].messages), 0);
  assert.equal(Number((await total()).messages) - Number(start.messages), 1, "the refund comes off today's total too");

  const empty = await createConversation(db, b, null);
  const used = await createConversation(db, b, "Fever");
  await createMessage(db, used, b);
  const c = await createUser(db);
  const someoneElses = await createConversation(db, c, null);
  for (const id of [empty, used, someoneElses]) await db.query("select public.delete_empty_conversation($1, $2)", [b, id]);
  assert.deepEqual((await db.query("select id from public.conversations where user_id = $1", [b])).rows.map((r) => r.id), [used]);
  assert.equal((await db.query("select id from public.conversations where id = $1", [someoneElses])).rows.length, 1);

  for (const call of ["select public.release_quota($1)", "select public.delete_empty_conversation($1, $1)"]) {
    await rejects(asUser(db, b, (d) => d.query(call, [b])), /permission denied/i);
  }
  await rejects(asUser(db, b, (d) => d.query("select * from public.usage_global_daily")), /permission denied/i);
});

test("bug review 2026-10-20: renaming a chat keeps its time; a new message still moves it", async () => {
  const user = await createUser(db);
  const conv = await createConversation(db, user, "Fever");
  await db.query("update public.conversations set updated_at = now() - interval '6 months' where id = $1", [conv]);
  const time = async () => (await db.query("select updated_at from public.conversations where id = $1", [conv])).rows[0].updated_at.getTime();
  const old = await time();
  await db.query("update public.conversations set title = 'Back pain' where id = $1", [conv]);
  assert.equal(await time(), old, "a rename doesn't make an old chat look recent");
  await createMessage(db, conv, user);
  assert.ok((await time()) > old + 1000, "a new message does");
});

test("bug review 2026-10-20: undoing a tick made at 0 pills doesn't add a pill", async () => {
  const user = await createUser(db);
  const schedule = (await db.query("insert into public.medicine_schedule (user_id, medicine, slots, pills_left) values ($1, 'Metformin', '{morning,night}', 1) returning id", [user])).rows[0].id;
  const pills = async () => (await db.query("select pills_left from public.medicine_schedule where id = $1", [schedule])).rows[0].pills_left;
  const morning = (await db.query("insert into public.dose_log (user_id, schedule_id, slot, taken_on) values ($1, $2, 'morning', current_date) returning id", [user, schedule])).rows[0].id;
  assert.equal(await pills(), 0);
  const night = (await db.query("insert into public.dose_log (user_id, schedule_id, slot, taken_on) values ($1, $2, 'night', current_date) returning id", [user, schedule])).rows[0].id;
  assert.equal(await pills(), 0, "nothing left to take");
  await db.query("delete from public.dose_log where id = $1", [night]);
  assert.equal(await pills(), 0, "undoing the tick at 0 gives nothing back");
  await db.query("delete from public.dose_log where id = $1", [morning]);
  assert.equal(await pills(), 1, "undoing the tick that took a pill puts it back");
});

test("bug review 2026-10-20: blank list items are refused; old usage rows are cleared", async () => {
  const user = await createUser(db);
  await rejects(db.query("insert into public.food_log (user_id, day, meal, items) values ($1, current_date, 'lunch', array[null]::text[])", [user]), /check/i);
  await db.query("insert into public.health_profile (user_id) values ($1) on conflict do nothing", [user]);
  await rejects(db.query("update public.health_profile set conditions = array[null, 'x']::text[] where user_id = $1", [user]), /check/i);
  await db.query("insert into public.health_profile (user_id, conditions) values ($1, array['Asthma']) on conflict (user_id) do update set conditions = excluded.conditions", [user]);

  await db.query("insert into public.usage_daily (user_id, day, messages) values ($1, current_date - 500, 3), ($1, current_date - 10, 2)", [user]);
  await db.query("select public.purge_old_usage(400)");
  const days = (await db.query("select (current_date - day) as ago from public.usage_daily where user_id = $1", [user])).rows.map((r) => Number(r.ago));
  assert.deepEqual(days, [10]);
  await rejects(asUser(db, user, (d) => d.query("select public.purge_old_usage(1)")), /permission denied/i);
});
