// The doctor summary, account deletion and the health check.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanSummary, createSummaryHandler, plainSummary } from "../../functions/_shared/summary.ts";
import { createDeleteAccountHandler, createHealthHandler } from "../../functions/_shared/account.ts";
import { chatRequest, createMemoryRepo, goodAnswer, makeDeps, scriptedLlm, testConfig, USER_ID, uuid } from "./support.mjs";

const CONV = uuid(50);

async function seeded(over = {}) {
  const deps = makeDeps(over);
  await deps.repo.claimConversation(USER_ID, CONV, "en");
  deps.repo.state.conversations.get(CONV).title = "Headache";
  const add = (message) => deps.repo.state.messages.push({ conversation_id: CONV, user_id: USER_ID, created_at: "2026-10-17T18:30:00.000Z", ...message });
  add({ id: uuid(1), role: "user", content: "I have had a headache since Saturday. It started after a long drive. I took Crocin 500 mg and it helped for 3 hours." });
  add({ id: uuid(2), role: "assistant", content: "x", answer: goodAnswer({ questions_for_doctor: ["Could this be a migraine?", "Is it safe to keep taking paracetamol?"] }), created_at: "2026-10-17T18:31:00.000Z" });
  add({ id: uuid(3), role: "user", content: "No fever and no vomiting, but light hurts my eyes. My name is Asha.", created_at: "2026-10-18T18:30:00.000Z" });
  return deps;
}
const call = (handler, body, options) => handler(chatRequest(body, options));

const modelSummary = (over = {}) => ({
  title: "Headache for 3 days",
  reason_for_visit: "I have had a headache since Saturday, after a long drive.",
  timeline: [{ when: "Sat 17 Oct", what: "The headache started after a long drive." }, { when: "Sun 18 Oct", what: "Light hurts my eyes." }],
  details: [{ label: "Pain relief", value: "Crocin 500 mg helped for 3 hours" }],
  medicines_and_allergies: ["Crocin 500 mg, which helped for about 3 hours"],
  warning_signs: { present: ["Light hurts my eyes"], not_present: ["Fever", "Vomiting"] },
  questions: ["Could this be a migraine?"],
  ...over,
});

test("summary: built from the person's own words, with real details restored", async () => {
  const deps = await seeded({ llm: scriptedLlm({ reply: modelSummary({ reason_for_visit: "[NAME_1] has had a headache since Saturday." }) }) });
  const response = await call(createSummaryHandler(deps), { conversation_ids: [CONV] });
  assert.equal(response.status, 200);
  const { summary, degraded, prepared_at } = await response.json();
  assert.equal(degraded, false);
  assert.match(prepared_at, /^\d{4}-/);
  assert.equal(summary.reason_for_visit, "Asha has had a headache since Saturday.");
  assert.deepEqual(summary.warning_signs.not_present, ["Fever", "Vomiting"]);
  assert.deepEqual(summary.medicines_and_allergies, ["Crocin 500 mg, which helped for about 3 hours"], "an amount the person said themselves is kept");
  const sent = JSON.stringify(deps.llm.calls.complete[0].messages);
  assert.equal(sent.includes("Asha"), false, "the name never reaches the AI");
  assert.match(sent, /\[NAME_1\]/);
  assert.match(deps.llm.calls.complete[0].messages[0].content, /ONLY facts the person stated/);
  assert.equal(deps.repo.state.quotaCalls, 1);
});

test("summary: an amount the person never said is removed, so the AI cannot make up a dose", () => {
  const source = "I took Crocin 500 mg and it helped";
  const cleaned = cleanSummary(
    modelSummary({
      medicines_and_allergies: ["Crocin 500 mg", "Ibuprofen 400 mg twice a day"],
      details: [{ label: "Relief", value: "helped" }, { label: "Dose", value: "650 mg" }],
      timeline: [{ when: "Sat", what: "Took 1000 mg" }, { when: "Sun", what: "Felt better" }],
    }),
    source,
  );
  assert.deepEqual(cleaned.medicines_and_allergies, ["Crocin 500 mg"]);
  assert.deepEqual(cleaned.details, [{ label: "Relief", value: "helped" }]);
  assert.deepEqual(cleaned.timeline, [{ when: "Sun", what: "Felt better" }]);
  assert.equal(cleanSummary({ title: "x" }, source), null, "no reason for the visit, no summary");
});

test("summary: if the AI is off or fails, the person still gets their own words in order", async () => {
  const off = await seeded({ llm: null });
  const a = await (await call(createSummaryHandler(off), { conversation_ids: [CONV] })).json();
  assert.equal(a.degraded, true);
  assert.match(a.summary.reason_for_visit, /^I have had a headache since Saturday/);
  assert.equal(a.summary.timeline.length, 2);
  assert.equal(a.summary.timeline[0].when, "Sun, 18 Oct", "dates are in Indian time: 18:30 UTC is already the next day");
  assert.deepEqual(a.summary.questions, ["Could this be a migraine?", "Is it safe to keep taking paracetamol?"]);

  const broken = await seeded({ llm: scriptedLlm({ reply: "not json" }) });
  const b = await (await call(createSummaryHandler(broken), { conversation_ids: [CONV] })).json();
  assert.equal(b.degraded, true);
  assert.equal(plainSummary([{ id: CONV, title: "Headache" }], []).timeline.length, 0);
});

test("summary: only your own chats, between one and five, after consent", async () => {
  const deps = await seeded();
  const handler = createSummaryHandler(deps);
  assert.equal((await call(handler, { conversation_ids: [] })).status, 400);
  assert.equal((await call(handler, { conversation_ids: Array.from({ length: 6 }, (_, i) => uuid(60 + i)) })).status, 400);
  assert.equal((await call(handler, { conversation_ids: ["nope"] })).status, 400);
  assert.equal((await call(handler, { conversation_ids: [uuid(77)] })).status, 404, "someone else's or missing");
  assert.equal((await call(handler, { conversation_ids: [CONV] }, { token: "bad" })).status, 401);
  const noConsent = await seeded({ repo: createMemoryRepo({ consents: [] }) });
  const refused = await call(createSummaryHandler(noConsent), { conversation_ids: [CONV] });
  assert.equal(refused.status, 403);
  assert.equal((await refused.json()).error.code, "consent_required");
});

test("security: a summary keeps to today's AI budget and hides the saved name", async () => {
  // Today's tokens are spent: the plain version, no AI call and no question used.
  const spent = createMemoryRepo();
  spent.state.tokens.in = 900;
  spent.state.tokens.out = 200;
  const capped = await seeded({ repo: spent, llm: scriptedLlm({ reply: modelSummary() }), config: testConfig({ DAILY_TOKEN_CAP: "1000" }) });
  const body = await (await call(createSummaryHandler(capped), { conversation_ids: [CONV] })).json();
  assert.equal(body.degraded, true);
  assert.equal(capped.llm.calls.complete.length, 0);
  assert.equal(capped.repo.state.quotaCalls, 0);

  // The saved name never reaches the AI, even where the person wrote it without "my name is".
  const named = await seeded({ repo: createMemoryRepo({ profile: { display_name: "Ravi Kulkarni" } }), llm: scriptedLlm({ reply: modelSummary() }) });
  named.repo.state.messages.push({ id: uuid(4), conversation_id: CONV, user_id: USER_ID, role: "user", content: "Ravi here again, the Kulkarni family doctor is away.", created_at: "2026-10-19T08:00:00.000Z" });
  await call(createSummaryHandler(named), { conversation_ids: [CONV] });
  const sent = JSON.stringify(named.llm.calls.complete[0].messages);
  assert.equal(/Ravi|Kulkarni/.test(sent), false);
});

test("account deletion: needs a typed confirmation, deletes only the caller, answers 204", async () => {
  const deps = makeDeps();
  const handler = createDeleteAccountHandler(deps);
  assert.equal((await call(handler, {})).status, 400);
  assert.equal((await call(handler, { confirm: "delete" })).status, 400, "exactly DELETE");
  assert.equal((await call(handler, { confirm: "DELETE" }, { token: "bad" })).status, 401);
  assert.deepEqual(deps.repo.state.deleted, []);
  const done = await call(handler, { confirm: "DELETE" });
  assert.equal(done.status, 204);
  assert.deepEqual(deps.repo.state.deleted, [USER_ID]);
  assert.equal((await call(handler, { confirm: "DELETE" }, { method: "GET" })).status, 400);
});

test("health check: up or down, no user data, no AI call", async () => {
  const deps = makeDeps();
  const handler = createHealthHandler({ ...deps, llmConfigured: true });
  const ok = await handler(new Request("https://x.test/health", { headers: { origin: "http://localhost:3000" } }));
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.deepEqual(body.checks, { database: true, ai_configured: true, ai_enabled: true });
  assert.deepEqual(Object.keys(body).sort(), ["checks", "latency_ms", "ok", "time"]);
  deps.repo.state.pingFails = true;
  assert.equal((await handler(new Request("https://x.test/health"))).status, 503);
  assert.equal(deps.llm.calls.complete.length + deps.llm.calls.stream.length, 0);
});

test("bug review 2026-10-20: the dose check compares whole amounts, and checks the title and dates too", () => {
  const source = "I take amlodipine 25 mg and I took 11 tablets of something last week";
  const cleaned = cleanSummary(
    modelSummary({
      title: "Took 1000 mg paracetamol",
      reason_for_visit: "Blood pressure check.",
      medicines_and_allergies: ["Amlodipine 5 mg", "Amlodipine 25 mg"],
      details: [{ label: "Pills", value: "1 tablet" }],
      timeline: [{ when: "After 500 mg", what: "Felt dizzy" }, { when: "Sun", what: "Felt better" }],
    }),
    source,
  );
  assert.equal(cleaned.title, "Visit summary");
  assert.deepEqual(cleaned.medicines_and_allergies, ["Amlodipine 25 mg"]);
  assert.deepEqual(cleaned.details, []);
  assert.deepEqual(cleaned.timeline, [{ when: "Sun", what: "Felt better" }]);
});
