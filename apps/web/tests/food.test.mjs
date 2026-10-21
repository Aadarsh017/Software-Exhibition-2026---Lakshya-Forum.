// Thali (DESIGN.md 8.6g): the meal form, days in the person's own time zone, and how a meal reads.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dayFrom, dayLabel, draftFrom, isMeal, localDay, mealSummary, shiftDay, toFoodRow } from "../lib/food/food.ts";

test("the meal form: cleans the list, needs something, keeps the limits", () => {
  const ok = toFoodRow({ items: [" poha ", "Poha", "chai", ""], portion: "light", outside: false, note: "  " }, "2026-10-19", "breakfast");
  assert.deepEqual(ok, { ok: true, row: { day: "2026-10-19", meal: "breakfast", items: ["poha", "chai"], portion: "light", outside: false, note: null } });
  assert.equal(toFoodRow({ items: [], portion: null, outside: true, note: "" }, "2026-10-19", "lunch").ok, false);
  assert.equal(toFoodRow({ items: [], portion: null, outside: false, note: "Skipped, felt sick" }, "2026-10-19", "lunch").ok, true);
  const many = toFoodRow({ items: Array.from({ length: 20 }, (_, i) => `Item ${i}`), portion: null, outside: false, note: "" }, "2026-10-19", "dinner");
  assert.equal(many.row.items.length, 15);
  assert.equal(toFoodRow({ items: ["x".repeat(80)], portion: null, outside: false, note: "" }, "2026-10-19", "dinner").row.items[0].length, 60);
  assert.deepEqual(draftFrom(null), { items: [], portion: null, outside: false, note: "" });
  assert.equal(isMeal("snacks"), true);
  assert.equal(isMeal("brunch"), false);
});

test("days: local dates, never the future, readable labels", () => {
  const now = new Date(2026, 9, 19, 21, 30);
  assert.equal(localDay(now), "2026-10-19");
  assert.equal(shiftDay("2026-10-01", -1), "2026-09-30");
  assert.equal(shiftDay("2026-12-31", 1), "2027-01-01");
  assert.equal(dayFrom("2026-10-17", now), "2026-10-17");
  assert.equal(dayFrom("2026-10-25", now), "2026-10-19", "no future days");
  assert.equal(dayFrom("2026-02-30", now), "2026-10-19", "not a real date");
  assert.equal(dayFrom("yesterday", now), "2026-10-19");
  assert.equal(dayFrom(null, now), "2026-10-19");
  assert.equal(dayLabel("2026-10-19", now), "Today, 19 Oct");
  assert.equal(dayLabel("2026-10-18", now), "Yesterday, 18 Oct");
  assert.equal(dayLabel("2026-10-12", now), "Mon, 12 Oct");
  assert.equal(dayLabel("2025-12-31", now), "Wed, 31 Dec 2025");
});

test("a meal reads in a few words", () => {
  const row = { id: "a", day: "2026-10-19", meal: "lunch", items: ["Dal", "Rice", "Salad", "Curd", "Papad"], portion: "heavy", outside: true, note: null };
  assert.equal(mealSummary(row), "Dal, Rice, Salad +2 · heavy · outside food");
  assert.equal(mealSummary({ ...row, items: [], portion: null, outside: false, note: "Skipped" }), "Skipped");
  assert.equal(mealSummary(null), null);
});
