// Looking things up: the saved real replies from MedlinePlus and openFDA, brand names, caching, timeouts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildUrl as nlmUrl, chooseTopicPassage, parseSearchResult, safeTerm, searchTopic } from "../../functions/_shared/ground/medlineplus.ts";
import { buildUrl as fdaUrl, chooseLabelPassage, findLabel, parseLabel, parseLabels, pickLabel, safeDrugName } from "../../functions/_shared/ground/openfda.ts";
import { ground } from "../../functions/_shared/ground/index.ts";
import { findDrugMentions, resolveDrug } from "../../functions/_shared/aliases.ts";
import { hasDose, hasSchedule, doseMentions, dosesComeFrom } from "../../functions/_shared/dose.ts";
import { htmlToText } from "../../functions/_shared/text.ts";
import { createMemoryRepo, fakeFetch, fixture, standardInternet } from "./support.mjs";

const who = { tool: "health-chat-helper", email: "ops@example.com" };
const signal = () => AbortSignal.timeout(2000);

test("MedlinePlus: reads the real reply, strips the <span> highlighting, keeps the link", () => {
  const { topics, spelling } = parseSearchResult(fixture("medlineplus-headache.xml"));
  assert.equal(spelling, null);
  assert.equal(topics.length, 1);
  assert.equal(topics[0].title, "Headache", "no <span> tags left in the title");
  assert.equal(topics[0].url, "https://medlineplus.gov/headache.html");
  assert.doesNotMatch(topics[0].summary, /<|&lt;|span/);
  assert.match(topics[0].summary, /tension headache/i);
  assert.doesNotMatch(topics[0].summary, /^NIH:/m, "the attribution line is dropped");
  assert.match(topics[0].summary, /\n\n/, "paragraphs are kept apart");
});

test("MedlinePlus: no match gives NLM's own spelling suggestion; foreign links are ignored", () => {
  const miss = parseSearchResult(fixture("medlineplus-misspelled.xml"));
  assert.deepEqual(miss, { topics: [], spelling: "headache" });
  const forged = fixture("medlineplus-headache.xml").replace("https://medlineplus.gov/headache.html", "https://evil.example/headache.html");
  assert.deepEqual(parseSearchResult(forged).topics, [], "only medlineplus.gov links are accepted");
});

test("MedlinePlus: only plain topic words are ever sent out", () => {
  assert.equal(safeTerm("Sore Throat"), "sore throat");
  assert.equal(safeTerm("my name is Asha and my phone is 9876543210"), null, "long text and digits are not sent");
  assert.equal(safeTerm("[NAME_1]"), "name", "placeholders lose their brackets and digits");
  assert.equal(safeTerm("a"), null);
  const url = new URL(nlmUrl("sore throat", who, true));
  assert.equal(url.searchParams.get("term"), 'title:"sore throat"');
  assert.equal(url.searchParams.get("db"), "healthTopics");
  assert.equal(url.searchParams.get("tool"), "health-chat-helper");
  assert.equal(url.searchParams.get("email"), "ops@example.com");
});

test("MedlinePlus: follows the spelling suggestion once, then tries a plain search", async () => {
  const log = [];
  const fetch = fakeFetch({ medlineplus: { hedache: fixture("medlineplus-misspelled.xml"), headache: fixture("medlineplus-headache.xml") }, log });
  const topics = await searchTopic("hedache", { fetch, who, signal: signal() });
  assert.equal(topics[0].title, "Headache");
  assert.equal(log.length, 2, "one search, then the corrected search");

  const none = await searchTopic("zzzzzz", { fetch: fakeFetch({ log: [] }), who, signal: signal() });
  assert.deepEqual(none, []);
  await assert.rejects(searchTopic("headache", { fetch: fakeFetch({ failHosts: ["wsearch.nlm.nih.gov"] }), who, signal: signal() }), /medlineplus_500/);
});

// Saved real replies for the live test of 2026-10-19 ("I'm having trouble sleeping"). No page has
// these phrases in its title, so a plain search runs, and it ranks pages that only mention them.
const sleepInternet = (log = []) =>
  fakeFetch({
    medlineplus: {
      'title:"insomnia"': fixture("medlineplus-insomnia.xml"),
      'title:"sleep difficulty"': fixture("medlineplus-sleep-difficulty-title.xml"),
      "sleep difficulty": fixture("medlineplus-sleep-difficulty-plain.xml"),
      'title:"trouble sleeping"': fixture("medlineplus-trouble-sleeping-title.xml"),
      "trouble sleeping": fixture("medlineplus-trouble-sleeping-plain.xml"),
    },
    log,
  });

test("MedlinePlus: a plain search keeps a page only if its name is about the term, not a side mention", async () => {
  const log = [];
  const none = await searchTopic("sleep difficulty", { fetch: sleepInternet(log), who, signal: signal() });
  assert.deepEqual(none.map((t) => t.title), [], "Lewy Body Dementia, Carpal Tunnel Syndrome and FASD only mention sleep in passing");
  assert.equal(log.length, 2, "the title search, then one plain search");
  const close = await searchTopic("trouble sleeping", { fetch: sleepInternet(), who, signal: signal() });
  assert.deepEqual(close.map((t) => t.title), ["Healthy Sleep"], "Menopause and Stress come first in the plain search but are skipped");
});

test("MedlinePlus: among title matches the closest name wins, and alternate names count", async () => {
  const stress = await searchTopic("stress", { fetch: fakeFetch({ medlineplus: { stress: fixture("medlineplus-stress.xml") } }), who, signal: signal() });
  assert.equal(stress[0].title, "Stress", "not Post-Traumatic Stress Disorder, which NLM lists first");
  const cramps = await searchTopic("menstrual cramps", { fetch: fakeFetch({ medlineplus: { "menstrual cramps": fixture("medlineplus-menstrual-cramps.xml") } }), who, signal: signal() });
  assert.equal(cramps[0].title, "Period Pain", "matched through its alternate name Menstrual Cramps");
  const cold = await searchTopic("cold", { fetch: fakeFetch({ medlineplus: { cold: fixture("medlineplus-cold.xml") } }), who, signal: signal() });
  assert.equal(cold[0].title, "Common Cold", "not Cold and Cough Medicines or Cold Sores, which NLM lists first");
  const headache = await searchTopic("headache", { fetch: standardInternet(), who, signal: signal() });
  assert.equal(headache[0].title, "Headache");
});

test("MedlinePlus: the passage keeps what matters to the question, and the warnings, within 600 characters", () => {
  const { topics } = parseSearchResult(fixture("medlineplus-headache.xml"));
  const passage = chooseTopicPassage(topics[0], ["stiff", "neck", "fever"]);
  assert.ok(passage.length <= 600, `${passage.length} characters`);
  assert.match(passage, /stiff neck|medical help/i, "the warning about a stiff neck is kept");
  assert.match(passage, /^Almost everyone/, "sentences stay in their original order");
});

test("openFDA: reads a real label, builds the DailyMed link, never touches the dosing section", () => {
  const label = parseLabel(JSON.parse(fixture("openfda-acetaminophen.json")));
  assert.match(label.url, /^https:\/\/dailymed\.nlm\.nih\.gov\/dailymed\/drugInfo\.cfm\?setid=[0-9a-f-]{36}$/);
  assert.equal(label.generic, "acetaminophen");
  assert.match(label.effective, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(!("dosage_and_administration" in label.sections));
  assert.equal(parseLabel({ results: [] }), null);
  assert.equal(parseLabel({ results: [{ set_id: "not-a-uuid" }] }), null, "an invalid id never becomes a link");
});

test("openFDA: the quoted label text contains no amounts and no schedules", () => {
  const label = parseLabel(JSON.parse(fixture("openfda-acetaminophen.json")));
  const passage = chooseLabelPassage(label);
  assert.ok(passage.length > 80 && passage.length <= 600, `${passage.length} characters`);
  assert.equal(hasDose(passage), false, passage);
  assert.equal(hasSchedule(passage), false, passage);
  assert.match(passage, /Stop use|Ask a doctor|Purpose/);
  // The real label says "more than 4,000 mg ... in 24 hours" in its warnings: that sentence must be gone.
  assert.doesNotMatch(passage, /4,000|4000/);
});

test("openFDA: a sentence with an amount or a schedule is skipped wherever it sits in the label", () => {
  const label = {
    name: "Test", generic: "x", set_id: "0ca02f8b-4413-4e7c-a67b-8c67c53e1343", effective: null, url: "u",
    sections: {
      purpose: "Pain reliever.",
      do_not_use: "Do not use more than 4,000 mg in 24 hours. Do not use with other products that contain the same medicine.",
      ask_doctor: "Ask a doctor before use if you have liver disease. Take 2 tablets every 6 hours if needed.",
      ask_doctor_or_pharmacist: "", stop_use: "Stop use and ask a doctor if pain lasts more than ten days. Use 1 tablet twice a day.",
      pregnancy_or_breast_feeding: "", when_using: "", warnings: "",
    },
  };
  const passage = chooseLabelPassage(label);
  assert.match(passage, /liver disease/);
  assert.match(passage, /same medicine/);
  assert.equal(hasDose(passage) || hasSchedule(passage), false, passage);
  assert.doesNotMatch(passage, /4,000|2 tablets|1 tablet|every 6 hours|twice a day/);
});

test("openFDA: only plain generic names go out; 404 means none; the exact index is tried first", async () => {
  assert.equal(safeDrugName("Acetaminophen"), "acetaminophen");
  assert.equal(safeDrugName("123"), null);
  assert.equal(safeDrugName("x".repeat(60)), null);
  const url = new URL(fdaUrl("acetaminophen", "", true));
  assert.equal(url.searchParams.get("search"), 'openfda.generic_name.exact:"ACETAMINOPHEN" AND openfda.product_type:"HUMAN OTC DRUG"');
  assert.equal(url.searchParams.get("limit"), "6");
  assert.equal(url.searchParams.has("api_key"), false);
  assert.equal(new URL(fdaUrl("acetaminophen", "KEY", false)).searchParams.get("api_key"), "KEY");

  const log = [];
  const fetch = fakeFetch({ openfda: { acetaminophen: fixture("openfda-acetaminophen.json") }, log });
  assert.ok(await findLabel("acetaminophen", { fetch, apiKey: "", signal: signal() }));
  assert.equal(await findLabel("nonexistium", { fetch, apiKey: "", signal: signal() }), null);
  assert.equal(log.filter((entry) => /nonexistium/i.test(entry)).length, 2, "tries the exact index, then the loose one");
  await assert.rejects(findLabel("acetaminophen", { fetch: fakeFetch({ failHosts: ["api.fda.gov"] }), apiKey: "", signal: signal() }), /openfda_500/);
});

test("brand names: Indian brands map to the US generic name; prescription medicines are flagged", () => {
  assert.deepEqual(resolveDrug("Crocin").lookup, ["acetaminophen"]);
  assert.deepEqual(resolveDrug("Dolo 650").lookup, ["acetaminophen"]);
  assert.equal(resolveDrug("Dolo 650").generic, "paracetamol");
  assert.deepEqual(resolveDrug("Combiflam").lookup, ["ibuprofen", "acetaminophen"]);
  assert.deepEqual(resolveDrug("paracetamol 500mg").lookup, ["acetaminophen"]);
  assert.equal(resolveDrug("Azithral").prescription, true);
  assert.equal(resolveDrug("Azithral").known, true);
  const unknown = resolveDrug("Zyloxane");
  assert.deepEqual([unknown.known, unknown.lookup], [false, ["zyloxane"]]);
  assert.deepEqual(resolveDrug("[NAME_1]").lookup, [], "a placeholder is never looked up");
  assert.deepEqual(findDrugMentions("I took Crocin and some ORS, also dolo 650 yesterday").sort(), ["crocin", "dolo 650", "ors"].sort());
  assert.deepEqual(findDrugMentions("I have a cold"), [], "ordinary words are not medicines");
});

test("amounts: the scanner finds doses and schedules but not temperatures, days or durations", () => {
  for (const text of ["take 500 mg", "2 tablets", "1-2 tablets twice a day", "5 ml", "take two tablets", "half a tablet", "10 drops", "1,000 mg", "2.5 mg", "650mg", "every 6 hours", "3 times a day", "twice daily", "one teaspoon"]) {
    assert.ok(hasDose(text) || hasSchedule(text), text);
  }
  for (const text of ["fever of 38.5°C for 3 days", "for more than 3 days", "wait 10 minutes", "drink 2 litres of water", "100.4 F", "stage 2 of 3", "I am 25 years old", "every few hours", "a few tablets of patience"]) {
    assert.equal(hasDose(text) || hasSchedule(text), false, text);
  }
  assert.deepEqual(doseMentions("took 500 mg twice a day"), ["500 mg", "twice a day"]);
  assert.equal(dosesComeFrom("I took 500 mg", "yesterday i took 500  MG of crocin"), true);
  assert.equal(dosesComeFrom("I took 1000 mg", "I took 500 mg"), false);
});

test("HTML: tags go, entities become text, paragraphs survive", () => {
  assert.equal(htmlToText("<p>Fish &amp; chips&nbsp;are <b>fine</b>.</p><p>Next &#39;one&#39;</p>"), "Fish & chips are fine.\n\nNext 'one'");
});

const deps = (over = {}) => ({
  fetch: standardInternet(),
  repo: createMemoryRepo(),
  now: () => Date.parse("2026-10-19T10:00:00Z"),
  perSourceTimeoutMs: 1000,
  overallTimeoutMs: 2000,
  who,
  openFdaKey: "",
  ...over,
});

test("grounding: topics and medicines are fetched together, numbered, and cached", async () => {
  const statuses = [];
  const d = deps({ onStatus: (step, state) => statuses.push(`${step}:${state}`) });
  const result = await ground({ topics: ["headache"], drugs: ["Crocin"], focus: ["headache"] }, d);
  assert.deepEqual(result.sources.map((s) => [s.id, s.kind]), [["S1", "condition"], ["S2", "medicine"]]);
  assert.equal(result.sources[0].publisher, "MedlinePlus (U.S. National Library of Medicine)");
  assert.match(result.sources[1].url, /dailymed/);
  assert.ok(result.sources.every((s) => s.passage.length <= 600 && s.retrieved_at === "2026-10-19T10:00:00.000Z"));
  assert.deepEqual(result.drugSources, [{ asWritten: "Crocin", generic: "paracetamol", id: "S2" }]);
  assert.deepEqual([result.medlineplus, result.fda], ["done", "done"]);
  assert.deepEqual(statuses, ["medlineplus:active", "fda:active", "medlineplus:done", "fda:done"].sort((a, b) => statuses.indexOf(a) - statuses.indexOf(b)));
  assert.deepEqual(d.repo.state.cacheWrites.map((w) => [w.key, w.ttl]).sort(), [["medlineplus:v2:headache", 43200], ["openfda:v2:acetaminophen:adult", 43200]]);

  // A second turn is served from the cache: nothing goes out to the internet.
  const log = [];
  const again = await ground({ topics: ["headache"], drugs: ["Crocin"], focus: [] }, deps({ fetch: fakeFetch({ log }), repo: d.repo }));
  assert.equal(log.length, 0);
  assert.equal(again.sources.length, 2);
});

test("grounding: 'I'm having trouble sleeping' cites Insomnia and no off-topic page (live test 2026-10-19)", async () => {
  // The curated title comes first; the fast model added "sleep difficulty", which has no page of its own.
  const result = await ground({ topics: ["insomnia", "sleep difficulty"], drugs: [], focus: ["having", "trouble", "sleeping", "insomnia", "sleep", "difficulty"] }, deps({ fetch: sleepInternet() }));
  assert.deepEqual(result.sources.map((s) => [s.id, s.title]), [["S1", "Insomnia"]]);
  assert.equal(result.medlineplus, "done");
});

test("grounding: a topic with no page is remembered for an hour and the answer carries on", async () => {
  const d = deps();
  const result = await ground({ topics: ["zzzz"], drugs: [], focus: [] }, d);
  assert.deepEqual(result.sources, []);
  assert.equal(result.medlineplus, "done");
  assert.equal(result.fda, "skipped");
  assert.deepEqual(d.repo.state.cacheWrites.map((w) => w.ttl), [3600]);
});

test("grounding: prescription medicines and ones without a US label are reported, not looked up", async () => {
  const log = [];
  const result = await ground({ topics: [], drugs: ["Azithral", "Saridon", "Crocin"], focus: [] }, deps({ fetch: standardInternet({ log }) }));
  assert.deepEqual(result.unlabelled, [{ name: "azithromycin (an antibiotic)", reason: "prescription" }, { name: "a combination pain reliever (not sold in the US)", reason: "no_label" }]);
  assert.equal(result.sources.length, 1);
  assert.equal(log.filter((entry) => entry.includes("azithromycin")).length, 0, "a prescription medicine is never even searched");
});

test("grounding: one source failing does not stop the other", async () => {
  const statuses = [];
  const d = deps({ fetch: standardInternet({ failHosts: ["api.fda.gov"] }), onStatus: (s, st) => statuses.push(`${s}:${st}`) });
  const result = await ground({ topics: ["headache"], drugs: ["Crocin"], focus: [] }, d);
  assert.deepEqual(result.sources.map((s) => s.kind), ["condition"]);
  assert.deepEqual([result.medlineplus, result.fda], ["done", "failed"]);
  assert.ok(statuses.includes("fda:failed"));
  assert.equal(d.repo.state.cacheWrites.some((w) => w.key.startsWith("openfda")), false, "failures are not cached");
});

test("grounding: a slow source is cut off at the deadline and the rest is still used", async () => {
  const slowFda = async (input, init) => {
    const url = new URL(String(input));
    if (url.host === "api.fda.gov") {
      return new Promise((resolve, reject) => init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
    }
    return standardInternet()(input, init);
  };
  const started = Date.now();
  const result = await ground({ topics: ["headache"], drugs: ["Crocin"], focus: [] }, deps({ fetch: slowFda, perSourceTimeoutMs: 80, overallTimeoutMs: 400 }));
  assert.ok(Date.now() - started < 1000);
  assert.deepEqual(result.sources.map((s) => s.kind), ["condition"]);
  assert.equal(result.fda, "failed");
});

test("grounding: a broken cache never breaks an answer", async () => {
  const repo = createMemoryRepo();
  repo.cacheGet = async () => { throw new Error("db down"); };
  repo.cacheSet = async () => { throw new Error("db down"); };
  const warnings = [];
  const result = await ground({ topics: ["headache"], drugs: [], focus: [] }, deps({ repo, onWarn: (event) => warnings.push(event) }));
  assert.equal(result.sources.length, 1);
  assert.deepEqual(warnings, ["cache_read_failed", "cache_write_failed"]);
});

test("openFDA: an adult question gets an adult label, a child's question a children's label", async () => {
  const real = JSON.parse(fixture("openfda-acetaminophen.json"));
  const record = (brand, setId) => ({ ...real.results[0], set_id: setId, openfda: { ...real.results[0].openfda, brand_name: [brand], generic_name: ["ACETAMINOPHEN"] } });
  const body = { results: [
    record("Childrens Fever Reducer and Pain Reliever", "11111111-1111-4111-8111-111111111111"),
    record("Infants Pain Reliever", "22222222-2222-4222-8222-222222222222"),
    record("Extra Strength Pain Reliever", "33333333-3333-4333-8333-333333333333"),
  ] };
  const labels = parseLabels(body);
  assert.equal(labels.length, 3);
  assert.equal(pickLabel(labels, false).name, "Extra Strength Pain Reliever");
  assert.equal(pickLabel(labels, true).name, "Childrens Fever Reducer and Pain Reliever");
  assert.equal(pickLabel(labels.slice(0, 2), false).name, "Childrens Fever Reducer and Pain Reliever", "if only children's labels exist, use the newest");
  assert.equal(pickLabel([], false), null);
  const fetch = async () => new Response(JSON.stringify(body), { status: 200 });
  assert.equal((await findLabel("acetaminophen", { fetch, apiKey: "", signal: signal() })).name, "Extra Strength Pain Reliever");
  assert.match((await findLabel("acetaminophen", { fetch, apiKey: "", signal: signal(), forChild: true })).name, /^Childrens/);
});

test("grounding: the adult and the children's label are cached separately", async () => {
  const d = deps();
  await ground({ topics: [], drugs: ["Crocin"], focus: [] }, d);
  await ground({ topics: [], drugs: ["Crocin"], focus: [], forChild: true }, d);
  assert.deepEqual(d.repo.state.cacheWrites.map((w) => w.key).sort(), ["openfda:v2:acetaminophen:adult", "openfda:v2:acetaminophen:child"]);
});
