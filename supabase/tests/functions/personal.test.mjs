// Personal doctor v1 (DESIGN.md 8.6b): the name, the saved profile and blood results, and everyday medicines.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createChatHandler } from "../../functions/_shared/chat.ts";
import { otcOptions, matchOtc, OTC_MEDICINES } from "../../functions/_shared/otc.ts";
import { cleanField, newCleanContext } from "../../functions/_shared/answer.ts";
import { computeFloor } from "../../functions/_shared/care.ts";
import { keywordExtraction } from "../../functions/_shared/extract.ts";
import { buildAnswerMessage, bloodLines, consultationLines, diaryLines, foodLines } from "../../functions/_shared/prompt.ts";
import { hasDoseOrSchedule } from "../../functions/_shared/dose.ts";
import { chatRequest, createMemoryRepo, eventsNamed, fieldsOf, goodAnswer, makeDeps, readSse, scriptedLlm, standardInternet, turnBody } from "./support.mjs";

async function run(deps, body) {
  const response = await createChatHandler(deps)(chatRequest(body));
  const events = await readSse(response);
  await Promise.all(deps.background);
  return { events, fields: fieldsOf(events) };
}
const profile = (extra = {}) => ({ age_range: "25-34", sex_at_birth: "male", pregnancy: "not_applicable", conditions: [], allergies: [], medicines: [], ...extra });
const ids = (options) => options.offered.map((item) => item.id);
const headacheExtract = { language: "en", topics: ["headache"], drugs: [], who_for: "self", age_hint: null, safety_flags: [] };

// ---------------------------------------------------------------------------
// Which everyday medicines may be suggested
// ---------------------------------------------------------------------------
test("everyday medicines: matched to the problem, at most three, one antihistamine", () => {
  assert.deepEqual(ids(otcOptions({ text: "Headache since morning", whoFor: "self", profile: profile() })), ["paracetamol", "ibuprofen"]);
  // Found by this test: "hay fever" is an allergy, not a fever, so no paracetamol or ibuprofen.
  assert.deepEqual(ids(otcOptions({ text: "sneezing and a runny nose, hay fever", whoFor: "self", profile: profile() })), ["cetirizine", "saline_nasal"]);
  assert.deepEqual(ids(otcOptions({ text: "acidity and heartburn after dinner", whoFor: "self", profile: null })), ["antacid"]);
  assert.deepEqual(otcOptions({ text: "I feel great", whoFor: "self", profile: profile() }).offered, []);
  for (const medicine of OTC_MEDICINES) {
    assert.equal(hasDoseOrSchedule(medicine.note.en), false, `${medicine.id}: our own wording never states an amount`);
    assert.doesNotMatch(medicine.note.en, /\d/, `${medicine.id}: no numbers at all`);
  }
});

test("everyday medicines: the profile rules things out, and says why", () => {
  const kidney = otcOptions({ text: "back pain", whoFor: "self", profile: profile({ conditions: ["Kidney disease"] }) });
  assert.deepEqual(ids(kidney), ["paracetamol"]);
  assert.deepEqual(kidney.blocked.map((item) => [item.id, item.reason]), [["ibuprofen", "Kidney disease in their profile"]]);

  assert.deepEqual(ids(otcOptions({ text: "headache", whoFor: "self", profile: profile({ allergies: ["Aspirin or ibuprofen"] }) })), ["paracetamol"]);
  assert.deepEqual(ids(otcOptions({ text: "headache", whoFor: "self", profile: profile({ medicines: ["Warfarin"] }) })), ["paracetamol"]);
  assert.deepEqual(ids(otcOptions({ text: "headache", whoFor: "self", profile: profile({ age_range: "75+" }) })), ["paracetamol"], "no ibuprofen from 65");
  assert.deepEqual(ids(otcOptions({ text: "headache", whoFor: "self", profile: profile({ alcohol: "regular" }) })), ["ibuprofen"], "no paracetamol with regular alcohol");
  assert.deepEqual(ids(otcOptions({ text: "headache", whoFor: "self", profile: profile({ conditions: ["Fatty liver"] }) })), [], "liver disease rules out both");
  assert.deepEqual(ids(otcOptions({ text: "itchy hives", whoFor: "self", profile: profile({ conditions: ["Kidney disease"] }) })), ["loratadine", "calamine"], "loratadine steps in when cetirizine doesn't suit");
});

test("everyday medicines: none for a child, in pregnancy, or for someone else", () => {
  for (const [whoFor, extra, words] of [
    ["child", {}, /child/],
    ["baby", {}, /child/],
    ["self", { pregnancy: "yes", sex_at_birth: "female" }, /pregnancy/],
    ["self", { pregnancy: "not_sure", sex_at_birth: "female" }, /pregnancy/],
    ["pregnant", {}, /pregnancy/],
    ["someone_else", {}, /someone else/],
  ]) {
    const options = otcOptions({ text: "fever", whoFor, profile: profile(extra) });
    assert.deepEqual(options.offered, [], `${whoFor} ${JSON.stringify(extra)}`);
    assert.match(options.none ?? "", words);
  }
});

test("a name the model writes is matched as whole words only", () => {
  const offered = otcOptions({ text: "athlete's foot and a headache", whoFor: "self", profile: profile() }).offered;
  assert.equal(matchOtc("Crocin 650", offered)?.id, "paracetamol");
  assert.equal(matchOtc("Clotrimazole cream (Candid)", offered)?.id, "clotrimazole");
  assert.equal(matchOtc("a candidate medicine", offered), undefined);
  assert.equal(matchOtc("Azithromycin", offered), undefined);
});

// ---------------------------------------------------------------------------
// The answer cleaner
// ---------------------------------------------------------------------------
function ctxFor({ otc, drugNames = [], level = null } = {}) {
  const floor = computeFloor(level === "emergency" ? "I have crushing chest pain" : "headache", [], []);
  return newCleanContext({ sources: [], floor, language: "en", mode: "normal", drugNames, drugSources: [], otc });
}

test("cleaner: only offered everyday medicines, in our words, never an amount", () => {
  const otc = otcOptions({ text: "headache", whoFor: "self", profile: profile() });
  const out = cleanField("medicines", [
    { name: "Paracetamol", note: "Take 650 mg every 6 hours", source_ids: [] },
    { name: "Azithromycin", note: "An antibiotic", source_ids: [] },
    { name: "Naproxen", note: "Another painkiller", source_ids: [] },
  ], ctxFor({ otc }));
  assert.deepEqual(out.map((item) => [item.name, item.kind]), [["Paracetamol", "otc"]]);
  assert.doesNotMatch(out[0].note, /650|6 hours/);
  assert.match(out[0].note, /dose on the pack/);
});

test("cleaner: nothing when no medicine may be suggested, and nothing in an emergency", () => {
  const none = otcOptions({ text: "fever", whoFor: "child", profile: null });
  assert.deepEqual(cleanField("medicines", [{ name: "Paracetamol", note: "x", source_ids: [] }], ctxFor({ otc: none })), []);
  const otc = otcOptions({ text: "chest pain", whoFor: "self", profile: profile() });
  assert.deepEqual(cleanField("medicines", [{ name: "Paracetamol", note: "x", source_ids: [] }], ctxFor({ otc, level: "emergency" })), []);
});

test("cleaner: a medicine the person named that their profile rules out gets a plain warning", () => {
  const otc = otcOptions({ text: "can I take brufen for my back pain", whoFor: "self", profile: profile({ conditions: ["Stomach ulcer"] }) });
  const out = cleanField("medicines", [{ name: "Brufen", note: "Ibuprofen helps back pain.", source_ids: [] }], ctxFor({ otc, drugNames: [{ asWritten: "brufen", generic: "ibuprofen" }] }));
  assert.equal(out.length, 1);
  assert.match(out[0].note, /Because of Stomach ulcer in their profile, ask a pharmacist or your doctor/);
  assert.equal(out[0].kind, undefined, "it's the person's own medicine, not a suggestion");
});

// ---------------------------------------------------------------------------
// What the model is told
// ---------------------------------------------------------------------------
test("prompt: the name as a placeholder, the full profile, blood results and the medicine options", () => {
  const otc = otcOptions({ text: "headache", whoFor: "self", profile: profile({ conditions: ["Kidney disease"] }) });
  const text = buildAnswerMessage({
    message: "I have a headache",
    history: [],
    extraction: keywordExtraction("I have a headache", ""),
    floor: computeFloor("I have a headache", [], []),
    sources: [],
    profile: profile({ conditions: ["Kidney disease"], height_cm: "175.0", weight_kg: "70.0", smoking: "never", family_history: ["Diabetes"] }),
    unlabelled: [],
    language: "en",
    name: "[NAME_1]",
    labs: [
      { marker: "vitamin_d", label: null, value: "14.000", unit: "ng/mL", test_date: "2026-09-01" },
      { marker: "vitamin_d", label: null, value: "9.000", unit: "ng/mL", test_date: "2026-01-01" },
    ],
    otc,
  });
  assert.match(text, /the person's name \(address them by it, rule 13\): \[NAME_1\]/);
  assert.match(text, /height: 175 cm/);
  assert.match(text, /BMI: 22\.9/);
  assert.match(text, /family history: Diabetes/);
  assert.match(text, /Vitamin D \(25-OH\): 14 ng\/mL on 2026-09-01, below the usual range \(30–100 ng\/mL\)/);
  assert.doesNotMatch(text, /9 ng\/mL/, "only the newest value of each marker");
  assert.match(text, /<otc_options>[\s\S]*- Paracetamol: for fever and mild to moderate pain[\s\S]*Not suitable[\s\S]*- Ibuprofen: Kidney disease in their profile/);
});

test("prompt: no medicine at all says so, and blood lines are empty without results", () => {
  const text = buildAnswerMessage({
    message: "my son has a fever", history: [], extraction: keywordExtraction("my son has a fever", ""), floor: computeFloor("my son has a fever", [], []),
    sources: [], profile: null, unlabelled: [], language: "en", otc: otcOptions({ text: "fever", whoFor: "child", profile: null }),
  });
  assert.match(text, /<otc_options>\nDo not suggest any medicine: it is for a child/);
  assert.deepEqual(bloodLines([], "male"), []);
});

// ---------------------------------------------------------------------------
// A whole turn
// ---------------------------------------------------------------------------
test("a turn: Nox greets the person by name, and a label joins the sources only when its medicine is suggested", async () => {
  const reply = goodAnswer({
    summary: "[NAME_1], most headaches like this ease with rest and water.",
    medicines: [{ name: "Paracetamol", note: "whatever the model says", source_ids: [] }],
  });
  const llm = scriptedLlm({ reply, extractReply: headacheExtract });
  const repo = createMemoryRepo({ profile: { display_name: "Raunak Jain" }, health: profile() });
  const deps = makeDeps({ llm, repo, fetch: standardInternet() });
  const { events, fields } = await run(deps, turnBody("I have had a headache since morning"));

  const sent = JSON.stringify(llm.calls.stream.map((call) => call.messages));
  assert.equal(sent.includes("Raunak"), false, "the name never reaches the AI");
  assert.match(fields.summary, /^Raunak, most headaches/);

  const medicine = fields.medicines[0];
  assert.equal(medicine.kind, "otc");
  assert.equal(medicine.source_ids.length, 1, "the paracetamol label is its source");
  const lists = eventsNamed(events, "sources");
  assert.equal(lists.length, 2, "first without the label, then with it once it is used");
  assert.ok(lists[1].some((source) => source.id === medicine.source_ids[0]));
  assert.ok(deps.repo.state.messages[1].sources.some((source) => source.id === medicine.source_ids[0]), "saved with the label");
});

test("a turn: a name saved in lower case still starts a sentence with a capital", async () => {
  const reply = goodAnswer({ headline: "[NAME_1], tell me the medicine's name.", summary: "Thanks. [NAME_1] is a lovely name; rest well, [NAME_1]." });
  const llm = scriptedLlm({ reply, extractReply: headacheExtract });
  const repo = createMemoryRepo({ profile: { display_name: "raunak" }, health: profile() });
  const { fields } = await run(makeDeps({ llm, repo, fetch: standardInternet() }), turnBody("I have a question about a medicine"));
  assert.equal(fields.headline, "Raunak, tell me the medicine's name.");
  assert.equal(fields.summary, "Thanks. Raunak is a lovely name; rest well, raunak.", "only at the start of a sentence");
});

test("a turn's history keeps the questions Nox asked, so a short reply is understood", async () => {
  const { digest } = await import("../../functions/_shared/answer.ts");
  assert.equal(digest({ headline: "Which medicine?", summary: "Tell me a little more.", questions_for_you: ["Which medicine is it?", "Do you take it now?"] }), "Which medicine? Tell me a little more. I asked: Which medicine is it? Do you take it now?");
  assert.equal(digest({ headline: "Rest helps.", summary: "Most headaches pass.", questions_for_you: [] }), "Rest helps. Most headaches pass.");
});

test("a turn: blood results reach the model only when the person allows their profile in answers", async () => {
  const labs = [{ marker: "vitamin_b12", label: null, value: 150, unit: "pg/mL", test_date: "2026-08-01" }];
  for (const allow of [true, false]) {
    const llm = scriptedLlm({ reply: goodAnswer(), extractReply: headacheExtract });
    const repo = createMemoryRepo({ profile: { use_profile_in_answers: allow }, health: profile(), labs });
    await run(makeDeps({ llm, repo }), turnBody("I feel tired all the time"));
    const sent = JSON.stringify(llm.calls.stream.map((call) => call.messages));
    assert.equal(/Vitamin B12: 150 pg\/mL/.test(sent), allow, `allowed: ${allow}`);
  }
});

// ---------------------------------------------------------------------------
// Follow-ups, like a doctor (DESIGN.md 7.6): the warning signs are given once, not with every reply
// ---------------------------------------------------------------------------
const followUpReply = (extra = {}) =>
  goodAnswer({
    emergency_if: [{ text: "You have a stiff neck with a high fever.", source_ids: [] }],
    questions_for_doctor: ["Could this be a migraine?"],
    ...extra,
  });
const earlier = [
  { role: "user", text: "I have had a headache since this morning" },
  { role: "assistant", text: "Most headaches like this ease with rest and water." },
];
const replyTurn = async (text, { reply = followUpReply(), extract = headacheExtract, history = earlier } = {}) => {
  const llm = scriptedLlm({ reply, extractReply: extract });
  const { fields } = await run(makeDeps({ llm }), turnBody(text, { options: { save: false }, history, conversation_id: null }));
  return { fields, sent: JSON.stringify(llm.calls.stream.map((call) => call.messages)) };
};

test("follow-up: the same problem gets no repeated warning signs or doctor questions", async () => {
  const { fields, sent } = await replyTurn("It started at 8 and it's a dull ache behind my eyes");
  assert.deepEqual(fields.emergency_if, []);
  assert.deepEqual(fields.questions_for_doctor, []);
  assert.match(sent, /reply type: follow-up \(rule 16\)/);
});

test("follow-up: the first answer about a problem keeps its warning signs", async () => {
  const { fields, sent } = await replyTurn("I have had a headache since this morning", { history: [] });
  assert.equal(fields.emergency_if.length, 1);
  assert.doesNotMatch(sent, /reply type: follow-up \(rule 16\)/, "the context doesn't call it a follow-up");
});

test("follow-up: a new problem, a danger sign or a higher level brings the warning signs back", async () => {
  const rash = await replyTurn("Now I also have an itchy rash on my arms", { extract: { ...headacheExtract, topics: ["rash"] } });
  assert.equal(rash.fields.emergency_if.length, 1, "a new problem");
  assert.doesNotMatch(rash.sent, /reply type: follow-up \(rule 16\)/);

  const chest = await replyTurn("and now I have crushing chest pain going into my left arm");
  assert.ok(chest.fields.emergency_if.length >= 1, "the safety rules found a danger sign");

  const higher = await replyTurn("it's getting worse every hour", { reply: followUpReply({ care_level: "doctor24" }) });
  assert.equal(higher.fields.emergency_if.length, 1, "the care level went up");
});

// ---------------------------------------------------------------------------
// The health diary (DESIGN.md 8.6c)
// ---------------------------------------------------------------------------
test("diary: short lines for Nox, newest first, at most twelve", () => {
  const lines = diaryLines([
    { logged_at: "2026-10-19T08:10:00Z", symptom: "Fever", severity: 6, temperature_c: "38.2", feeling: "worse", note: "Woke up shivering" },
    { logged_at: "2026-10-18T20:00:00Z", symptom: null, severity: null, temperature_c: null, feeling: "same", note: null },
  ]);
  // India time (bug review 2026-10-20): 08:10 UTC is 13:40 in India, and 20:00 UTC on the 18th is 01:30 on the 19th.
  assert.deepEqual(lines, ['2026-10-19 13:40: Fever, 6/10, 38.2°C, feeling worse, note: "Woke up shivering"', "2026-10-19 01:30: feeling about the same"]);
  assert.equal(diaryLines(Array.from({ length: 20 }, () => ({ logged_at: "2026-10-19T08:00:00Z", symptom: "x", severity: null, temperature_c: null, feeling: null, note: null }))).length, 12);
});

test("diary: home readings reach Nox as plain numbers", () => {
  const lines = diaryLines([
    { logged_at: "2026-10-19T07:30:00Z", symptom: null, severity: null, temperature_c: null, feeling: null, note: null, bp_systolic: 148, bp_diastolic: 94, pulse: 80 },
    { logged_at: "2026-10-19T07:00:00Z", symptom: null, severity: null, temperature_c: null, feeling: null, note: null, glucose_mgdl: 132, glucose_timing: "fasting" },
    { logged_at: "2026-10-18T07:00:00Z", symptom: null, severity: null, temperature_c: null, feeling: null, note: null, weight_kg: "72.4" },
  ]);
  assert.deepEqual(lines, [
    "2026-10-19 13:00: blood pressure 148/94 mmHg, pulse 80",
    "2026-10-19 12:30: blood sugar 132 mg/dL fasting",
    "2026-10-18 12:30: weight 72.4 kg",
  ]);
});

test("diary: reaches Nox only when allowed, and names in it never reach the AI", async () => {
  const diary = [{ logged_at: "2026-10-19T08:10:00Z", symptom: "Fever", severity: 6, temperature_c: "38.2", feeling: "worse", note: "Raunak's mum says it is worse at night" }];
  for (const allow of [true, false]) {
    const llm = scriptedLlm({ reply: goodAnswer(), extractReply: headacheExtract });
    const repo = createMemoryRepo({ profile: { display_name: "Raunak Jain", use_profile_in_answers: allow }, health: profile(), diary });
    await run(makeDeps({ llm, repo }), turnBody("I still have a headache"));
    const sent = JSON.stringify(llm.calls.stream.map((call) => call.messages));
    assert.equal(/<health_diary>[\s\S]*Fever, 6\/10, 38\.2°C, feeling worse/.test(sent), allow, `allowed: ${allow}`);
    assert.equal(sent.includes("Raunak"), false, "the name in a note is hidden");
  }
});

// ---------------------------------------------------------------------------
// Earlier consultations: Nox remembers past visits (DESIGN.md 8.6f, rule 17)
// ---------------------------------------------------------------------------
test("earlier consultations: short lines with when, what, the advice then and the last check-in", () => {
  const now = Date.parse("2026-10-19T12:00:00Z");
  const lines = consultationLines([
    { id: "a", title: "Fever and headache", max_care_level: "doctor24", updated_at: "2026-10-18T09:00:00Z", check_in: { feeling: "better", logged_at: "2026-10-19T08:00:00Z" } },
    { id: "b", title: null, max_care_level: "selfcare", updated_at: "2026-10-05T09:00:00Z", check_in: null },
  ], now);
  assert.deepEqual(lines, [
    "2026-10-18 (yesterday): Fever and headache; your advice then: see a doctor within 24 hours; they checked in today: better",
    "2026-10-05 (14 days ago): a health question; your advice then: care at home",
  ]);
  assert.deepEqual(consultationLines([], now), []);
});

test("earlier consultations reach Nox only when allowed, never this chat, and titles are hidden like messages", async () => {
  const past = [
    { id: "old-1", title: "Raunak's back pain", max_care_level: "doctor", updated_at: "2026-10-10T09:00:00Z", check_in: { feeling: "same", logged_at: "2026-10-12T09:00:00Z" } },
  ];
  for (const allow of [true, false]) {
    const llm = scriptedLlm({ reply: goodAnswer(), extractReply: headacheExtract });
    const repo = createMemoryRepo({ profile: { display_name: "Raunak Jain", use_profile_in_answers: allow }, health: profile(), past });
    await run(makeDeps({ llm, repo, fetch: standardInternet() }), turnBody("my back hurts again"));
    const sent = JSON.stringify(llm.calls.stream.map((call) => call.messages));
    assert.equal(sent.includes("This person's other recent chats with you"), allow, `shown only when allowed (${allow})`);
    assert.equal(sent.includes("Raunak"), false, "the name in a title never reaches the AI");
    if (allow) assert.match(sent, /back pain; your advice then: see a doctor in the next few days; they checked in [^:]+: about the same/);
  }
});

test("the done event says what Nox used, as counts only", async () => {
  const past = [{ id: "old-1", title: "Back pain", max_care_level: "doctor", updated_at: "2026-10-10T09:00:00Z", check_in: null }];
  const diary = [{ logged_at: "2026-10-19T08:10:00Z", symptom: "Fever", severity: 6, temperature_c: "38.2", feeling: "worse", note: null }];
  const llm = scriptedLlm({ reply: goodAnswer(), extractReply: headacheExtract });
  const repo = createMemoryRepo({ profile: { display_name: "Raunak Jain" }, health: profile(), diary, past });
  const { events } = await run(makeDeps({ llm, repo, fetch: standardInternet() }), turnBody("I have had a headache since morning"));
  const done = eventsNamed(events, "done")[0];
  assert.deepEqual(done.used, { profile: true, labs: 0, diary: 1, past: 1, food: 0 });
});

// ---------------------------------------------------------------------------
// Nox proposes, the person decides: additions to the profile (DESIGN.md 8.6f, rule 20)
// ---------------------------------------------------------------------------
test("profile updates: at most two, three lists only, never a hidden detail or what's already saved", async () => {
  const reply = goodAnswer({
    profile_updates: [
      { list: "medicines", item: "amlodipine" },
      { list: "medicines", item: "Levetiracetam" },
      { list: "allergies", item: "[NAME_1]" },
      { list: "habits", item: "smoking" },
      { list: "conditions", item: "High blood pressure" },
      { list: "conditions", item: "Asthma" },
    ],
  });
  const llm = scriptedLlm({ reply, extractReply: headacheExtract });
  const repo = createMemoryRepo({ profile: { display_name: "Raunak Jain" }, health: profile({ medicines: ["levetiracetam"] }) });
  const { fields } = await run(makeDeps({ llm, repo, fetch: standardInternet() }), turnBody("I take amlodipine for my blood pressure and I have a headache"));
  assert.deepEqual(fields.profile_updates, [
    { list: "medicines", item: "Amlodipine" },
    { list: "conditions", item: "High blood pressure" },
  ], "the saved Levetiracetam, the hidden name and the unknown list are dropped; two at most");
});

test("profile updates: none for guests, none when the profile is off, none in an emergency", async () => {
  const reply = goodAnswer({ profile_updates: [{ list: "medicines", item: "Amlodipine" }] });
  const off = createMemoryRepo({ profile: { use_profile_in_answers: false }, health: profile() });
  const a = await run(makeDeps({ llm: scriptedLlm({ reply, extractReply: headacheExtract }), repo: off, fetch: standardInternet() }), turnBody("I take amlodipine"));
  assert.deepEqual(a.fields.profile_updates, [], "profile off");
  const urgent = goodAnswer({ care_level: "ambulance", profile_updates: [{ list: "medicines", item: "Amlodipine" }] });
  const b = await run(makeDeps({ llm: scriptedLlm({ reply: urgent, extractReply: headacheExtract }), repo: createMemoryRepo({ health: profile() }), fetch: standardInternet() }), turnBody("I take amlodipine"));
  assert.deepEqual(b.fields.profile_updates, [], "emergency");
});

// ---------------------------------------------------------------------------
// Thali: what the person ate (DESIGN.md 8.6g, rule 21)
// ---------------------------------------------------------------------------
test("thali: one short line per meal, then water", () => {
  const lines = foodLines({
    meals: [
      { day: "2026-10-19", meal: "lunch", items: ["Dal", "Rice"], portion: "heavy", outside: true, note: "very spicy" },
      { day: "2026-10-19", meal: "breakfast", items: [], portion: null, outside: false, note: "skipped" },
    ],
    water: [{ day: "2026-10-19", glasses: 1 }, { day: "2026-10-18", glasses: 6 }],
  });
  assert.deepEqual(lines, [
    '2026-10-19 lunch: Dal, Rice (heavy, outside food); note: "very spicy"',
    '2026-10-19 breakfast: (no items); note: "skipped"',
    "2026-10-19 water: 1 glass",
    "2026-10-18 water: 6 glasses",
  ]);
  assert.deepEqual(foodLines(undefined), []);
});

test("thali reaches Nox only when allowed, names in it never reach the AI, and the used line counts meals", async () => {
  const food = { meals: [{ day: "2026-10-18", meal: "dinner", items: ["Biryani from Raunak's place"], portion: "heavy", outside: true, note: null }], water: [{ day: "2026-10-18", glasses: 3 }] };
  for (const allow of [true, false]) {
    const llm = scriptedLlm({ reply: goodAnswer(), extractReply: headacheExtract });
    const repo = createMemoryRepo({ profile: { display_name: "Raunak Jain", use_profile_in_answers: allow }, health: profile(), food });
    const { events } = await run(makeDeps({ llm, repo, fetch: standardInternet() }), turnBody("my stomach hurts since last night"));
    const sent = JSON.stringify(llm.calls.stream.map((call) => call.messages));
    assert.equal(sent.includes("What the person ate, last 3 days"), allow, `shown only when allowed (${allow})`);
    assert.equal(sent.includes("Raunak"), false, "a name in a food item never reaches the AI");
    if (allow) {
      assert.match(sent, /2026-10-18 dinner: Biryani from \[NAME_\d\]'s place \(heavy, outside food\)/);
      assert.equal(eventsNamed(events, "done")[0].used.food, 1);
    }
  }
});

test("bug review 2026-10-20: profile items in the 'not suitable' lines are hidden from the AI too", async () => {
  const llm = scriptedLlm({ reply: goodAnswer(), extractReply: headacheExtract });
  const repo = createMemoryRepo({ profile: { display_name: "Asha Kulkarni" }, health: profile({ allergies: ["Ibuprofen - Asha Kulkarni"], medicines: ["Warfarin, Dr Rao 98765 43210"] }) });
  const deps = makeDeps({ llm, repo, fetch: standardInternet() });
  await run(deps, turnBody("I have had a headache since morning"));
  const prompt = llm.calls.stream[0].messages[1].content;
  assert.match(prompt, /Not suitable for this person/);
  assert.doesNotMatch(prompt, /Asha|Kulkarni|98765/);
});

test("bug review 2026-10-20: a name given with 'my name is' is hidden in Nox's earlier replies on the next turn", async () => {
  const llm = scriptedLlm({ reply: goodAnswer({ summary: "[NAME_1], rest and drink water." }), extractReply: headacheExtract });
  const deps = makeDeps({ llm, fetch: standardInternet() });
  await run(deps, turnBody("Hi, my name is Raunak and I have a headache", { client_message_id: "00000000-0000-4000-8000-000000000101" }));
  await run(deps, turnBody("it is worse now", { client_message_id: "00000000-0000-4000-8000-000000000102" }));
  const second = JSON.stringify(llm.calls.stream[1].messages);
  assert.equal(second.includes("Raunak"), false, "neither the person's words nor Nox's saved reply carry the name");
  assert.match(second, /\[NAME_1\]/);
});

test("bug review 2026-10-20: earlier chats are dated by India calendar day", () => {
  // Seen at 09:30 in India on 20 Oct; the chat was at 22:30 the evening before.
  const now = Date.parse("2026-10-20T04:00:00Z");
  const [line] = consultationLines([{ id: "a", title: "Fever", max_care_level: "doctor", updated_at: "2026-10-19T17:00:00Z", check_in: null }], now);
  assert.match(line, /^2026-10-19 \(yesterday\): Fever/);
});
