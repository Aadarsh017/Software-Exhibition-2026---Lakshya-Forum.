// The logic behind the chat screen: reading the stream, the state of a turn, regions, error words.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSseParser, streamChat, ChatRequestError } from "../lib/chat/sse.ts";
import { chatReducer, initialState, isBusy, stepsToShow } from "../lib/chat/reducer.ts";
import { detectRegion, emergencyNumbers } from "../lib/chat/region.ts";
import { friendlyError, degradedNotice } from "../lib/chat/messages.ts";
import { whileYouWait } from "../lib/chat/while-you-wait.ts";

const sse = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const parse = (text, size = text.length) => {
  const out = [];
  const parser = createSseParser((e) => out.push(e));
  for (let i = 0; i < text.length; i += size) parser.push(text.slice(i, i + size));
  parser.end();
  return out;
};

test("stream reader: events survive any chopping, CRLF, comments and unknown events", () => {
  const text = ": connected\n\n" + sse("meta", { message_id: "m" }) + ": ping\n\n" + sse("mystery", { a: 1 }) + sse("field", { name: "headline", value: "Hi — ünï" });
  for (const size of [1, 2, 5, 13, 1000]) {
    const events = parse(text, size);
    assert.deepEqual(events.map((e) => e.event), ["meta", "field"], `size ${size}`);
    assert.equal(events[1].data.value, "Hi — ünï");
  }
  assert.equal(parse(text.replace(/\n/g, "\r\n"), 7).length, 2, "CRLF line ends");
  assert.deepEqual(parse("event: field\ndata: {not json}\n\n" + sse("done", { x: 1 })).map((e) => e.event), ["done"], "a damaged event is skipped");
  assert.deepEqual(parse("event: field\ndata: [1,\ndata: 2]\n\n").map((e) => e.event), ["field"], "multi-line data");
  assert.deepEqual(parse(sse("done", { x: 1 }).trimEnd()).map((e) => e.event), ["done"], "a last event with no blank line after it");
});

const streamOf = (chunks, { fail = false } = {}) => {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(encoder.encode(chunks[i++]));
      else if (fail) controller.error(new Error("reset"));
      else controller.close();
    },
  });
};

test("sending: events arrive in order; refusals and network trouble become typed errors", async () => {
  const events = [];
  const ok = async (url, init) => {
    assert.equal(init.method, "POST");
    assert.equal(init.headers.Authorization, "Bearer t");
    assert.equal(init.headers["Content-Type"], "application/json");
    return new Response(streamOf([sse("meta", { message_id: "m" }), sse("done", { message_id: "m" })]), { status: 200 });
  };
  await streamChat({ url: "https://x.test/chat", headers: { Authorization: "Bearer t" }, body: { a: 1 }, fetch: ok, onEvent: (e) => events.push(e.event) });
  assert.deepEqual(events, ["meta", "done"]);

  const refused = async () => new Response(JSON.stringify({ error: { code: "quota_exceeded", message: "m", retryable: false, limit: 8, resets_at: "2026-10-20T18:30:00.000Z" } }), { status: 429 });
  await assert.rejects(streamChat({ url: "u", headers: {}, body: {}, fetch: refused, onEvent() {} }), (error) => error instanceof ChatRequestError && error.turnError.code === "quota_exceeded" && error.turnError.extra.limit === 8 && !("code" in error.turnError.extra));

  const html = async () => new Response("<html>bad gateway</html>", { status: 502 });
  await assert.rejects(streamChat({ url: "u", headers: {}, body: {}, fetch: html, onEvent() {} }), (error) => error.turnError.code === "internal" && error.turnError.retryable === true);

  const offline = async () => { throw new TypeError("Failed to fetch"); };
  await assert.rejects(streamChat({ url: "u", headers: {}, body: {}, fetch: offline, onEvent() {} }), (error) => error.turnError.code === "network");

  const cut = async () => new Response(streamOf([sse("meta", { message_id: "m" })], { fail: true }), { status: 200 });
  const seen = [];
  await assert.rejects(streamChat({ url: "u", headers: {}, body: {}, fetch: cut, onEvent: (e) => seen.push(e.event) }), (error) => error.turnError.code === "network");
  assert.deepEqual(seen, ["meta"], "what arrived before the cut is kept");

  const controller = new AbortController();
  const hang = (url, init) => new Promise((resolve, reject) => init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
  const pending = streamChat({ url: "u", headers: {}, body: {}, fetch: hang, signal: controller.signal, onEvent() {} });
  controller.abort();
  await assert.rejects(pending, (error) => error.name === "AbortError", "stopping is not reported as a network error");
});

const meta = { event: "meta", data: { conversation_id: "c", message_id: "A1", user_message_id: "U1" } };
const field = (name, value) => ({ event: "field", data: { name, value } });
const status = (step, state) => ({ event: "status", data: { step, state } });
const flag = (level, extra = {}) => ({ event: "red_flag", data: { level, rule_ids: ["chest-pain"], crisis: false, signs: ["Chest pain"], source: "rules", ...extra } });
const done = (extra = {}) => ({ event: "done", data: { message_id: "A1", usage: { tokens_in: 1, tokens_out: 1 }, latency_ms: 5, degraded: false, degraded_reason: null, saved: true, care_level: "selfcare", raised_by_rules: false, replayed: false, ...extra } });

function play(events, id = "t1") {
  let state = chatReducer(initialState("c"), { type: "start", id, text: "I have a headache" });
  for (const event of events) state = chatReducer(state, { type: "event", id, event });
  return state.turns[0];
}

test("a turn: sending, streaming, fields filled in as they arrive, done", () => {
  let state = chatReducer(initialState("c"), { type: "start", id: "t1", text: "hi" });
  assert.equal(state.turns[0].status, "sending");
  assert.equal(isBusy(state), true);
  state = chatReducer(state, { type: "event", id: "t1", event: meta });
  assert.equal(state.turns[0].status, "streaming");
  state = chatReducer(state, { type: "event", id: "t1", event: status("read", "active") });
  state = chatReducer(state, { type: "event", id: "t1", event: field("care_level", "doctor") });
  assert.equal(state.turns[0].fields.care_level, "doctor");
  state = chatReducer(state, { type: "event", id: "t1", event: status("write", "active") });
  state = chatReducer(state, { type: "event", id: "t1", event: done() });
  const turn = state.turns[0];
  assert.equal(turn.status, "done");
  assert.equal(isBusy(state), false);
  assert.deepEqual([turn.steps.read, turn.steps.write], ["done", "done"], "steps still active when the answer is done are finished");
  assert.equal(turn.messageId, "A1");
});

test("fields are replaced by name, so a corrected field wins", () => {
  const turn = play([field("care_reason", "first"), field("care_reason", "second")]);
  assert.equal(turn.fields.care_reason, "second");
});

test("steps follow the server, and the FDA step is hidden when no medicine was asked about", () => {
  const turn = play([status("read", "active"), status("read", "done"), status("medlineplus", "active"), status("fda", "skipped")]);
  assert.deepEqual([turn.steps.read, turn.steps.medlineplus, turn.steps.fda, turn.steps.write], ["done", "active", "skipped", "pending"]);
  assert.deepEqual(stepsToShow(turn), ["read", "safety", "medlineplus", "write"]);
  assert.deepEqual(stepsToShow(play([status("fda", "active")])).includes("fda"), true);
});

test("red flags: the more serious one wins, a crisis one is never replaced", () => {
  assert.equal(play([flag("emergency"), flag("ambulance")]).redFlag.level, "ambulance");
  assert.equal(play([flag("ambulance"), flag("emergency")]).redFlag.level, "ambulance");
  const crisis = play([flag("ambulance", { crisis: true }), flag("ambulance")]);
  assert.equal(crisis.redFlag.crisis, true);
  assert.equal(play([flag("emergency"), flag("ambulance", { crisis: true })]).redFlag.crisis, true);
  // The device's own check only fills a gap; it never overrides the server.
  let state = chatReducer(initialState("c"), { type: "start", id: "t1", text: "x" });
  state = chatReducer(state, { type: "device_flag", id: "t1", flag: { level: "emergency", rule_ids: [], crisis: false, signs: [], source: "device" } });
  assert.equal(state.turns[0].redFlag.source, "device");
  state = chatReducer(state, { type: "event", id: "t1", event: flag("ambulance") });
  assert.deepEqual([state.turns[0].redFlag.level, state.turns[0].redFlag.source], ["ambulance", "rules"]);
});

test("failures keep the message and what had arrived; stop and retry behave", () => {
  const partial = [meta, field("care_level", "doctor"), field("headline", "Partial")];
  let state = chatReducer(initialState("c"), { type: "start", id: "t1", text: "my question" });
  for (const event of partial) state = chatReducer(state, { type: "event", id: "t1", event });
  state = chatReducer(state, { type: "fail", id: "t1", error: { code: "network", message: "", retryable: true, extra: {} } });
  assert.equal(state.turns[0].status, "error");
  assert.equal(state.turns[0].userText, "my question");
  assert.equal(state.turns[0].fields.headline, "Partial");
  state = chatReducer(state, { type: "retry", id: "t1" });
  assert.deepEqual([state.turns[0].status, state.turns[0].fields, state.turns[0].error, state.turns[0].userText], ["sending", {}, null, "my question"]);

  state = chatReducer(state, { type: "stop", id: "t1" });
  assert.equal(state.turns[0].status, "stopped");
  assert.equal(chatReducer(state, { type: "stop", id: "t1" }).turns[0].status, "stopped");

  let finished = chatReducer(initialState("c"), { type: "start", id: "t2", text: "q" });
  finished = chatReducer(finished, { type: "event", id: "t2", event: done() });
  assert.equal(chatReducer(finished, { type: "stop", id: "t2" }).turns[0].status, "done", "a finished answer cannot be 'stopped'");
  assert.equal(chatReducer(finished, { type: "fail", id: "t2", error: { code: "network", message: "", retryable: true, extra: {} } }).turns[0].status, "done", "nor failed afterwards");
  assert.equal(chatReducer(finished, { type: "start", id: "t2", text: "q" }), finished, "the same id is never added twice");
});

test("a server error event ends the turn; sources and done update it", () => {
  const turn = play([meta, { event: "sources", data: [{ id: "S1" }] }, { event: "error", data: { code: "internal", message: "x", retryable: true } }]);
  assert.deepEqual([turn.status, turn.error.code, turn.sourcesArrived, turn.sources.length], ["error", "internal", true, 1]);
  const replay = play([meta, done({ replayed: true })]);
  assert.equal(replay.done.replayed, true);
});

test("emergency numbers come from language and time zone, India by default", () => {
  assert.equal(detectRegion("en-IN", "Asia/Kolkata"), "IN");
  assert.equal(detectRegion("hi", undefined), "IN");
  assert.equal(detectRegion("en-US", "America/New_York"), "US");
  assert.equal(detectRegion("en-GB", "Europe/London"), "GB");
  assert.equal(detectRegion("de", "Europe/Berlin"), "EU");
  assert.equal(detectRegion("ja", "Asia/Tokyo"), "OTHER");
  assert.deepEqual([emergencyNumbers("IN").primary.number, emergencyNumbers("IN").secondary.number], ["112", "108"]);
  assert.equal(emergencyNumbers("US").primary.number, "911");
  assert.equal(emergencyNumbers("OTHER").primary.number, "112");
  assert.equal(emergencyNumbers("OTHER").secondary, null);
  assert.ok(whileYouWait(["chest-pain"]).length >= 3);
});

test("error words are chosen by code and say what the person can do", () => {
  const quota = friendlyError({ code: "quota_exceeded", message: "", retryable: false, extra: { resets_at: "2026-10-20T18:30:00.000Z" } }, true);
  assert.match(quota.body, /call 112 or your doctor/);
  assert.match(quota.body, /Log in with your email/);
  assert.equal(quota.canRetry, false);
  assert.doesNotMatch(friendlyError({ code: "quota_exceeded", message: "", retryable: false, extra: {} }, false).body, /Log in/);
  assert.match(friendlyError({ code: "rate_limited", message: "", retryable: true, extra: { retry_after_s: 12.2 } }, false).body, /13 seconds/);
  assert.match(friendlyError({ code: "network", message: "", retryable: true, extra: {} }, false).body, /message is kept/);
  assert.match(friendlyError({ code: "internal", message: "secret detail", retryable: true, extra: {} }, false).body, /Please try again/);
  assert.doesNotMatch(friendlyError({ code: "internal", message: "secret detail", retryable: true, extra: {} }, false).body, /secret/);
  assert.match(degradedNotice("llm_error"), /offline/);
  assert.equal(degradedNotice(null), null);
  assert.equal(degradedNotice("quota"), null);
});

import { answerToText, citedIn, markerNumber } from "../lib/chat/format.ts";
import { turnsFromRows } from "../lib/chat/history.ts";

test("copy text: the answer, the sources by number and the disclaimer", () => {
  const fields = {
    headline: "Most headaches are mild.",
    summary: "Rest helps.",
    likely_causes: [{ text: "Stress", source_ids: ["S1"] }],
    emergency_if: [{ text: "Stiff neck with fever", source_ids: ["S1"] }],
    medicines: [{ name: "Crocin", note: "Ask a pharmacist.", source_ids: ["S2"] }],
  };
  const sources = [{ id: "S1", title: "Headache", publisher: "MedlinePlus", url: "https://medlineplus.gov/headache.html" }];
  const text = answerToText(fields, sources);
  assert.match(text, /^Most headaches are mild\.\n\nRest helps\./);
  assert.match(text, /What I think is going on:\n- Stress/);
  assert.match(text, /\[1\] Headache \(MedlinePlus\) https:\/\/medlineplus\.gov\/headache\.html/);
  assert.match(text, /General guidance, not medical advice\. In an emergency call 112\.$/);
  assert.deepEqual(citedIn(fields, "S1"), ["What I think is going on", "Get emergency help if"]);
  assert.deepEqual(citedIn(fields, "S2"), ["Medicines"]);
  assert.equal(markerNumber("S12"), 12);
  assert.equal(markerNumber("x"), 0);
});

test("a saved conversation is shown again: answers matched to their questions, an unanswered question can be retried", () => {
  const answer = { headline: "H", care_level: "doctor" };
  const rows = [
    { id: "u1", role: "user", content: "first", answer: null, sources: null, care_level: null, raised_by_rules: null, rule_ids: [], reply_to: null, created_at: "1" },
    { id: "a1", role: "assistant", content: "x", answer, sources: [{ id: "S1", kind: "condition" }], care_level: "doctor", raised_by_rules: false, rule_ids: [], reply_to: "u1", created_at: "2" },
    { id: "u2", role: "user", content: "second", answer: null, sources: null, care_level: null, raised_by_rules: null, rule_ids: [], reply_to: null, created_at: "3" },
  ];
  const turns = turnsFromRows(rows);
  assert.deepEqual(turns.map((t) => [t.userText, t.status]), [["first", "done"], ["second", "stopped"]]);
  assert.equal(turns[0].fields.headline, "H");
  assert.equal(turns[0].messageId, "a1");
  assert.deepEqual([turns[0].steps.medlineplus, turns[0].steps.fda], ["done", "skipped"]);
  assert.equal(turns[0].sourcesArrived, true);
});

import { startEmail, verifyEmail, isEmailTaken } from "../lib/auth/upgrade.ts";
import { mailProviderFor } from "../lib/auth/mail-provider.ts";
import { shouldShowCareStrip, standingCareLevel } from "../lib/chat/care.ts";

function fakeAuth(overrides = {}) {
  const calls = [];
  const ok = { error: null };
  return {
    calls,
    updateUser: async (...args) => (calls.push(["updateUser", ...args]), overrides.updateUser ?? ok),
    signInWithOtp: async (...args) => (calls.push(["signInWithOtp", ...args]), overrides.signInWithOtp ?? ok),
    verifyOtp: async (...args) => (calls.push(["verifyOtp", ...args]), overrides.verifyOtp ?? ok),
  };
}

test("a guest who continues with email keeps the same account (the email is added, not a new user made)", async () => {
  const auth = fakeAuth();
  const started = await startEmail(auth, { email: " me@example.com ", isGuest: true, redirectTo: "https://app/cb" });
  assert.deepEqual(started, { ok: true, mode: "upgrade" });
  assert.deepEqual(auth.calls, [["updateUser", { email: "me@example.com" }, { emailRedirectTo: "https://app/cb" }]]);
  assert.equal(auth.calls.some((c) => c[0] === "signInWithOtp"), false, "no second account is created");
  await verifyEmail(auth, { email: "me@example.com", code: " 123456 ", mode: "upgrade" });
  assert.deepEqual(auth.calls.at(-1), ["verifyOtp", { email: "me@example.com", token: "123456", type: "email_change" }]);
});

test("someone who is not a guest signs in the normal way", async () => {
  const auth = fakeAuth();
  assert.deepEqual(await startEmail(auth, { email: "a@b.co", isGuest: false, redirectTo: "r" }), { ok: true, mode: "login" });
  assert.deepEqual(auth.calls[0], ["signInWithOtp", { email: "a@b.co", options: { shouldCreateUser: true, emailRedirectTo: "r" } }]);
  await verifyEmail(auth, { email: "a@b.co", code: "000000", mode: "login" });
  assert.equal(auth.calls.at(-1)[1].type, "email");
});

test("if the email already has an account the guest is told, and can choose to log in to it instead", async () => {
  const taken = fakeAuth({ updateUser: { error: { code: "email_exists", message: "A user with this email address has already been registered" } } });
  const started = await startEmail(taken, { email: "me@example.com", isGuest: true, redirectTo: "r" });
  assert.equal(started.ok, false);
  assert.equal(started.reason, "exists");
  const again = await startEmail(taken, { email: "me@example.com", isGuest: true, redirectTo: "r", forceLogin: true });
  assert.deepEqual(again, { ok: true, mode: "login" });
  assert.equal(taken.calls.filter((c) => c[0] === "signInWithOtp").length, 1);

  assert.equal(isEmailTaken({ message: "Email address already registered by another user" }), true);
  assert.equal(isEmailTaken({ code: "over_email_send_rate_limit" }), false);
  assert.equal(isEmailTaken(null), false);
  const limited = await startEmail(fakeAuth({ updateUser: { error: { code: "over_email_send_rate_limit" } } }), { email: "a@b.co", isGuest: true, redirectTo: "r" });
  assert.deepEqual([limited.ok, limited.reason], [false, "error"]);
});

test("security: a sign-in code is sent with a fresh CAPTCHA token; a guest adding an email needs none", async () => {
  let asked = 0;
  const captcha = async () => (asked += 1, `token-${asked}`);
  const auth = fakeAuth();
  await startEmail(auth, { email: "a@b.co", isGuest: false, redirectTo: "r", captcha });
  assert.deepEqual(auth.calls[0][1].options, { shouldCreateUser: true, emailRedirectTo: "r", captchaToken: "token-1" });

  const guest = fakeAuth();
  await startEmail(guest, { email: "a@b.co", isGuest: true, redirectTo: "r", captcha });
  assert.equal(asked, 1, "no token is used up for a guest adding an email");

  // The check fails (Cloudflare blocked or unsure): no code is sent, and the person gets the calm message.
  const blocked = fakeAuth();
  const failed = await startEmail(blocked, { email: "a@b.co", isGuest: false, redirectTo: "r", captcha: async () => { throw { code: "captcha_failed" }; } });
  assert.deepEqual([failed.ok, failed.error.code, blocked.calls.length], [false, "captcha_failed", 0]);

  // With the check switched off (no site key) nothing extra is sent.
  const off = fakeAuth();
  await startEmail(off, { email: "a@b.co", isGuest: false, redirectTo: "r", captcha: async () => undefined });
  assert.equal("captchaToken" in off.calls[0][1].options, false);
});

import { asksAboutPregnancy, cleanList, emptyHealth, hasAnyHealthAnswer, LIMITS, toHealthRow } from "../lib/onboarding/settings.ts";

test("health lists are cleaned to what the database accepts: trimmed, no repeats, capped", () => {
  assert.deepEqual(cleanList(["  Asthma ", "asthma", "", "Diabetes   type 2", "x".repeat(100)], 3).map((s) => s.length), [6, 15, 60]);
  assert.deepEqual(cleanList(["a", "b", "c", "d"], 2), ["a", "b"]);
  assert.equal(cleanList(Array.from({ length: 80 }, (_, i) => `m${i}`), LIMITS.medicines).length, 50);
  assert.deepEqual(cleanList([], 5), []);
});

test("the health row to save: unknown answers are dropped, pregnancy is not asked of men", () => {
  const row = toHealthRow({ age_range: "45-54", sex_at_birth: "male", pregnancy: "yes", conditions: ["Asthma", "asthma"], allergies: [], medicines: [" Metformin "] });
  assert.deepEqual(row, { age_range: "45-54", sex_at_birth: "male", pregnancy: "not_applicable", conditions: ["Asthma"], allergies: [], medicines: ["Metformin"] });
  const odd = toHealthRow({ age_range: "200", sex_at_birth: "alien", pregnancy: "maybe", conditions: [], allergies: [], medicines: [] });
  assert.deepEqual([odd.age_range, odd.sex_at_birth, odd.pregnancy], [null, null, null], "values the database would refuse are never sent");
  assert.equal(toHealthRow({ ...emptyHealth(), sex_at_birth: "female", pregnancy: "not_sure" }).pregnancy, "not_sure");
  assert.equal(asksAboutPregnancy("male"), false);
  assert.equal(asksAboutPregnancy(null), true);
  assert.equal(hasAnyHealthAnswer(emptyHealth()), false);
  assert.equal(hasAnyHealthAnswer({ ...emptyHealth(), allergies: ["Peanuts"] }), true);
});

import { groupByDay, displayTitle, filterByTitle, formatWhen, cleanTitle, isUrgent } from "../lib/history/group.ts";
import { buildExport, exportFileName, readAll } from "../lib/account/export.ts";
import { normalizeContent, normalizeSummary, newContent, summaryToText } from "../lib/summary/content.ts";
import { historyForServer } from "../lib/chat/history.ts";
import { newTurn } from "../lib/chat/reducer.ts";

test("history: grouped by the person's own days, newest first, searchable", () => {
  const now = new Date(2026, 9, 19, 15, 0);
  const at = (d, h) => new Date(2026, 9, d, h, 0).toISOString();
  const items = [
    { id: "a", title: "Headache", max_care_level: "selfcare", updated_at: at(19, 9) },
    { id: "b", title: null, max_care_level: "ambulance", updated_at: at(18, 22) },
    { id: "c", title: "Fever in my son", max_care_level: "doctor", updated_at: at(10, 8) },
    { id: "d", title: "Back pain", max_care_level: null, updated_at: at(19, 14) },
  ];
  const groups = groupByDay(items, now);
  assert.deepEqual(groups.map((g) => [g.label, g.items.map((i) => i.id)]), [["Today", ["d", "a"]], ["Yesterday", ["b"]], ["Earlier", ["c"]]]);
  assert.deepEqual(groupByDay([], now), [], "no empty groups");
  assert.equal(displayTitle(null), "Untitled chat");
  assert.equal(displayTitle("  Fever  "), "Fever");
  assert.deepEqual(filterByTitle(items, "fev").map((i) => i.id), ["c"]);
  assert.deepEqual(filterByTitle(items, "untitled").map((i) => i.id), ["b"]);
  assert.equal(formatWhen(at(18, 22), now), "Yesterday");
  assert.match(formatWhen(at(10, 8), now), /10/);
  assert.equal(isUrgent("ambulance"), true);
  assert.equal(isUrgent("doctor24"), false);
  assert.equal(cleanTitle("  a   b  "), "a b");
  assert.equal(cleanTitle("x".repeat(200)).length, 120);
});

test("export: everything in one file, with counts, read a page at a time", async () => {
  const file = buildExport({ user: { id: "u", email: null, guest: true }, profile: {}, health_profile: null, consents: [1], conversations: [1, 2], messages: [1, 2, 3], summaries: [], feedback: [] }, new Date("2026-10-19T10:00:00Z"));
  assert.equal(file.format, "health-chat-helper-export");
  assert.deepEqual(file.counts, { conversations: 2, messages: 3, summaries: 0, feedback: 0 });
  assert.equal(exportFileName(new Date(2026, 9, 9)), "hale-export-2026-10-09.json");
  const pages = [];
  const rows = await readAll(async (from, to) => {
    pages.push([from, to]);
    return { data: Array.from({ length: from === 0 ? 3 : 1 }, (_, i) => from + i), error: null };
  }, 3);
  assert.deepEqual(rows, [0, 1, 2, 3]);
  assert.deepEqual(pages, [[0, 2], [3, 5]]);
  await assert.rejects(readAll(async () => ({ data: null, error: { message: "denied" } })), /denied/);
});

test("summary content: whatever is stored is read safely; copy text follows the printed order", () => {
  const messy = normalizeSummary({ title: "", reason_for_visit: "  Headache   for 3 days ", timeline: [{ when: "Sat", what: "Started" }, { when: "", what: "" }, "junk"], details: [{ label: "Severity", value: "6 of 10" }], medicines_and_allergies: ["Crocin", 5, ""], warning_signs: { present: ["Light hurts"], not_present: ["Fever"] }, questions: ["Is it a migraine?"], extra: "ignored" });
  assert.equal(messy.title, "Visit summary");
  assert.equal(messy.reason_for_visit, "Headache for 3 days");
  assert.deepEqual(messy.timeline, [{ when: "Sat", what: "Started" }]);
  assert.deepEqual(messy.medicines_and_allergies, ["Crocin"]);
  assert.equal("extra" in messy, false);
  assert.deepEqual(normalizeSummary(null).timeline, []);

  const content = newContent(messy, ["c1"], "2026-10-19T18:12:00.000Z", false);
  content.for_name = "Asha";
  content.notes = "Ask about sleep";
  const text = summaryToText(content);
  assert.match(text, /^Visit summary\nPrepared .* · For: Asha/);
  assert.ok(text.indexOf("Why I'm seeing you") < text.indexOf("What's been happening"));
  assert.match(text, /Present: Light hurts\nNot present: Fever/);
  assert.match(text, /\[ \] Is it a migraine\?/);
  assert.match(text, /My notes\nAsk about sleep/);
  assert.match(text, /Not a medical record or a diagnosis\.$/);
  const stored = normalizeContent(JSON.parse(JSON.stringify(content)));
  assert.deepEqual(stored, content, "what is saved reads back the same");
  assert.equal(normalizeContent({ prepared_at: "nonsense" }).prepared_at, new Date(0).toISOString());
});

test("when chats are not saved, the browser sends the recent turns itself", () => {
  const a = { ...newTurn("a", "I have a headache"), fields: { headline: "Most are mild.", summary: "Rest helps." } };
  const b = newTurn("b", "and now a fever");
  assert.deepEqual(historyForServer([a, b], "b"), [
    { role: "user", text: "I have a headache" },
    { role: "assistant", text: "Most are mild. Rest helps." },
  ]);
  const many = Array.from({ length: 10 }, (_, i) => ({ ...newTurn(`t${i}`, `q${i}`), fields: { headline: `h${i}` } }));
  assert.equal(historyForServer(many, "none").length, 12, "at most 12 items");
});

test("open-your-inbox shortcut: known providers by address, nothing for the rest", () => {
  assert.equal(mailProviderFor("Asha@Gmail.com ")?.name, "Gmail");
  assert.equal(mailProviderFor("a@googlemail.com")?.name, "Gmail");
  assert.equal(mailProviderFor("a@hotmail.co.uk")?.name, "Outlook");
  assert.equal(mailProviderFor("a@yahoo.in")?.name, "Yahoo Mail");
  assert.equal(mailProviderFor("a@icloud.com")?.url, "https://www.icloud.com/mail");
  assert.equal(mailProviderFor("a@company.example"), null);
  assert.equal(mailProviderFor("a@notgmail.com"), null);
  assert.equal(mailProviderFor("not an email"), null);
});

test("care strip: first answer, a rise, and every emergency; never a repeat", () => {
  // first answer with a level
  assert.equal(shouldShowCareStrip("doctor24", undefined), true);
  // the founder's case: "hii" and a profile question after a "see a doctor today" answer
  assert.equal(shouldShowCareStrip("doctor24", "doctor24"), false);
  // the level went up
  assert.equal(shouldShowCareStrip("doctor24", "doctor"), true);
  assert.equal(shouldShowCareStrip("doctor", "selfcare"), true);
  // lower or equal non-urgent: nothing new to say
  assert.equal(shouldShowCareStrip("selfcare", "doctor"), false);
  // emergencies always show, even repeated
  assert.equal(shouldShowCareStrip("emergency", "emergency"), true);
  assert.equal(shouldShowCareStrip("ambulance", "ambulance"), true);
  // no level, no strip
  assert.equal(shouldShowCareStrip(undefined, "doctor"), false);
  // the standing advice is the highest level already given, skipping answers with none (an error, a stopped turn)
  assert.equal(standingCareLevel(["doctor", undefined, undefined], 2), "doctor");
  assert.equal(standingCareLevel(["doctor24", "selfcare", "doctor"], 3), "doctor24");
  assert.equal(standingCareLevel([undefined], 0), undefined);
  // seen live: "See a doctor soon", then "hii" came back as "Care at home": not shown (it would read as "it's fine now")
  assert.equal(shouldShowCareStrip("selfcare", standingCareLevel(["doctor"], 1)), false);
  // and a later rise above the standing advice shows again
  assert.equal(shouldShowCareStrip("doctor24", standingCareLevel(["doctor", "selfcare"], 2)), true);
});

test("what Nox used: counts in plain words, nothing when nothing was used", async () => {
  const { usedLine } = await import("../lib/chat/format.ts");
  assert.equal(usedLine({ profile: true, labs: 3, diary: 1, past: 2 }), "Nox used: your profile · 3 blood results · 1 diary entry · 2 earlier chats");
  assert.equal(usedLine({ profile: true, labs: 0, diary: 0, past: 0, food: 4 }), "Nox used: your profile · 4 meals");
  assert.equal(usedLine({ profile: false, labs: 0, diary: 0, past: 1 }), "Nox used: 1 earlier chat");
  assert.equal(usedLine({ profile: false, labs: 0, diary: 0, past: 0 }), null);
  assert.equal(usedLine(null), null);
  assert.equal(usedLine(undefined), null);
});

test("bug review 2026-10-20: a reopened chat shows the crisis presentation when the model noticed the crisis", () => {
  const row = (id, role, extra = {}) => ({ id, role, content: "x", answer: null, sources: null, care_level: null, raised_by_rules: null, rule_ids: [], reply_to: null, created_at: id, ...extra });
  const turns = turnsFromRows([
    row("u1", "user"),
    row("a1", "assistant", { answer: { headline: "H", care_level: "ambulance" }, care_level: "ambulance", rule_ids: ["model-crisis"], reply_to: "u1" }),
  ]);
  assert.equal(turns[0].redFlag?.crisis, true);
});

test("bug review 2026-10-20: a reopened question keeps the id it was sent with, so Ask again is a true retry", () => {
  const turns = turnsFromRows([
    { id: "row-1", client_message_id: "sent-1", role: "user", content: "q", answer: null, sources: null, care_level: null, raised_by_rules: null, rule_ids: [], reply_to: null, created_at: "1" },
    { id: "row-2", role: "user", content: "old row without one", answer: null, sources: null, care_level: null, raised_by_rules: null, rule_ids: [], reply_to: null, created_at: "2" },
  ]);
  assert.deepEqual(turns.map((t) => t.id), ["sent-1", "row-2"]);
});
