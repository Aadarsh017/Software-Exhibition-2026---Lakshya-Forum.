// A whole chat turn, end to end, with fake database, AI and internet.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createChatHandler } from "../../functions/_shared/chat.ts";
import { createRateLimiter } from "../../functions/_shared/rate.ts";
import { chatRequest, createMemoryRepo, eventsNamed, fakeFetch, fieldsOf, fixture, goodAnswer, makeDeps, readSse, scriptedLlm, standardInternet, testConfig, turnBody, USER_ID, uuid } from "./support.mjs";

async function run(deps, body, options) {
  const handler = createChatHandler(deps);
  const response = await handler(chatRequest(body, options));
  if (!response.headers.get("content-type")?.includes("event-stream")) return { response, events: [], json: await response.json().catch(() => null) };
  const events = await readSse(response);
  await Promise.all(deps.background);
  return { response, events, fields: fieldsOf(events) };
}
const names = (events) => events.map((e) => e.event);
const levelOf = (events) => fieldsOf(events).care_level;

test("a normal question: steps in order, answer field by field, saved, counted once", async () => {
  const deps = makeDeps({ llm: scriptedLlm({ reply: goodAnswer(), extractReply: { language: "en", topics: ["headache"], drugs: [], who_for: "self", age_hint: null, safety_flags: [] } }) });
  const { response, events, fields } = await run(deps, turnBody("I have had a headache since morning, it is dull and worse in the evening"));

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-accel-buffering"), "no");
  assert.equal(response.headers.get("access-control-allow-origin"), "http://localhost:3000");

  const order = names(events);
  assert.equal(order[0], "meta");
  assert.ok(order.indexOf("status") < order.indexOf("sources") && order.indexOf("sources") < order.indexOf("field") && order.lastIndexOf("field") < order.indexOf("done"));
  assert.equal(order.at(-1), "done");
  assert.equal(order.includes("red_flag"), false);
  assert.deepEqual(events.filter((e) => e.event === "field").map((e) => e.data.name), ["care_level", "care_reason", "headline", "summary", "likely_causes", "try_tonight", "see_doctor_if", "emergency_if", "medicines", "questions_for_you", "unknowns", "questions_for_doctor", "profile_updates", "language"], "care level first, then the rest in order, each once");
  const steps = events.filter((e) => e.event === "status").map((e) => `${e.data.step}:${e.data.state}`);
  // The FDA step runs: everyday medicines for a headache (paracetamol, ibuprofen) have their labels fetched.
  for (const step of ["read:active", "safety:active", "read:done", "safety:done", "medlineplus:active", "medlineplus:done", "fda:active", "write:active", "write:done"]) assert.ok(steps.includes(step), step);
  // ...but a label the answer doesn't use is never shown as a source.
  assert.deepEqual(eventsNamed(events, "sources").flat().map((s) => s.id), ["S1"]);
  assert.equal(fields.care_level, "selfcare");
  assert.deepEqual(fields.likely_causes[0].source_ids, ["S1"]);

  const done = eventsNamed(events, "done")[0];
  assert.equal(done.degraded, false);
  assert.equal(done.saved, true);
  assert.deepEqual(done.usage, { tokens_in: 240, tokens_out: 160 }, "fast model plus main model");

  const rows = deps.repo.state.messages;
  assert.deepEqual(rows.map((m) => m.role), ["user", "assistant"]);
  assert.equal(rows[0].content, "I have had a headache since morning, it is dull and worse in the evening");
  assert.equal(rows[1].reply_to, rows[0].id);
  assert.equal(rows[1].care_level, "selfcare");
  assert.equal(rows[1].answer.headline, fields.headline);
  assert.equal(rows[1].sources.length, 1);
  assert.match(rows[1].content_version, /^2026-.*\/2026-/);
  assert.equal(deps.repo.state.quotaCalls, 1);
  assert.equal(deps.repo.state.used.get(USER_ID), 1);
  assert.equal(deps.repo.state.titles[0], "Headache");
  assert.equal(deps.repo.state.tokens.in, 240);
  assert.equal(deps.repo.state.ruleEvents.length, 0);
});

test("an emergency the AI under-rated: alarm first, level raised, wording replaced, nothing for home", async () => {
  const deps = makeDeps({ llm: scriptedLlm({ reply: goodAnswer({ care_level: "selfcare", try_tonight: [{ text: "Rest and drink water", source_ids: [] }] }), extractReply: { language: "en", topics: [], drugs: [], who_for: "self", age_hint: null, safety_flags: [] } }) });
  const { events, fields } = await run(deps, turnBody("I have crushing chest pain and my left arm is numb"));

  const firstSubstantial = names(events).filter((n) => n !== "meta" && n !== "status");
  assert.equal(firstSubstantial[0], "red_flag", "the alarm comes before anything else");
  const alarm = eventsNamed(events, "red_flag")[0];
  assert.deepEqual([alarm.level, alarm.rule_ids, alarm.source, alarm.crisis], ["ambulance", ["chest-pain"], "rules", false]);

  assert.equal(fields.care_level, "ambulance");
  assert.match(fields.care_reason, /We raised this because you mentioned/);
  assert.equal(fields.headline, "This may be an emergency. Call 112 now.");
  assert.deepEqual(fields.try_tonight, []);
  assert.equal(levelOf(events), "ambulance");
  assert.equal(eventsNamed(events, "done")[0].raised_by_rules, true);

  const assistant = deps.repo.state.messages.find((m) => m.role === "assistant");
  assert.equal(assistant.raised_by_rules, true);
  assert.equal(assistant.care_level, "ambulance");
  assert.deepEqual(deps.repo.state.ruleEvents, [{ user_id: USER_ID, rule_ids: ["chest-pain"], level: "ambulance", source: "rules" }]);
  assert.equal(JSON.stringify(deps.repo.state.ruleEvents).includes("crushing"), false, "only rule ids are logged, never the words");
});

test("the model's own emergency flag works when the rules do not know the phrase", async () => {
  const text = "mi papá tiene dolor en el pecho y le falta el aire";
  const llm = scriptedLlm({ reply: goodAnswer({ care_level: "doctor" }), extractReply: { language: "es", topics: [], drugs: [], who_for: "someone_else", age_hint: null, safety_flags: [{ level: "ambulance", evidence: "dolor en el pecho", crisis: false }, { level: "ambulance", evidence: "made up quote", crisis: false }] } });
  const deps = makeDeps({ llm });
  const { events, fields } = await run(deps, turnBody(text));
  const alarms = eventsNamed(events, "red_flag");
  assert.equal(alarms.length, 1);
  assert.deepEqual([alarms[0].level, alarms[0].source], ["ambulance", "model"]);
  assert.equal(fields.care_level, "ambulance");
  assert.deepEqual(deps.repo.state.ruleEvents.map((e) => [e.rule_ids, e.source]), [[["model-flag"], "model"]]);
});

test("a retry with the same message id replays the saved answer: one answer, one quota unit", async () => {
  const deps = makeDeps();
  const first = await run(deps, turnBody("I have a headache"));
  const again = await run(deps, turnBody("I have a headache"));
  assert.equal(eventsNamed(again.events, "done")[0].replayed, true);
  assert.deepEqual(again.fields, first.fields);
  assert.equal(deps.repo.state.messages.length, 2);
  assert.equal(deps.repo.state.quotaCalls, 1);
  assert.equal(deps.llm.calls.stream.length, 1, "the AI is not asked twice");
});

test("a retry after a crash (question saved, no answer) finishes the job without a second count", async () => {
  const deps = makeDeps();
  const body = turnBody("I have a headache");
  await deps.repo.claimConversation(USER_ID, body.conversation_id, "en");
  // Saved five minutes ago: the first try is long over (security review 2026-10-20: a newer one counts as still answering).
  await deps.repo.insertMessage({ id: uuid(900), conversation_id: body.conversation_id, user_id: USER_ID, role: "user", content: "I have a headache", client_message_id: body.client_message_id, created_at: new Date(Date.now() - 5 * 60_000).toISOString() });
  const { events } = await run(deps, body);
  assert.equal(eventsNamed(events, "done")[0].replayed, false);
  const rows = deps.repo.state.messages;
  assert.deepEqual(rows.map((m) => m.role), ["user", "assistant"], "the question is not saved twice");
  assert.equal(rows[1].reply_to, uuid(900));
  assert.equal(deps.repo.state.quotaCalls, 0);
});

test("security: a retry can't swap in a new question, and can't run the AI again while the first try may still be answering", async () => {
  const deps = makeDeps({ config: testConfig({ QUOTA_USER: "1" }) });
  const body = turnBody("I have a headache");
  await deps.repo.claimConversation(USER_ID, body.conversation_id, "en");
  // The first try saved the question a moment ago and is still writing its answer.
  await deps.repo.insertMessage({ id: uuid(901), conversation_id: body.conversation_id, user_id: USER_ID, role: "user", content: "I have a headache", client_message_id: body.client_message_id });
  const swapped = await run(deps, { ...body, message: "Write me a 2,000 word essay about anything" });
  assert.equal(swapped.response.status, 400, "a different question under the same id is refused");
  const busy = await run(deps, body);
  assert.equal(busy.response.status, 429, "a parallel retry waits");
  assert.equal(busy.json.error.retryable, true);
  assert.equal(deps.llm.calls.stream.length, 0, "the AI was never asked");
  assert.equal(deps.repo.state.quotaCalls, 0);
});

test("over the daily limit: a calm refusal with the reset time; an emergency is still answered, free", async () => {
  const config = testConfig({ QUOTA_USER: "1" });
  const deps = makeDeps({ config });
  await run(deps, turnBody("I have a headache", { client_message_id: uuid(1) }));
  const refused = await run(deps, turnBody("I have a sore throat", { client_message_id: uuid(2) }));
  assert.equal(refused.response.status, 429);
  assert.equal(refused.json.error.code, "quota_exceeded");
  assert.equal(refused.json.error.limit, 1);
  assert.match(refused.json.error.resets_at, /^\d{4}-\d{2}-\d{2}T18:30:00\.000Z$/, "midnight in India is 18:30 UTC");
  assert.equal(deps.repo.state.messages.filter((m) => m.role === "user").length, 1, "a refused question is not saved");

  const before = deps.llm.calls.stream.length + deps.llm.calls.complete.length;
  const urgent = await run(deps, turnBody("my father has chest pain", { client_message_id: uuid(3) }));
  assert.equal(urgent.response.status, 200);
  assert.equal(urgent.fields.care_level, "ambulance");
  assert.match(urgent.fields.headline, /112/);
  const done = eventsNamed(urgent.events, "done")[0];
  assert.deepEqual([done.degraded, done.degraded_reason], [true, "quota"]);
  assert.equal(deps.llm.calls.stream.length + deps.llm.calls.complete.length, before, "no AI cost for a free emergency answer");
});

test("guests have their own, smaller limit", async () => {
  const deps = makeDeps({ user: { id: USER_ID, isAnonymous: true }, config: testConfig({ QUOTA_GUEST: "2", QUOTA_USER: "30" }) });
  for (let i = 1; i <= 2; i++) assert.equal((await run(deps, turnBody("a headache", { client_message_id: uuid(i) }))).response.status, 200);
  assert.equal((await run(deps, turnBody("a headache", { client_message_id: uuid(3) }))).response.status, 429);
});

test("no consent yet: the AI stays off. Emergencies are still met with the fixed answer, with nothing sent or saved", async () => {
  const repo = createMemoryRepo({ consents: [{ user_id: USER_ID, doc_type: "terms", version: "2026-10-19" }] });
  const deps = makeDeps({ repo });
  const refused = await run(deps, turnBody("I have a headache"));
  assert.equal(refused.response.status, 403);
  assert.deepEqual([refused.json.error.code, refused.json.error.missing.sort()], ["consent_required", ["age_18", "ai_processing"]]);
  assert.equal(repo.state.messages.length, 0);

  const urgent = await run(deps, turnBody("I want to end my life"));
  assert.equal(urgent.response.status, 200);
  assert.match(JSON.stringify(urgent.fields), /14416/);
  assert.equal(eventsNamed(urgent.events, "done")[0].degraded_reason, "consent");
  assert.equal(eventsNamed(urgent.events, "done")[0].saved, false);
  assert.equal(repo.state.messages.length, 0, "nothing is stored before consent");
  assert.equal(deps.llm.calls.stream.length + deps.llm.calls.complete.length, 0, "and nothing goes to the AI");
});

test("an out-of-date consent version asks again", async () => {
  const repo = createMemoryRepo({ consents: ["age_18", "terms", "ai_processing"].map((doc_type) => ({ user_id: USER_ID, doc_type, version: "2020-01-01" })) });
  const refused = await run(makeDeps({ repo }), turnBody("I have a headache"));
  assert.equal(refused.json.error.code, "consent_required");
});

test("refused before streaming: bad sign-in, bad request, someone else's chat, too fast", async () => {
  const deps = makeDeps({ rate: createRateLimiter(2) });
  const handler = createChatHandler(deps);
  const status = async (body, options) => (await handler(chatRequest(body, options))).status;

  assert.equal(await status(turnBody("hi"), { token: "bad" }), 401);
  assert.equal((await handler(new Request("https://x.test", { method: "POST", body: "{}" }))).status, 401, "no Authorization header");
  assert.equal(await status({ ...turnBody("hi"), message: "   " }), 400);
  assert.equal(await status({ ...turnBody("hi"), message: "x".repeat(4001) }), 400);
  assert.equal(await status({ ...turnBody("hi"), client_message_id: "nope" }), 400);
  assert.equal(await status({ ...turnBody("hi"), conversation_id: "nope" }), 400);
  assert.equal(await status(turnBody("hi"), { method: "GET" }), 400);

  const preflight = await handler(new Request("https://x.test", { method: "OPTIONS", headers: { origin: "http://localhost:3000" } }));
  assert.equal(preflight.status, 204);
  const stranger = await handler(chatRequest(turnBody("hi"), { origin: "https://evil.example" }));
  assert.equal(stranger.headers.get("access-control-allow-origin"), null, "another website cannot read the answers");
  await stranger.body?.cancel();

  const foreign = makeDeps();
  await foreign.repo.claimConversation("22222222-2222-4222-8222-222222222222", uuid(50), "en");
  const notMine = await run(foreign, turnBody("hi"));
  assert.equal(notMine.response.status, 404);
  assert.equal(foreign.repo.state.messages.length, 0);

  const burst = makeDeps({ rate: createRateLimiter(1) });
  await run(burst, turnBody("a headache", { client_message_id: uuid(1) }));
  const fast = await run(burst, turnBody("a headache", { client_message_id: uuid(2) }));
  assert.equal(fast.response.status, 429);
  assert.equal(fast.json.error.code, "rate_limited");
  assert.ok(Number(fast.response.headers.get("retry-after")) >= 1);
});

test("the AI is down: a sources-only answer still arrives, is saved, and is marked degraded", async () => {
  const llm = scriptedLlm({ streamError: new Error("503"), completeReply: new Error("503"), extractReply: new Error("down") });
  const deps = makeDeps({ llm });
  const { events, fields } = await run(deps, turnBody("I have a headache"));
  const done = eventsNamed(events, "done")[0];
  assert.deepEqual([done.degraded, done.degraded_reason, done.saved], [true, "llm_error", true]);
  assert.match(fields.headline, /offline/);
  assert.equal(fields.care_level, "doctor");
  assert.ok(fields.see_doctor_if.length >= 1);
  assert.equal(eventsNamed(events, "sources")[0].length, 1, "the sources are still shown");
  assert.equal(deps.repo.state.messages.at(-1).answer.headline, fields.headline);
});

test("the kill switch and a missing AI key behave the same way; an emergency stays an emergency", async () => {
  for (const deps of [makeDeps({ config: testConfig({ AI_ENABLED: "false" }) }), makeDeps({ llm: null, config: testConfig({ LLM_API_KEY: "" }) })]) {
    const calm = await run(deps, turnBody("I have a sore throat", { client_message_id: uuid(1) }));
    assert.equal(eventsNamed(calm.events, "done")[0].degraded_reason, "ai_off");
    assert.match(calm.fields.headline, /offline/);
    assert.equal(eventsNamed(calm.events, "sources")[0].length, 1);
    const urgent = await run(deps, turnBody("he is not breathing", { client_message_id: uuid(2) }));
    assert.equal(urgent.fields.care_level, "ambulance");
    assert.match(urgent.fields.headline, /112/);
  }
  assert.equal(makeDeps({ config: testConfig({ AI_ENABLED: "false" }) }).llm.calls.stream.length, 0);
});

test("the daily token cap switches the AI off for everyone", async () => {
  const repo = createMemoryRepo();
  repo.state.tokens.in = 900;
  repo.state.tokens.out = 200;
  const deps = makeDeps({ repo, config: testConfig({ DAILY_TOKEN_CAP: "1000" }) });
  const { events } = await run(deps, turnBody("I have a headache"));
  assert.equal(eventsNamed(events, "done")[0].degraded_reason, "ai_off");
});

test("the AI returns rubbish: one repair try, then a safe fallback; if it returns half an answer, the rest is filled in", async () => {
  const rubbish = scriptedLlm({ reply: "I am sorry, I cannot help with that.", completeReply: "still not json", extractReply: new Error("x") });
  const a = await run(makeDeps({ llm: rubbish }), turnBody("I have a headache"));
  assert.equal(eventsNamed(a.events, "done")[0].degraded_reason, "llm_error");
  assert.equal(rubbish.calls.complete.filter((c) => c.model === "main-model").length, 1, "exactly one repair attempt");

  const repaired = scriptedLlm({ reply: "oops", completeReply: goodAnswer(), extractReply: new Error("x") });
  const b = await run(makeDeps({ llm: repaired }), turnBody("I have a headache"));
  assert.equal(eventsNamed(b.events, "done")[0].degraded, false);
  assert.match(b.fields.headline, /Most headaches/);

  const half = scriptedLlm({ reply: JSON.stringify(goodAnswer()).slice(0, 260), extractReply: new Error("x") });
  const c = await run(makeDeps({ llm: half }), turnBody("I have a headache"));
  assert.equal(c.events.at(-1).event, "done");
  assert.deepEqual(Object.keys(c.fields).length, 14, "all fields arrive, the missing ones filled with safe defaults");
  assert.equal(eventsNamed(c.events, "done")[0].degraded, true);
});

test("whatever the model writes, the person never sees amounts, links or invented sources", async () => {
  const hostile = goodAnswer({
    headline: "Visit https://evil.example now",
    summary: "Take 2 tablets every 6 hours. You have a migraine. Rest well.",
    try_tonight: [{ text: "Take 500 mg", source_ids: [] }, { text: "Take azithromycin", source_ids: [] }],
    likely_causes: [{ text: "Stress is a common cause", source_ids: ["S7", "S1"] }],
    medicines: [{ name: "Ibuprofen", note: "Take 400 mg", source_ids: ["S1"] }],
  });
  const { fields } = await run(makeDeps({ llm: scriptedLlm({ reply: hostile, extractReply: new Error("x") }) }), turnBody("I have a headache"));
  const shown = JSON.stringify(fields);
  assert.doesNotMatch(shown, /evil\.example|500|400|every 6 hours|2 tablets|migraine\./i);
  assert.doesNotMatch(shown, /azithromycin/i);
  assert.deepEqual(fields.likely_causes[0].source_ids, ["S1"]);
  // Ibuprofen is an everyday option for a headache (otc.ts), so it may appear, but only in our own fixed wording.
  assert.equal(fields.medicines.length, 1);
  assert.equal(fields.medicines[0].kind, "otc");
  assert.equal(fields.medicines[0].name, "Ibuprofen");
  assert.doesNotMatch(fields.medicines[0].note, /\d/, "never an amount");
});

test("a medicine the person asks about: label facts with a link, never an amount", async () => {
  const reply = goodAnswer({ medicines: [{ name: "Crocin", note: "The label says to stop use and ask a doctor if pain lasts more than 10 days.", source_ids: ["S2"] }] });
  const llm = scriptedLlm({ reply, extractReply: { language: "en", topics: ["headache"], drugs: ["Crocin"], who_for: "self", age_hint: null, safety_flags: [] } });
  const deps = makeDeps({ llm });
  const { events, fields } = await run(deps, turnBody("can I take Crocin for my headache"));
  const sources = eventsNamed(events, "sources")[0];
  assert.deepEqual(sources.map((s) => s.kind), ["condition", "medicine"]);
  assert.match(sources[1].url, /dailymed\.nlm\.nih\.gov/);
  assert.equal(fields.medicines[0].name, "Crocin");
  assert.deepEqual(fields.medicines[0].source_ids, ["S2"]);
  assert.match(fields.medicines[0].note, /stop use and ask a doctor/);
  const prompt = llm.calls.stream[0].messages[1].content;
  assert.match(prompt, /\[S2\] U\.S\. FDA drug label/);
  assert.doesNotMatch(prompt, /4,000|dosage/i, "the label's dosing text never reaches the model");
});

test("self-harm: the calm crisis flow, a supportive prompt, no lookups; and if the AI is down, the fixed caring answer", async () => {
  const supportive = goodAnswer({ care_level: "doctor", headline: "I'm glad you told me", summary: "That sounds really heavy. Are you safe right now? Tele-MANAS on 14416 is free any time.", try_tonight: [{ text: "Tell someone you trust how you feel", source_ids: [] }] });
  const fetchLog = [];
  const llm = scriptedLlm({ reply: supportive });
  const deps = makeDeps({ llm, fetch: standardInternet({ log: fetchLog }) });
  const { events, fields } = await run(deps, turnBody("I want to kill myself"));
  const alarm = eventsNamed(events, "red_flag")[0];
  assert.deepEqual([alarm.level, alarm.crisis], ["ambulance", true]);
  assert.equal(fields.care_level, "ambulance");
  assert.equal(fetchLog.length, 0, "nothing about this is sent to any public database");
  assert.match(llm.calls.stream[0].messages[0].content, /supportive mode/);
  assert.equal(llm.calls.complete.length, 0, "no fast-model extraction either");
  assert.deepEqual(fields.medicines, []);
  assert.equal(fields.headline, "I'm glad you told me");
  assert.deepEqual(deps.repo.state.ruleEvents.map((e) => e.rule_ids), [["self-harm"]]);

  const down = makeDeps({ llm: scriptedLlm({ streamError: new Error("x"), completeReply: new Error("x") }) });
  const fallback = await run(down, turnBody("I want to kill myself"));
  assert.match(JSON.stringify(fallback.fields), /Tele-MANAS on 14416/);
  assert.equal(fallback.fields.care_level, "ambulance");
});

test("a sleep question shows only sleep sources: no page that merely mentions sleep (live test 2026-10-19)", async () => {
  // The fast model's own topic has no MedlinePlus page; a plain search for it ranks Lewy Body Dementia first.
  const llm = scriptedLlm({ reply: goodAnswer(), extractReply: { language: "en", topics: ["sleep difficulty"], drugs: [], who_for: "self", age_hint: null, safety_flags: [] } });
  const fetch = fakeFetch({
    medlineplus: {
      'title:"insomnia"': fixture("medlineplus-insomnia.xml"),
      'title:"sleep difficulty"': fixture("medlineplus-sleep-difficulty-title.xml"),
      "sleep difficulty": fixture("medlineplus-sleep-difficulty-plain.xml"),
    },
  });
  const { events } = await run(makeDeps({ llm, fetch }), turnBody("I'm having trouble sleeping"));
  assert.deepEqual(eventsNamed(events, "sources").flat().map((s) => s.title), ["Insomnia"]);
});

test("private details are hidden from the AI and the lookups, and restored in what the person sees", async () => {
  // [NAME_1] is the first name Nox greets the person with (prompt rule 13); the full name in the message is [NAME_2].
  const reply = goodAnswer({ summary: "I can't examine you, [NAME_2]. Many headaches come from stress. Rest helps, [NAME_1].", questions_for_you: ["Is [PHONE_1] the best number?"] });
  const llm = scriptedLlm({ reply, extractReply: { language: "en", topics: ["headache"], drugs: [], who_for: "self", age_hint: null, safety_flags: [] } });
  const fetchLog = [];
  const deps = makeDeps({ llm, fetch: standardInternet({ log: fetchLog }), repo: createMemoryRepo({ profile: { display_name: "Asha Kulkarni" } }) });
  const text = "My name is Asha and my number is 98765 43210. Asha Kulkarni has a headache. Mail me at asha@example.com";
  const { fields } = await run(deps, turnBody(text));

  const sent = JSON.stringify([...llm.calls.complete, ...llm.calls.stream].map((c) => c.messages));
  for (const secret of ["Asha", "Kulkarni", "98765", "asha@example.com"]) assert.equal(sent.includes(secret), false, `${secret} must not reach the AI`);
  assert.match(sent, /\[PHONE_1\]/);
  assert.equal(fetchLog.some((url) => /asha|kulkarni|98765/i.test(decodeURIComponent(url))), false, "nor any public database");
  assert.match(sent, /address them by it, rule 13\): \[NAME_1\]/, "the AI is told to greet the person, by placeholder only");
  assert.match(fields.summary, /examine you, Asha Kulkarni\./, "placeholders become the real words again");
  assert.match(fields.summary, /Rest helps, Asha\./, "and the greeting uses their first name");
  assert.deepEqual(fields.questions_for_you, ["Is 98765 43210 the best number?"]);
  assert.equal(deps.repo.state.messages[0].content, text, "the person's own copy is exactly what they wrote");
  assert.match(JSON.stringify(deps.repo.state.messages[1].answer), /Asha/);
});

test("'Don't save my chats': nothing is stored, history comes from the browser, and the quota still counts", async () => {
  const llm = scriptedLlm({ reply: goodAnswer(), extractReply: new Error("x") });
  const deps = makeDeps({ llm });
  const history = [{ role: "user", text: "I have had a fever for two days" }, { role: "assistant", text: "Fevers often come from infections." }];
  const { events } = await run(deps, turnBody("and now a headache too", { options: { save: false }, history, conversation_id: null }));
  assert.equal(eventsNamed(events, "meta")[0].conversation_id, null);
  assert.deepEqual([deps.repo.state.messages.length, deps.repo.state.conversations.size], [0, 0]);
  assert.equal(eventsNamed(events, "done")[0].saved, false);
  assert.equal(deps.repo.state.quotaCalls, 1);
  const prompt = llm.calls.stream[0].messages[1].content;
  assert.match(prompt, /Person: I have had a fever for two days/);
  assert.match(prompt, /Assistant: Fevers often come from infections\./);

  const profileOff = makeDeps({ repo: createMemoryRepo({ profile: { save_chats: false } }) });
  await run(profileOff, turnBody("a headache"));
  assert.equal(profileOff.repo.state.messages.length, 0, "the account setting is honoured even if the browser asks to save");
});

test("earlier messages in the same chat are given to the AI, and an earlier warning sign still counts", async () => {
  const llm = scriptedLlm({ reply: goodAnswer({ care_level: "selfcare" }), extractReply: new Error("x") });
  const deps = makeDeps({ llm });
  await run(deps, turnBody("my baby has a fever", { client_message_id: uuid(1) }));
  const { events, fields } = await run(deps, turnBody("she is 6 weeks old", { client_message_id: uuid(2) }));
  assert.match(llm.calls.stream[1].messages[1].content, /Person: my baby has a fever/);
  const unrelated = await run(deps, turnBody("I also have a mild headache", { client_message_id: uuid(3) }));
  assert.equal(eventsNamed(unrelated.events, "red_flag").length, 0, "an unrelated later question is not an emergency");
  assert.notEqual(unrelated.fields.care_level, "emergency");
  assert.equal(fields.care_level, "emergency", "a fever in a baby under three months, put together from two messages");
  assert.equal(eventsNamed(events, "red_flag")[0].level, "emergency");
});

test("saved health profile: used for members who allow it, never for guests", async () => {
  const health = { age_range: "45-54", sex_at_birth: "female", pregnancy: "no", conditions: ["asthma"], allergies: ["penicillin"], medicines: [] };
  const member = makeDeps({ repo: createMemoryRepo({ health }), llm: scriptedLlm({ reply: goodAnswer(), extractReply: new Error("x") }) });
  await run(member, turnBody("a headache"));
  assert.match(member.llm.calls.stream[0].messages[1].content, /allergies: penicillin/);

  const optedOut = makeDeps({ repo: createMemoryRepo({ health }), llm: scriptedLlm({ reply: goodAnswer(), extractReply: new Error("x") }) });
  await run(optedOut, turnBody("a headache", { options: { use_profile: false } }));
  assert.doesNotMatch(optedOut.llm.calls.stream[0].messages[1].content, /penicillin/);

  const guest = makeDeps({ user: { id: USER_ID, isAnonymous: true }, repo: createMemoryRepo({ health }), llm: scriptedLlm({ reply: goodAnswer(), extractReply: new Error("x") }) });
  await run(guest, turnBody("a headache"));
  assert.doesNotMatch(guest.llm.calls.stream[0].messages[1].content, /penicillin/);
});

test("security: phone numbers typed into the saved profile or a blood result never reach the AI; long lists are cut", async () => {
  const health = {
    age_range: "45-54", sex_at_birth: "female", pregnancy: "no",
    conditions: ["asthma", ...Array.from({ length: 40 }, (_, i) => `condition ${i} ${"x".repeat(150)}`)],
    allergies: ["penicillin"],
    medicines: ["Metformin 500 mg, Dr Rao 98765 43210"],
  };
  const labs = [{ marker: "hba1c", label: "HbA1c call 98765 43210", value: 7.1, unit: "%", test_date: "2026-10-01" }];
  const deps = makeDeps({ repo: createMemoryRepo({ health, labs }), llm: scriptedLlm({ reply: goodAnswer(), extractReply: new Error("x") }) });
  await run(deps, turnBody("a headache"));
  const prompt = deps.llm.calls.stream[0].messages[1].content;
  assert.match(prompt, /regular medicines: Metformin 500 mg, Dr Rao \[PHONE_1\]/);
  assert.doesNotMatch(prompt, /98765/);
  const conditions = prompt.split("\n").find((line) => line.includes("long-term conditions:"));
  assert.ok(conditions.length < 1300, `the conditions line is ${conditions.length} characters`);
  assert.doesNotMatch(conditions, /x{81}/, "each item is at most 80 characters");
});

test("the answer is saved even if the browser closes the page mid-way", async () => {
  const deps = makeDeps();
  const handler = createChatHandler(deps);
  const response = await handler(chatRequest(turnBody("I have a headache")));
  const reader = response.body.getReader();
  await reader.read();
  await reader.cancel();
  await Promise.all(deps.background);
  assert.deepEqual(deps.repo.state.messages.map((m) => m.role), ["user", "assistant"]);
});

test("if saving fails the answer still arrives and the browser is told it was not saved", async () => {
  const deps = makeDeps({ repo: createMemoryRepo({ failInsert: true }) });
  const { events, fields } = await run(deps, turnBody("I have a headache"));
  assert.ok(fields.headline);
  assert.equal(eventsNamed(events, "done")[0].saved, false);
});

test("logs describe the turn but never contain what the person wrote or what was answered", async () => {
  const deps = makeDeps({ llm: scriptedLlm({ reply: goodAnswer({ headline: "UNIQUE-ANSWER-MARKER" }), extractReply: new Error("x") }) });
  await run(deps, turnBody("I have chest pain, UNIQUE-QUESTION-MARKER, call me on 9876543210"));
  const all = deps.logs.join("\n");
  assert.ok(deps.logs.length >= 1);
  for (const marker of ["UNIQUE-QUESTION-MARKER", "UNIQUE-ANSWER-MARKER", "9876543210", "chest pain"]) assert.equal(all.includes(marker), false, marker);
  const turn = JSON.parse(deps.logs.find((line) => line.includes('"event":"turn"')));
  assert.deepEqual(turn.rule_ids, ["chest-pain"]);
  assert.equal(turn.level, "ambulance");
  assert.ok(turn.ms >= 0 && turn.tokens_in > 0);
});

test("slow public databases never hold the answer hostage", async () => {
  const slow = fakeFetch({ medlineplus: { "*": "<x/>" }, delayMs: 5000 });
  const deps = makeDeps({ fetch: slow, config: testConfig({ GROUND_SOURCE_TIMEOUT_MS: "500", GROUND_TIMEOUT_MS: "600" }), llm: scriptedLlm({ reply: goodAnswer(), extractReply: { language: "en", topics: ["headache"], drugs: [], who_for: "self", age_hint: null, safety_flags: [] } }) });
  const started = Date.now();
  const { events, fields } = await run(deps, turnBody("I have a headache"));
  assert.ok(Date.now() - started < 3000);
  assert.equal(eventsNamed(events, "sources")[0].length, 0);
  assert.match(fields.unknowns, /couldn't find a trusted source/, "no sources, and the answer says so");
  assert.ok(events.some((e) => e.event === "status" && e.data.step === "medlineplus" && e.data.state === "failed"));
});

test("the database is down: an emergency still gets the fixed answer; an ordinary question gets an honest error", async () => {
  const repo = createMemoryRepo();
  repo.getProfile = async () => { throw new Error("database unreachable"); };
  const deps = makeDeps({ repo });
  const urgent = await run(deps, turnBody("my mother is unconscious"));
  assert.equal(urgent.response.status, 200);
  assert.equal(urgent.fields.care_level, "ambulance");
  assert.match(urgent.fields.headline, /112/);
  const done = eventsNamed(urgent.events, "done")[0];
  assert.deepEqual([done.degraded_reason, done.saved], ["db", false]);
  assert.equal(deps.llm.calls.stream.length + deps.llm.calls.complete.length, 0);

  const calm = await run(deps, turnBody("I have a headache"));
  assert.equal(calm.response.status, 500);
  assert.equal(calm.json.error.code, "internal");
  assert.equal(calm.json.error.retryable, true);
  assert.doesNotMatch(JSON.stringify(calm.json), /unreachable/);
});

test("the answer is streamed as it is written, not held until the end", async () => {
  const text = JSON.stringify(goodAnswer());
  const arrivals = [];
  const slow = {
    calls: { stream: [], complete: [] },
    async complete() { throw new Error("no fast model"); },
    async stream(request) {
      for (let i = 0; i < text.length; i += 60) {
        request.onDelta(text.slice(i, i + 60));
        await new Promise((resolve) => setTimeout(resolve, 12));
      }
      return { text, usage: { tokens_in: 1, tokens_out: 1 }, model: "m", finishReason: "stop" };
    },
  };
  const deps = makeDeps({ llm: slow });
  const response = await createChatHandler(deps)(chatRequest(turnBody("I have a headache")));
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const started = Date.now();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value);
    for (const match of buffer.matchAll(/event: (\w+)\ndata: ([^\n]*)\n\n/g)) {
      const key = match[1] === "field" ? `field:${JSON.parse(match[2]).name}` : match[1];
      if (!arrivals.some(([k]) => k === key)) arrivals.push([key, Date.now() - started]);
    }
  }
  const at = Object.fromEntries(arrivals);
  assert.ok(at["field:care_level"] < at["field:summary"] && at["field:summary"] < at["field:questions_for_doctor"], JSON.stringify(arrivals));
  assert.ok(at.done - at["field:care_level"] > 100, `the first field came ${at.done - at["field:care_level"]} ms before the end`);
  assert.ok(at.meta < 50, "the first event arrives at once");
});

test("bug review 2026-10-20: an emergency that only shows across two messages beats the daily limit", async () => {
  const deps = makeDeps({ config: testConfig({ QUOTA_USER: "1" }) });
  await run(deps, turnBody("my baby has a fever", { client_message_id: uuid(1) }));
  const second = await run(deps, turnBody("she is 6 weeks old", { client_message_id: uuid(2) }));
  assert.equal(second.response.status, 200, "not refused for the daily limit");
  assert.equal(eventsNamed(second.events, "red_flag")[0].level, "emergency");
  const calm = await run(deps, turnBody("she also has a runny nose", { client_message_id: uuid(3) }));
  assert.equal(calm.response.status, 429, "an ordinary follow-up is still limited");
});

test("bug review 2026-10-20: a crisis only the model notices gets the calm crisis flow, and is remembered", async () => {
  const flags = (evidence) => ({ language: "en", topics: [], drugs: [], who_for: "self", age_hint: null, safety_flags: [{ level: "ambulance", evidence, crisis: true }] });
  const supportive = goodAnswer({ care_level: "ambulance", headline: "I'm glad you told me" });
  const llm = scriptedLlm({ reply: supportive, extractReply: flags("saving up my sleeping pills") });
  const deps = makeDeps({ llm });
  const { events } = await run(deps, turnBody("everyone would be happier if I just disappeared, I am saving up my sleeping pills"));
  assert.equal(eventsNamed(events, "red_flag").at(-1).crisis, true);
  assert.match(llm.calls.stream[0].messages[0].content, /supportive mode/, "the crisis prompt, not the normal one");
  const saved = deps.repo.state.messages.find((m) => m.role === "assistant");
  assert.ok(saved.rule_ids.includes("model-crisis"), "a reopened chat shows the crisis presentation");

  // The rules already said "ambulance" (an overdose); the model's crisis flag is still sent, and switches the flow.
  const llm2 = scriptedLlm({ reply: supportive, extractReply: flags("I took an overdose") });
  const deps2 = makeDeps({ llm: llm2 });
  const second = await run(deps2, turnBody("I took an overdose"));
  const alarms = eventsNamed(second.events, "red_flag");
  assert.deepEqual([alarms[0].crisis, alarms.at(-1).crisis], [false, true]);
});

test("bug review 2026-10-20: if the database fails while counting the question, an emergency is still answered", async () => {
  const repo = createMemoryRepo();
  repo.consumeQuota = async () => {
    throw new Error("timeout");
  };
  const deps = makeDeps({ repo });
  const urgent = await run(deps, turnBody("crushing chest pain going down my arm", { client_message_id: uuid(1) }));
  assert.equal(urgent.response.status, 200);
  assert.equal(eventsNamed(urgent.events, "red_flag")[0].level, "ambulance");
  assert.match(urgent.fields.headline, /112/);
  const calm = await run(makeDeps({ repo }), turnBody("I have a mild headache", { client_message_id: uuid(2) }));
  assert.equal(calm.response.status, 500, "an ordinary question gets the normal error");
});

test("bug review 2026-10-20: a parallel duplicate gives back its question and never runs the AI", async () => {
  const deps = makeDeps();
  // The first request already saved the question (it is still running); a second with the same id arrives before it.
  const original = deps.repo.findUserMessage;
  deps.repo.findUserMessage = async () => null; // both requests looked before either saved
  await deps.repo.claimConversation(USER_ID, uuid(50), "en");
  await deps.repo.insertMessage({ id: uuid(70), conversation_id: uuid(50), user_id: USER_ID, role: "user", content: "I have a headache", client_message_id: uuid(1) });
  const { events } = await run(deps, turnBody("I have a headache", { client_message_id: uuid(1) }));
  deps.repo.findUserMessage = original;
  const error = eventsNamed(events, "error")[0];
  assert.equal(error.code, "rate_limited");
  assert.equal(error.retry_after_s, 15);
  assert.equal(deps.llm.calls.stream.length, 0, "the AI was never asked");
  assert.equal(deps.repo.state.released, 1, "the counted question is given back");
});

test("bug review 2026-10-20: a first question refused for the daily limit leaves no empty chat behind", async () => {
  const deps = makeDeps({ config: testConfig({ QUOTA_USER: "1" }) });
  await run(deps, turnBody("I have a headache", { client_message_id: uuid(1), conversation_id: uuid(50) }));
  const refused = await run(deps, turnBody("I have a sore throat", { client_message_id: uuid(2), conversation_id: uuid(51) }));
  assert.equal(refused.response.status, 429);
  assert.equal(deps.repo.state.conversations.has(uuid(51)), false);
  assert.equal(deps.repo.state.conversations.has(uuid(50)), true, "the chat with a question in it stays");
});

import { parseChatRequest } from "../../functions/_shared/chat.ts";

test("bug review 2026-10-20: a long history keeps the newest messages, not the oldest", () => {
  const history = [];
  for (let i = 0; i < 6; i++) history.push({ role: "user", text: `Q${i} ${"x".repeat(2000)}` }, { role: "assistant", text: `A${i} ${"y".repeat(800)}` });
  const parsed = parseChatRequest({ client_message_id: uuid(1), conversation_id: null, message: "and now?", history, client: { ui_lang: "en" } }, testConfig().limits);
  const kept = parsed.history.map((item) => item.text.slice(0, 2));
  assert.equal(kept.at(-1), "A5", "the latest reply is kept");
  assert.ok(kept.includes("Q5"));
  assert.ok(!kept.includes("Q0"), "the oldest is what gets dropped");
});

test("bug review 2026-10-20: an answer cut off near the end is not called 'AI offline', and its tokens still count", async () => {
  const text = JSON.stringify(goodAnswer());
  const llm = scriptedLlm({ reply: goodAnswer(), extractReply: new Error("x") });
  llm.stream = async (request) => {
    llm.calls.stream.push(request);
    request.onDelta(text.slice(0, Math.floor(text.length * 0.8)));
    throw new Error("timeout after 60 s");
  };
  const deps = makeDeps({ llm });
  const { events, fields } = await run(deps, turnBody("I have a headache"));
  const done = eventsNamed(events, "done")[0];
  assert.notEqual(done.degraded_reason, "llm_error");
  assert.equal(fields.headline, goodAnswer().headline);
  assert.ok(deps.repo.state.tokens.in > 0 && deps.repo.state.tokens.out > 0, "an estimate reaches the daily total");
});

test("bug review 2026-10-20: a question asked while the AI is off or today's budget is spent costs nothing", async () => {
  const off = makeDeps({ config: testConfig({ AI_ENABLED: "false" }) });
  await run(off, turnBody("I have a sore throat"));
  assert.equal(off.repo.state.quotaCalls, 0);
  const repo = createMemoryRepo();
  repo.state.tokens.in = 2000;
  const capped = makeDeps({ repo, config: testConfig({ DAILY_TOKEN_CAP: "1000" }) });
  await run(capped, turnBody("I have a sore throat"));
  assert.equal(capped.repo.state.quotaCalls, 0);
});
