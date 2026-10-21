import { test } from "node:test";
import assert from "node:assert/strict";
import { REQUIRED_CONSENTS, missingConsents } from "../src/consent.js";

test("asks for every required consent until each is stored with the current version", () => {
  assert.deepEqual(missingConsents([]).sort(), ["age_18", "ai_processing", "terms"]);
  const all = Object.entries(REQUIRED_CONSENTS).map(([doc_type, version]) => ({ doc_type, version }));
  assert.deepEqual(missingConsents(all), []);
  const old = all.map((row) => (row.doc_type === "terms" ? { ...row, version: "2020-01-01" } : row));
  assert.deepEqual(missingConsents(old), ["terms"], "a new version asks again");
  assert.deepEqual(missingConsents(null).length, 3);
});
