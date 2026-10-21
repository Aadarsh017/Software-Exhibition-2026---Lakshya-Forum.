// Sidebar search (DESIGN.md 8.5): titles and the words inside messages.
import { test } from "node:test";
import assert from "node:assert/strict";
import { likePattern, searchResults, snippetAround } from "../lib/history/search.ts";

const items = [
  { id: "a", title: "Fever and headache", updated_at: "2026-10-19T10:00:00Z", max_care_level: "doctor" },
  { id: "b", title: "Can't sleep", updated_at: "2026-10-18T10:00:00Z", max_care_level: null },
  { id: "c", title: null, updated_at: "2026-10-17T10:00:00Z", max_care_level: null },
];

test("the LIKE pattern matches what was typed, wildcards included", () => {
  assert.equal(likePattern("  fever "), "%fever%");
  assert.equal(likePattern("100%"), "%100\\%%");
  assert.equal(likePattern("a_b\\c"), "%a\\_b\\\\c%");
});

test("a short line around the first match, cut with …", () => {
  const text = "I have had a mild headache since yesterday morning, and paracetamol helped a little but it came back at night.";
  assert.equal(snippetAround(text, "paracetamol", 12), "…and paracetamol helped a…");
  assert.equal(snippetAround("Rash on   my\narm", "rash"), "Rash on my arm");
  assert.equal(snippetAround("nothing here", "fever"), null);
});

test("results: title matches and message matches, newest first, with the line", () => {
  const hits = [
    { conversation_id: "b", content: "I wake up at 3am and my heart is racing" },
    { conversation_id: "b", content: "heart again" },
    { conversation_id: "c", content: null },
  ];
  assert.deepEqual(searchResults(items, "heart", hits).map((r) => [r.item.id, r.snippet]), [["b", "I wake up at 3am and my heart is racing"]]);
  assert.deepEqual(searchResults(items, "fever", []).map((r) => [r.item.id, r.snippet]), [["a", null]]);
  assert.deepEqual(searchResults(items, "Fever", [{ conversation_id: "a", content: "fever of 38.5 since Monday" }]).map((r) => [r.item.id, r.snippet]), [["a", "fever of 38.5 since Monday"]]);
  assert.equal(searchResults(items, "", hits).length, 3, "no query: everything, no lines");
  assert.deepEqual(searchResults(items, "zzz", hits), []);
});
