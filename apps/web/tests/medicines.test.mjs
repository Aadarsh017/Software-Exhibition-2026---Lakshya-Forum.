// Medicines today (DESIGN.md 8.6e): times of day, what's due, pills left, the editor's save and the doctor's lines.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activeSchedules, addDays, adherenceLines, cleanSlots, currentSlot, daysLeft, doseDay, dueDoses, logAllRows, medicinesLine, MISSED_DOSE_LINE,
  parsePills, PILLS_HINT, pillsNote, planSave, quietStamp, runningLow, slotsText, SUMMARY_NOTE, timesDraft, toSchedule,
} from "../lib/medicines/today.ts";

// Local times, like the person's phone.
const at = (day, hour, minute = 0) => new Date(2026, 9, day, hour, minute);

const amlo = { id: "a", medicine: "Amlodipine", slots: ["morning"], pills_left: 28, times_set_at: at(1, 9).toISOString() };
const metf = { id: "m", medicine: "Metformin", slots: ["morning", "night"], pills_left: 10, times_set_at: at(1, 9).toISOString() };
const vitd = { id: "v", medicine: "Vitamin D", slots: ["afternoon"], pills_left: null, times_set_at: at(1, 9).toISOString() };
const LIST = ["Amlodipine", "Metformin", "Vitamin D"];

test("times of day: Morning from 5, Afternoon from 12, Evening from 17, Night from 21 until 5 the next morning", () => {
  assert.equal(currentSlot(at(19, 5)), "morning");
  assert.equal(currentSlot(at(19, 11, 59)), "morning");
  assert.equal(currentSlot(at(19, 12)), "afternoon");
  assert.equal(currentSlot(at(19, 17)), "evening");
  assert.equal(currentSlot(at(19, 21)), "night");
  assert.equal(currentSlot(at(19, 2)), "night");
  // The medicine day changes at 5 AM.
  assert.equal(doseDay(at(19, 23)), "2026-10-19");
  assert.equal(doseDay(at(20, 1)), "2026-10-19", "a Night tick at 1 AM counts for the night before");
  assert.equal(doseDay(at(20, 5)), "2026-10-20");
  assert.equal(doseDay(new Date(2026, 0, 1, 3)), "2025-12-31");
  assert.equal(addDays("2026-10-30", 3), "2026-11-02");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(quietStamp(at(19, 9)), "2026-10-19:morning");
  assert.equal(quietStamp(at(20, 2)), "2026-10-19:night");
});

test("times are cleaned: known ones only, each once, in the order of the day", () => {
  assert.deepEqual(cleanSlots(["night", "morning", "night", "lunch"]), ["morning", "night"]);
  assert.deepEqual(cleanSlots(null), []);
  assert.equal(slotsText(["night", "morning"]), "morning, night");
  assert.equal(toSchedule({ id: "x", medicine: "A", slots: [] }), null, "a row with no time is not a schedule");
  assert.deepEqual(toSchedule({ id: "x", medicine: "A", slots: ["night"], pills_left: 5, times_set_at: "2026-10-01T00:00:00Z" }), { id: "x", medicine: "A", slots: ["night"], pills_left: 5, times_set_at: "2026-10-01T00:00:00Z" });
});

test("what's due: this time of day and earlier ones today, ticked or not; later ones wait", () => {
  const morning = dueDoses([amlo, metf, vitd], LIST, [], at(19, 8));
  assert.deepEqual(morning.map((dose) => `${dose.medicine}:${dose.slot}`), ["Amlodipine:morning", "Metformin:morning"]);
  assert.ok(morning.every((dose) => !dose.taken && !dose.earlier));

  const doses = [{ schedule_id: "a", slot: "morning", taken_on: "2026-10-19" }, { schedule_id: "m", slot: "morning", taken_on: "2026-10-18" }];
  const night = dueDoses([amlo, metf, vitd], LIST, doses, at(19, 22));
  assert.deepEqual(night.map((dose) => `${dose.medicine}:${dose.slot}:${dose.taken ? "taken" : "open"}:${dose.earlier ? "earlier" : "now"}`), [
    "Amlodipine:morning:taken:earlier",
    "Metformin:morning:open:earlier",
    "Vitamin D:afternoon:open:earlier",
    "Metformin:night:open:now",
  ]);
  // At 1 AM it is still the night before: the evening's ticks count.
  assert.equal(dueDoses([amlo], LIST, [{ schedule_id: "a", slot: "morning", taken_on: "2026-10-19" }], at(20, 1))[0].taken, true);
  // "Log all as taken" sends only the open ones, for today's medicine day.
  assert.deepEqual(logAllRows(night, at(20, 1)).map((row) => `${row.schedule_id}:${row.slot}:${row.taken_on}`), ["m:morning:2026-10-19", "v:afternoon:2026-10-19", "m:night:2026-10-19"]);
});

test("only medicines still on the profile's list are due, matched ignoring case", () => {
  assert.deepEqual(activeSchedules([amlo, metf], ["metformin"]).map((s) => s.id), ["m"]);
  assert.deepEqual(dueDoses([amlo, metf], ["Metformin"], [], at(19, 8)).map((dose) => dose.medicine), ["Metformin"]);
  assert.deepEqual(dueDoses([amlo], [], [], at(19, 8)), []);
});

test("pills left: one pill each tick, days left by times a day, running low at 7 days or fewer", () => {
  assert.equal(daysLeft(amlo), 28);
  assert.equal(daysLeft(metf), 5);
  assert.equal(daysLeft(vitd), null);
  assert.equal(pillsNote(10, ["morning", "night"]), "About 5 days left");
  assert.equal(pillsNote(1, ["morning", "night"]), "Less than a day left");
  assert.equal(pillsNote(0, ["morning"]), "None left by your count");
  assert.equal(pillsNote(null, ["morning"]), null);
  assert.equal(runningLow([amlo, metf, vitd]), "Running low: Metformin, about 5 days left.");
  assert.equal(runningLow([amlo, vitd]), null);
  assert.equal(runningLow([metf, { ...amlo, pills_left: 0 }]), "Running low: Metformin (about 5 days left), Amlodipine (none left by your count).");
  assert.equal(runningLow([{ ...amlo, pills_left: 1 }]), "Running low: Amlodipine, about 1 day left.");
  assert.deepEqual(parsePills(""), { ok: true, pills: null });
  assert.deepEqual(parsePills(" 30 "), { ok: true, pills: 30 });
  assert.equal(parsePills("2001").ok, false);
  assert.equal(parsePills("2.5").ok, false);
  assert.equal(parsePills("-1").ok, false);
});

test("the editor's save: times per medicine, a pill count only when new or changed, and removals", () => {
  const draft = timesDraft([amlo, metf]);
  assert.deepEqual(draft.metformin, { slots: ["morning", "night"], pills: "10" });
  assert.equal(medicinesLine(["Amlodipine", "Metformin", "Vitamin D"], draft), "Amlodipine (morning), Metformin (morning, night), Vitamin D");
  assert.equal(medicinesLine([], draft), "None added");

  // Unchanged count: not sent, so a tick made meanwhile isn't undone.
  const same = planSave(["Amlodipine", "Metformin"], draft, [amlo, metf]);
  assert.ok(same.ok);
  assert.deepEqual(same.rows, [{ medicine: "Amlodipine", slots: ["morning"] }, { medicine: "Metformin", slots: ["morning", "night"] }]);
  assert.deepEqual(same.remove, []);

  // A new medicine with times, a changed count, a medicine left without times, one removed from the list.
  const next = { ...draft, amlodipine: { slots: [], pills: "28" }, metformin: { slots: ["night", "morning"], pills: "60" }, "vitamin d": { slots: ["afternoon"], pills: "" } };
  const plan = planSave(["amlodipine", "Metformin", "Vitamin D"], next, [amlo, metf, { ...vitd, id: "old", medicine: "Thyroxine" }]);
  assert.ok(plan.ok);
  assert.deepEqual(plan.rows, [{ medicine: "Metformin", slots: ["morning", "night"], pills_left: 60 }, { medicine: "Vitamin D", slots: ["afternoon"], pills_left: null }]);
  assert.deepEqual(plan.remove.sort(), ["a", "old"]);

  const bad = planSave(["Metformin"], { metformin: { slots: ["morning"], pills: "lots" } }, []);
  assert.equal(bad.ok, false);
  assert.match(bad.error, /Metformin/);
});

test("for the doctor: taken N of M per time of day, over the last 14 full days, from the day after the times were set", () => {
  const now = at(19, 10);
  const doses = [];
  for (let back = 1; back <= 14; back += 1) {
    const day = addDays("2026-10-19", -back);
    if (back !== 3 && back !== 9) doses.push({ schedule_id: "a", slot: "morning", taken_on: day });
    doses.push({ schedule_id: "m", slot: "morning", taken_on: day });
    if (back % 5 !== 0) doses.push({ schedule_id: "m", slot: "night", taken_on: day });
  }
  doses.push({ schedule_id: "a", slot: "morning", taken_on: "2026-10-19" }, { schedule_id: "a", slot: "morning", taken_on: "2026-10-04" });
  assert.deepEqual(adherenceLines([amlo, metf], LIST, doses, now), [
    "Amlodipine: taken 12 of 14 mornings",
    "Metformin: taken 14 of 14 mornings, 12 of 14 nights",
  ]);
  // Times set 3 days ago: counted from the day after, so 2 full days.
  const fresh = { ...amlo, times_set_at: at(16, 20).toISOString() };
  assert.deepEqual(adherenceLines([fresh], LIST, doses, now), ["Amlodipine: taken 2 of 2 mornings"]);
  assert.deepEqual(adherenceLines([{ ...amlo, times_set_at: at(17, 8).toISOString() }], LIST, doses, now), ["Amlodipine: taken 1 of 1 morning"]);
  assert.deepEqual(adherenceLines([{ ...amlo, times_set_at: at(18, 8).toISOString() }], LIST, doses, now), [], "set yesterday: no full day to count yet");
  assert.deepEqual(adherenceLines([amlo], ["Metformin"], doses, now), [], "a medicine no longer on the list is left out");
});

test("never dosing advice: the fixed wording never says how much, to double up or to skip", () => {
  const lines = [
    MISSED_DOSE_LINE, PILLS_HINT, SUMMARY_NOTE,
    runningLow([metf, { ...amlo, pills_left: 0 }]), pillsNote(1, ["morning", "night"]),
    ...adherenceLines([amlo, metf], LIST, [], at(19, 10)),
  ];
  for (const line of lines) {
    assert.doesNotMatch(line, /double|skip|extra|two at once|take (it|one|another|more)|catch up|make up/i, line);
  }
  assert.equal(MISSED_DOSE_LINE, "Missed a dose? Check the label or ask a pharmacist what to do.");
});
