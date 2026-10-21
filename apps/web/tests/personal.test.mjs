// Personalization helpers (DESIGN.md 8.6b): the profile rows, the summaries and the blood report form.
import { test } from "node:test";
import assert from "node:assert/strict";
import { aboutSummary, aboutYouSummary, bmi, bodySummary, cardSummary, displayName, cleanPhone, completeness, emptyPersonal, firstName, fromRow, lifestyleSummary, listSummary, toNumber, toPersonalRow } from "../lib/personalization/profile.ts";
import { healthSummary } from "../lib/personalization/profile.ts";
import { blankEntries, bloodSummary, formatDay, toLabRows, today } from "../lib/personalization/labs.ts";

test("a database row becomes a draft, numbers from text included", () => {
  const draft = fromRow({ age_range: "25-34", sex_at_birth: "male", conditions: ["Epilepsy"], height_cm: "175.0", weight_kg: "70.5", smoking: "never", alcohol: "weird", family_history: ["Diabetes", 4] });
  assert.equal(draft.height_cm, 175);
  assert.equal(draft.weight_kg, 70.5);
  assert.equal(draft.smoking, "never");
  assert.equal(draft.alcohol, null, "an unknown value is dropped");
  assert.deepEqual(draft.family_history, ["Diabetes"]);
  assert.deepEqual(fromRow(null), emptyPersonal());
});

test("the row to save keeps to the database limits", () => {
  const row = toPersonalRow({ ...emptyPersonal(), height_cm: 900, weight_kg: 72.46, family_history: [" diabetes ", "Diabetes", ""], sex_at_birth: "male", pregnancy: "yes" });
  assert.equal(row.height_cm, null, "an impossible height is not saved");
  assert.equal(row.weight_kg, 72.5);
  assert.deepEqual(row.family_history, ["diabetes"]);
  assert.equal(row.pregnancy, "not_applicable", "never asked when male");
  assert.equal(toNumber("72,5"), 72.5);
  assert.equal(toNumber("abc"), null);
});

test("the rows say what's saved, in a few words", () => {
  const draft = { ...emptyPersonal(), age_range: "25-34", sex_at_birth: "male", height_cm: 175, weight_kg: 70, smoking: "never", activity: "moderate" };
  assert.equal(aboutSummary(draft), "25-34 · Male");
  assert.equal(bodySummary(draft), "175 cm · 70 kg · BMI 22.9");
  assert.equal(lifestyleSummary(draft), "Smoking: never · Activity: some");
  assert.equal(listSummary(["Asthma", "Epilepsy", "Diabetes", "Thyroid"]), "Asthma, Epilepsy and 2 more");
  assert.equal(listSummary([]), "None added");
  assert.equal(bmi(175, null), null);
  assert.deepEqual(completeness("Raunak", draft, 0), { done: 2, total: 5 }, "about you and lifestyle");
  assert.deepEqual(completeness(null, draft, 0), { done: 1, total: 5 }, "about you needs the name too");
  assert.equal(firstName("  Raunak Jain "), "Raunak");
  assert.equal(firstName(""), null);
  assert.equal(firstName("raunak"), "Raunak", "a name saved in lower case gets a capital");
  assert.equal(firstName("deSouza"), "deSouza", "a name with capitals stays as saved");
});

test("one row per topic: About you and Health history say what's saved, or what's inside", () => {
  const empty = emptyPersonal();
  assert.equal(aboutYouSummary(null, empty), "Name, age, sex, height and weight");
  assert.equal(aboutYouSummary("Raunak Jain", empty), "Raunak");
  assert.equal(aboutYouSummary("Raunak", { ...empty, age_range: "25-34", sex_at_birth: "male", height_cm: 175, weight_kg: 70 }), "Raunak · 25-34 · Male · 175 cm · 70 kg");
  assert.equal(aboutYouSummary(null, { ...empty, weight_kg: 70 }), "70 kg");
  assert.equal(healthSummary(empty), "Conditions, allergies, medicines, family");
  assert.equal(healthSummary({ ...empty, conditions: ["Epilepsy"], allergies: ["Sulfa"], medicines: ["Levetiracetam", "Vitamin D"] }), "Epilepsy · 1 allergy · 2 medicines");
  assert.equal(healthSummary({ ...empty, conditions: ["Asthma", "Diabetes", "Thyroid"], family_history: ["Stroke"] }), "Asthma, Diabetes +1 · family history");
  assert.equal(lifestyleSummary(empty, "Smoking, alcohol, activity"), "Smoking, alcohol, activity");
});

test("blood report: the form saves only the lines with a value", () => {
  const entries = blankEntries();
  entries.find((entry) => entry.marker === "vitamin_d").value = "14";
  entries.find((entry) => entry.marker === "hba1c").value = "6,1";
  entries.find((entry) => entry.marker === "tsh").value = "lots";
  entries.push({ marker: "other", label: "Homocysteine", value: "12", unit: "µmol/L" }, { marker: "other", label: "", value: "5", unit: "x" });
  const rows = toLabRows(entries, "2026-09-12");
  assert.deepEqual(rows.map((row) => [row.marker, row.value, row.unit, row.label]), [
    ["vitamin_d", 14, "ng/mL", null],
    ["hba1c", 6.1, "%", null],
    ["other", 12, "µmol/L", "Homocysteine"],
  ]);
});

test("blood report: the row says how the latest values look", () => {
  assert.equal(bloodSummary([], "male"), "Add your latest report");
  const rows = [
    { id: "1", marker: "vitamin_d", label: null, value: "14.000", unit: "ng/mL", test_date: "2026-09-12" },
    { id: "2", marker: "haemoglobin", label: null, value: "14", unit: "g/dL", test_date: "2026-09-12" },
    { id: "3", marker: "vitamin_d", label: null, value: "8", unit: "ng/mL", test_date: "2026-01-02" },
  ];
  assert.equal(bloodSummary(rows, "male"), "1 to look at · 12 Sep 2026");
  assert.equal(bloodSummary([rows[1]], "male"), "All in range · 12 Sep 2026");
  assert.equal(bloodSummary([{ id: "4", marker: "other", label: "Homocysteine", value: 12, unit: "µmol/L", test_date: "2026-03-05" }], null), "1 saved · 5 Mar 2026");
  assert.equal(formatDay("2026-09-01T00:00:00Z"), "1 Sep 2026");
  assert.equal(today(new Date("2026-10-19T20:00:00Z")).length, 10);
});

test("emergency card: blood group and a phone the database accepts", () => {
  const row = toPersonalRow({ ...emptyPersonal(), blood_group: "O+", emergency_contact_name: "  Mum ", emergency_contact_phone: "+91 98765 43210" });
  assert.deepEqual([row.blood_group, row.emergency_contact_name, row.emergency_contact_phone], ["O+", "Mum", "+91 98765 43210"]);
  assert.equal(toPersonalRow({ ...emptyPersonal(), blood_group: "Z", emergency_contact_phone: "call me" }).blood_group, null);
  assert.equal(cleanPhone("call me"), null);
  assert.equal(cleanPhone("12"), null);
  assert.equal(cardSummary({ ...emptyPersonal(), blood_group: "B-", emergency_contact_name: "Ravi" }), "B- · Ravi");
  assert.equal(cardSummary(emptyPersonal()), "Add your blood group and a contact");
});

test("names: shown as saved, with capitals only for a name saved all in lower case", () => {
  assert.equal(displayName("raunak jain"), "Raunak Jain");
  assert.equal(displayName("  Asha   Kulkarni "), "Asha Kulkarni");
  assert.equal(displayName("van der Berg"), "van der Berg", "mixed case is the person's choice");
  assert.equal(displayName(""), null);
  assert.equal(displayName(null), null);
});

import { measureProblem } from "../lib/personalization/profile.ts";
import { localDayOf } from "../lib/summary/personal.ts";

test("bug review 2026-10-20: a height or weight the database can't take is explained, never saved as empty", () => {
  assert.match(measureProblem("5.8", ""), /centimetres/);
  assert.match(measureProblem("", "65 kg"), /kilograms/);
  assert.match(measureProblem("", "500"), /kilograms/);
  assert.equal(measureProblem("165", "62.5"), null);
  assert.equal(measureProblem("", ""), null, "leaving them empty is fine");
  // What's shown after saving is what was saved: no "pregnant" next to "male".
  const shown = fromRow(toPersonalRow({ ...emptyPersonal(), sex_at_birth: "male", pregnancy: "yes" }));
  assert.equal(shown.pregnancy, "not_applicable");
});

test("bug review 2026-10-20: a diary moment in the summary is dated by the device's own calendar day", () => {
  const stamp = new Date(2026, 9, 20, 2, 0).toISOString(); // 02:00 on 20 Oct, local time
  assert.equal(localDayOf(stamp), "2026-10-20");
});
