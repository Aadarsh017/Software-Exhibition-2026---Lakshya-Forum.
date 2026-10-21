// Blood-test markers: flags, ranges and the lines Nox is given (DESIGN.md 8.6b).
import { test } from "node:test";
import assert from "node:assert/strict";
import { LAB_MARKERS, findMarker, labFlag, formatRange, latestPerMarker, labLine } from "../src/labs.js";

test("every marker has a key the database accepts, a main unit and a range", () => {
  for (const marker of LAB_MARKERS) {
    assert.match(marker.key, /^[a-z0-9_]{1,40}$/);
    assert.equal(marker.units[0].factor, 1, `${marker.key}: the first unit is the main unit`);
    for (const unit of marker.units) assert.ok(unit.unit.length <= 20, "fits the database column");
    assert.ok(marker.range.any.some((end) => end !== null));
  }
  assert.equal(new Set(LAB_MARKERS.map((marker) => marker.key)).size, LAB_MARKERS.length);
});

test("flags: low, high and in range, in either unit, sex-specific where it matters", () => {
  assert.equal(labFlag({ marker: "vitamin_d", value: 14, unit: "ng/mL" }), "low");
  assert.equal(labFlag({ marker: "vitamin_d", value: "35.000", unit: "nmol/L" }), "low", "35 nmol/L is 14 ng/mL");
  assert.equal(labFlag({ marker: "vitamin_d", value: 100, unit: "nmol/L" }), "in_range", "100 nmol/L is 40 ng/mL");
  assert.equal(labFlag({ marker: "hba1c", value: 6.1, unit: "%" }), "high");
  assert.equal(labFlag({ marker: "fasting_glucose", value: 5.2, unit: "mmol/L" }), "in_range");
  assert.equal(labFlag({ marker: "haemoglobin", value: 12.8, unit: "g/dL" }, "male"), "low");
  assert.equal(labFlag({ marker: "haemoglobin", value: 12.8, unit: "g/dL" }, "female"), "in_range");
  assert.equal(labFlag({ marker: "hdl", value: 45, unit: "mg/dL" }, "female"), "low");
  assert.equal(labFlag({ marker: "ldl", value: 160, unit: "mg/dL" }), "high");
  assert.equal(labFlag({ marker: "platelets", value: 1.2, unit: "lakh/mm³" }), "low");
});

test("no flag when there is nothing to compare with", () => {
  assert.equal(labFlag({ marker: "other", label: "Homocysteine", value: 12, unit: "µmol/L" }), null);
  assert.equal(labFlag({ marker: "vitamin_d", value: 20, unit: "IU" }), null, "an unknown unit is never guessed");
  assert.equal(labFlag({ marker: "vitamin_d", value: "abc", unit: "ng/mL" }), null);
});

test("ranges read naturally", () => {
  assert.equal(formatRange(findMarker("vitamin_d")), "30–100 ng/mL");
  assert.equal(formatRange(findMarker("total_cholesterol")), "199 mg/dL or less");
  assert.equal(formatRange(findMarker("hdl"), "female"), "50 mg/dL or more");
});

test("the latest value of each marker, known markers first", () => {
  const rows = [
    { marker: "vitamin_d", value: 14, unit: "ng/mL", test_date: "2026-03-01" },
    { marker: "vitamin_d", value: 31, unit: "ng/mL", test_date: "2026-09-01" },
    { marker: "other", label: "Homocysteine", value: 12, unit: "µmol/L", test_date: "2026-09-01" },
    { marker: "haemoglobin", value: 13, unit: "g/dL", test_date: "2026-01-01" },
  ];
  const latest = latestPerMarker(rows);
  assert.deepEqual(latest.map((row) => `${row.marker}:${row.value}`), ["haemoglobin:13", "vitamin_d:31", "other:12"]);
});

test("the line Nox is given says the value, the date and how it compares", () => {
  assert.equal(labLine({ marker: "vitamin_d", value: "14.000", unit: "ng/mL", test_date: "2026-09-01" }), "Vitamin D (25-OH): 14 ng/mL on 2026-09-01, below the usual range (30–100 ng/mL)");
  assert.equal(labLine({ marker: "other", label: "Homocysteine", value: 12, unit: "µmol/L", test_date: "2026-09-01T00:00:00Z" }), "Homocysteine: 12 µmol/L on 2026-09-01");
});
