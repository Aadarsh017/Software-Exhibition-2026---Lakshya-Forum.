// The health diary and check-ins (DESIGN.md 8.6c).
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkInFor, checkInMessage, emptyDraft, groupByDay, temperatureSeries, toDiaryRow } from "../lib/diary/diary.ts";

test("diary: an entry needs something, and temperatures are °C", () => {
  assert.equal(toDiaryRow(emptyDraft()).ok, false);
  const ok = toDiaryRow({ ...emptyDraft(), symptom: "  Fever ", temperature: "38,24", feeling: "worse", severity: 6 }, "c1");
  assert.deepEqual(ok, { ok: true, row: { symptom: "Fever", severity: 6, temperature_c: 38.2, feeling: "worse", note: null, conversation_id: "c1" } });
  const fahrenheit = toDiaryRow({ ...emptyDraft(), temperature: "101.2" });
  assert.equal(fahrenheit.ok, false);
  assert.match(fahrenheit.error, /°F/);
  assert.equal(toDiaryRow({ ...emptyDraft(), temperature: "50" }).ok, false);
  assert.equal(toDiaryRow({ ...emptyDraft(), feeling: "same" }).ok, true, "a feeling alone is an entry");
});

test("diary: entries by day, newest first", () => {
  const now = new Date(2026, 9, 19, 12, 0);
  const at = (d, h) => new Date(2026, 9, d, h, 0).toISOString();
  const groups = groupByDay([{ logged_at: at(17, 9) }, { logged_at: at(19, 8) }, { logged_at: at(18, 20) }, { logged_at: at(19, 10) }], now);
  assert.deepEqual(groups.map((g) => [g.label, g.items.length]), [["Today", 2], ["Yesterday", 1], ["17 Oct", 1]]);
  assert.equal(groups[0].items[0].logged_at, at(19, 10), "newest first within a day");
});

test("diary: the temperature line uses the last two weeks only, oldest first", () => {
  const now = new Date("2026-10-19T12:00:00Z");
  const series = temperatureSeries([
    { id: "a", logged_at: "2026-10-19T08:00:00Z", temperature_c: "38.2", symptom: null, severity: null, feeling: null, note: null, conversation_id: null },
    { id: "b", logged_at: "2026-10-18T08:00:00Z", temperature_c: 38.9, symptom: null, severity: null, feeling: null, note: null, conversation_id: null },
    { id: "c", logged_at: "2026-09-01T08:00:00Z", temperature_c: 39, symptom: null, severity: null, feeling: null, note: null, conversation_id: null },
    { id: "d", logged_at: "2026-10-18T09:00:00Z", temperature_c: null, symptom: "x", severity: null, feeling: null, note: null, conversation_id: null },
  ], now);
  assert.deepEqual(series.map((p) => p.value), [38.9, 38.2]);
});

test("check-in: the newest chat about a problem, 8 hours to 4 days old, not yet answered", () => {
  const now = new Date("2026-10-19T12:00:00Z");
  const chat = (id, hoursAgo, level = "doctor") => ({ id, title: id, max_care_level: level, updated_at: new Date(now.getTime() - hoursAgo * 3_600_000).toISOString() });
  const chats = [chat("too-new", 2), chat("fever", 20), chat("older", 50), chat("too-old", 120), chat("no-problem", 30, null)];
  assert.equal(checkInFor(chats, [], now)?.id, "fever");
  assert.equal(checkInFor(chats, [{ logged_at: now.toISOString(), conversation_id: "fever" }], now)?.id, "older", "already checked in");
  assert.equal(checkInFor(chats, [], now, new Set(["fever", "older"])), null, "waved away");
  assert.equal(checkInMessage("better"), "Update: it's better now.");
});

import { answerToSpeech, nearbyCare, shareText, mapsSearch } from "../lib/chat/format.ts";

test("listen: the answer read in order, without numbers for sources or web addresses", () => {
  const fields = { headline: "Rest and fluids should help.", summary: "Raunak, this is usually a virus.", try_tonight: [{ text: "Drink water", source_ids: ["S1"] }], medicines: [{ name: "Paracetamol", note: "Use the dose on the pack.", source_ids: ["S2"], kind: "otc" }] };
  const spoken = answerToSpeech(fields);
  assert.equal(spoken, "Rest and fluids should help. Raunak, this is usually a virus. What to do now: Drink water. Medicines: Paracetamol. Use the dose on the pack.");
  assert.doesNotMatch(spoken, /S1|http/);
});

test("share: the copied text, signed", () => {
  const text = shareText({ headline: "Rest helps." }, []);
  assert.match(text, /^Rest helps\./);
  assert.match(text, /General guidance, not medical advice\. In an emergency call 112\.\nFrom Hale\.$/);
});

test("nearby care: what fits the advice, and a hospital, never a pharmacy, in an emergency", () => {
  assert.deepEqual(nearbyCare("emergency", true).map((item) => item.label), ["Find the nearest hospital"]);
  assert.deepEqual(nearbyCare("doctor24", true).map((item) => item.label), ["Find a clinic near you", "Find a pharmacy near you"]);
  assert.deepEqual(nearbyCare("selfcare", false), []);
  assert.equal(mapsSearch("pharmacy near me"), "https://www.google.com/maps/search/?api=1&query=pharmacy%20near%20me");
});

import { personalSections, personalToText } from "../lib/summary/personal.ts";
import { emptyPersonal } from "../lib/personalization/profile.ts";

test("doctor summary: about me, the newest blood results and two weeks of diary, from what was saved", () => {
  const now = new Date("2026-10-19T12:00:00Z");
  const profile = { ...emptyPersonal(), age_range: "25-34", sex_at_birth: "male", conditions: ["Epilepsy"], allergies: ["Sulfa drugs"], blood_group: "O+" };
  const labs = [
    { id: "1", marker: "vitamin_d", label: null, value: "14.000", unit: "ng/mL", test_date: "2026-09-12" },
    { id: "2", marker: "vitamin_d", label: null, value: "9", unit: "ng/mL", test_date: "2026-01-02" },
  ];
  const diary = [
    { id: "a", logged_at: "2026-10-19T08:10:00Z", symptom: "Fever", severity: 6, temperature_c: "38.2", feeling: "worse", note: null, conversation_id: null },
    { id: "b", logged_at: "2026-09-01T08:10:00Z", symptom: "Old", severity: null, temperature_c: null, feeling: null, note: null, conversation_id: null },
  ];
  const sections = personalSections(profile, labs, diary, now);
  assert.deepEqual(sections.about, ["Age and sex: 25-34 · Male", "Blood group: O+", "Long-term conditions: Epilepsy", "Allergies: Sulfa drugs"]);
  assert.deepEqual(sections.blood, ["Vitamin D (25-OH): 14 ng/mL (12 Sep 2026), low"]);
  assert.equal(sections.diary.length, 1, "only the last two weeks");
  assert.match(sections.diary[0], /^19 Oct 2026 \d\d:\d\d: Fever, 6\/10, 38\.2 °C, worse$/);
  assert.match(personalToText(sections), /^About me:\n- Age and sex[\s\S]*My recent blood results[\s\S]*My health diary, last 2 weeks:/);
  assert.deepEqual(personalSections(null, [], [], now), { about: [], blood: [], readings: [], medicines: [], diary: [] });
});

test("doctor summary: how often each regular medicine was ticked, with the forgotten-tick note (DESIGN.md 8.6e)", () => {
  const now = new Date(2026, 9, 19, 10);
  const profile = { ...emptyPersonal(), medicines: ["Amlodipine", "Metformin"] };
  const set = new Date(2026, 9, 1, 9).toISOString();
  const schedules = [
    { id: "a", medicine: "Amlodipine", slots: ["morning"], pills_left: null, times_set_at: set },
    { id: "t", medicine: "Thyroxine", slots: ["morning"], pills_left: null, times_set_at: set },
  ];
  const doses = ["2026-10-18", "2026-10-17", "2026-10-15"].map((taken_on) => ({ schedule_id: "a", slot: "morning", taken_on }));
  const sections = personalSections(profile, [], [], now, { schedules, doses });
  assert.deepEqual(sections.medicines, ["Amlodipine: taken 3 of 14 mornings"], "Thyroxine is no longer on the list");
  assert.match(personalToText(sections), /My medicines, last 2 weeks \(ticked in Hale\):\n- Amlodipine: taken 3 of 14 mornings\nA missing tick can also mean a forgotten tick\./);
});

import { checkInWhen } from "../lib/diary/diary.ts";

test("bug review 2026-10-20: the check-in says when by calendar day", () => {
  const now = new Date(2026, 9, 20, 18, 0);
  assert.equal(checkInWhen(new Date(2026, 9, 20, 9, 0).toISOString(), now), "earlier today");
  assert.equal(checkInWhen(new Date(2026, 9, 19, 23, 0).toISOString(), now), "yesterday");
  assert.equal(checkInWhen(new Date(2026, 9, 18, 7, 0).toISOString(), now), "2 days ago");
});
