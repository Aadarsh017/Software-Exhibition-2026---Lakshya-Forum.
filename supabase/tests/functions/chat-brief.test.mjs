// Short replies (PLAN.md §12, 2026-10-19): a greeting or a small question in an ongoing chat gets a headline and one
// or two sentences, not the whole answer again. The safety rules decide first and are unchanged.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createChatHandler } from "../../functions/_shared/chat.ts";
import { assemble, cleanField, newCleanContext } from "../../functions/_shared/answer.ts";
import { computeFloor } from "../../functions/_shared/care.ts";
import { isSmallTalk } from "../../functions/_shared/extract.ts";
import { chatRequest, createMemoryRepo, eventsNamed, fieldsOf, goodAnswer, makeDeps, readSse, scriptedLlm, standardInternet, turnBody, uuid } from "./support.mjs";

async function run(deps, body) {
  const response = await createChatHandler(deps)(chatRequest(body));
  const events = await readSse(response);
  await Promise.all(deps.background);
  return { events, fields: fieldsOf(events) };
}

const FEVER = "I have had a fever and a headache since yesterday";
const SECTIONS = ["likely_causes", "try_tonight", "see_doctor_if", "emergency_if", "medicines", "questions_for_you", "questions_for_doctor"];
const SHORT = /reply length: short/;

const reading = (extra = {}) => ({ language: "en", topics: ["fever", "headache"], drugs: [], who_for: "self", age_hint: null, safety_flags: [], reply: "full", ...extra });
/** The fast model's reading of each new message, by its text. */
const fastModel = (byMessage) => (request) => byMessage[request.messages[1].content.split("New message:\n").at(-1)] ?? reading();
/** The main model: asked for a short reply it finds the right words but still fills every list, as seen live. */
const mainModel = (short) => (request) => (SHORT.test(request.messages[1].content) ? goodAnswer(short) : goodAnswer());
const lastPrompt = (llm) => llm.calls.stream.at(-1).messages[1].content;
const lookups = (log) => log.filter((url) => url.includes("nlm.nih.gov")).length;

/** A member's chat that starts with a fever and a headache, answered in full. */
async function feverChat({ llm, health = null }) {
  const log = [];
  const deps = makeDeps({ llm, fetch: standardInternet({ log }), repo: createMemoryRepo({ health }) });
  const first = await run(deps, turnBody(FEVER, { client_message_id: uuid(1) }));
  assert.equal(first.fields.likely_causes.length, 1, "the first question gets the full answer");
  assert.ok(lookups(log) > 0);
  let n = 1;
  const say = (text) => run(deps, turnBody(text, { client_message_id: uuid(++n) }));
  return { deps, log, say };
}

test("a greeting in a fever chat gets a short, warm reply that carries on, not the whole answer again (live 2026-10-19)", async () => {
  const llm = scriptedLlm({
    extractReply: fastModel({ hii: reading({ reply: "brief" }), "thanks!": new Error("fast model down") }),
    reply: mainModel({ headline: "Hi again.", summary: "Is the fever any better? Tell me how you're feeling now. Fevers often come from infections, so rest and drink water." }),
  });
  const { deps, log, say } = await feverChat({ llm });
  const before = lookups(log);
  const { events, fields } = await say("hii");

  assert.match(lastPrompt(llm), SHORT, "the model is asked for a short reply");
  assert.match(lastPrompt(llm), /Person: I have had a fever and a headache since yesterday/, "with the chat so far, so it can carry on");
  assert.equal(lookups(log), before, "nothing new to look up, so the fever and headache pages are not fetched again");
  assert.deepEqual(eventsNamed(events, "sources"), [[]]);
  const steps = eventsNamed(events, "status").map((s) => `${s.step}:${s.state}`);
  assert.ok(steps.includes("medlineplus:skipped") && steps.includes("fda:skipped"));

  assert.equal(fields.headline, "Hi again.");
  assert.equal(fields.summary, "Is the fever any better? Tell me how you're feeling now.", "one or two sentences");
  for (const name of SECTIONS) assert.deepEqual(fields[name], [], `${name} is empty`);
  assert.equal(fields.unknowns, "", "no 'no trusted source' line for a greeting");
  assert.equal(fields.care_level, "selfcare", "the level is still the model's, under the floor's rules");
  assert.equal(eventsNamed(events, "red_flag").length, 0);
  assert.deepEqual(Object.keys(fields).sort(), Object.keys(goodAnswer()).sort(), "the same fields as a full answer");
  assert.equal(eventsNamed(events, "done")[0].degraded, false);
  const saved = deps.repo.state.messages.at(-1);
  assert.equal(saved.content, "Hi again. Is the fever any better? Tell me how you're feeling now.");
  assert.deepEqual(saved.answer.likely_causes, []);

  // With the fast model down, plain small talk is still recognised on the server.
  const thanks = await say("thanks!");
  assert.match(lastPrompt(llm), SHORT);
  for (const name of SECTIONS) assert.deepEqual(thanks.fields[name], []);
  assert.equal(lookups(log), before);
});

test("a question about the person's saved details gets a short answer from the profile, with no lookups", async () => {
  const health = { age_range: "25-34", sex_at_birth: "female", pregnancy: "no", conditions: [], allergies: ["dust", "penicillin"], medicines: [] };
  const question = "tell me which allergy I have";
  const llm = scriptedLlm({
    extractReply: fastModel({ [question]: reading({ topics: ["allergy"], reply: "brief" }) }),
    reply: mainModel({
      headline: "Your saved details list dust and penicillin.",
      summary: "That's from the health details you saved. I can't test for allergies from a message, so a doctor can confirm them.",
    }),
  });
  const { log, say } = await feverChat({ llm, health });
  const before = lookups(log);
  const { fields } = await say(question);

  assert.match(lastPrompt(llm), SHORT);
  assert.match(lastPrompt(llm), /allergies: dust, penicillin/, "the answer comes from the saved profile");
  assert.equal(lookups(log), before, "'allergy' in the question does not start a lookup");
  assert.equal(fields.headline, "Your saved details list dust and penicillin.");
  for (const name of SECTIONS) assert.deepEqual(fields[name], [], `${name} is empty`);
  assert.equal(fields.unknowns, "");
});

test("a greeting never hides an emergency or a warning sign in the same message", async () => {
  const chestPain = "hii, now I have crushing chest pain";
  const highFever = "hi again, the fever is 39.5 for 4 days now";
  const llm = scriptedLlm({
    // The fast model wrongly calls all of these small talk; the safety checks still decide.
    extractReply: fastModel({
      hii: reading({ reply: "brief" }),
      [chestPain]: reading({ topics: ["chest pain"], reply: "brief" }),
      [highFever]: reading({ reply: "brief", safety_flags: [{ level: "doctor24", evidence: "fever is 39.5 for 4 days", crisis: false }] }),
    }),
    reply: mainModel({ care_level: "selfcare", headline: "Hi again.", summary: "How are you feeling now?" }),
  });
  const { log, say } = await feverChat({ llm });

  const greeting = await say("hii");
  assert.equal(greeting.fields.headline, "Hi again.", "the greeting alone is short");

  const before = lookups(log);
  const urgent = await say(chestPain);
  const order = urgent.events.map((e) => e.event).filter((name) => name !== "meta" && name !== "status");
  assert.equal(order[0], "red_flag", "the alarm still comes first");
  assert.deepEqual(eventsNamed(urgent.events, "red_flag").map((e) => [e.level, e.source]), [["ambulance", "rules"]]);
  assert.doesNotMatch(lastPrompt(llm), SHORT, "no short reply when the rules found an emergency");
  assert.equal(urgent.fields.care_level, "ambulance");
  assert.equal(urgent.fields.headline, "This may be an emergency. Call 112 now.");
  assert.ok(urgent.fields.emergency_if.length > 0, "the emergency signs are kept");
  assert.deepEqual(urgent.fields.try_tonight, []);
  assert.ok(lookups(log) > before, "looked up as a real question");

  const warning = await say(highFever);
  assert.doesNotMatch(lastPrompt(llm), SHORT, "no short reply when the model flagged a sign with the person's own words");
  assert.equal(warning.fields.care_level, "doctor24");
  assert.ok(warning.fields.see_doctor_if.length > 0);
});

test("after a self-harm message, a greeting keeps the full gentle check-in (guard: unchanged)", async () => {
  const llm = scriptedLlm({ extractReply: fastModel({ hi: reading({ topics: [], reply: "brief" }) }), reply: mainModel({ headline: "Hi again." }) });
  const deps = makeDeps({ llm });
  await run(deps, turnBody("I want to kill myself", { client_message_id: uuid(1) }));
  const { fields } = await run(deps, turnBody("hi", { client_message_id: uuid(2) }));
  assert.doesNotMatch(lastPrompt(llm), SHORT);
  assert.match(lastPrompt(llm), /Person: I want to kill myself/);
  assert.ok(fields.questions_for_you.length > 0, "nothing is trimmed");
});

test("small talk is recognised on the server without the AI", () => {
  for (const text of ["hii", "Hiiii!!", "hey 😊", "Thanks!", "ok thank you so much", "good morning doc", "नमस्ते", "धन्यवाद", "ok got it, bye"]) {
    assert.equal(isSmallTalk(text), true, text);
  }
  for (const text of ["hi, I have chest pain", "no", "not good", "hi my fever is back", "which allergy do I have", "ok but my head hurts", ""]) {
    assert.equal(isSmallTalk(text), false, text);
  }
});

test("a short reply keeps any helpline sentence, and nothing is trimmed once the level is an emergency", () => {
  const context = () => newCleanContext({ sources: [], floor: computeFloor("hi", [], []), language: "en", mode: "normal", drugNames: [], drugSources: [], brief: true });
  const ctx = context();
  assert.equal(cleanField("care_level", "selfcare", ctx), "selfcare");
  assert.equal(
    cleanField("summary", "Hi again. How are you feeling now? Rest well tonight. If those thoughts come back, Tele-MANAS is there on 14416.", ctx),
    "Hi again. How are you feeling now? If those thoughts come back, Tele-MANAS is there on 14416.",
  );
  assert.deepEqual(cleanField("try_tonight", [{ text: "Rest and drink water", source_ids: [] }], ctx), []);
  assert.equal(cleanField("unknowns", "I can't examine you.", ctx), "");
  assert.equal(assemble({ headline: "Hi again.", summary: "How are you?" }, context()).answer.unknowns, "", "nor when the model leaves it out");

  const serious = context();
  assert.equal(cleanField("care_level", "emergency", serious), "emergency");
  assert.deepEqual(cleanField("emergency_if", [{ text: "You faint or can't breathe", source_ids: [] }], serious), [{ text: "You faint or can't breathe", source_ids: [] }]);
  assert.equal(cleanField("summary", "One. Two. Three.", serious), "One. Two. Three.");
});
