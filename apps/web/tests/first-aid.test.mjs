// First aid on the emergency page (DESIGN.md 7.7a): every guide is complete, sourced, and short enough to read in a hurry.
import { test } from "node:test";
import assert from "node:assert/strict";
import { FIRST_AID } from "../lib/emergency/first-aid.ts";

test("each guide has steps, don'ts and at least one source, with unique ids", () => {
  assert.equal(new Set(FIRST_AID.map((guide) => guide.id)).size, FIRST_AID.length);
  for (const guide of FIRST_AID) {
    assert.ok(guide.dos.length >= 2 && guide.dos.length <= 6, `${guide.id}: 2 to 6 steps`);
    assert.ok(guide.donts.length >= 1, `${guide.id}: at least one don't`);
    assert.ok(guide.sources.length >= 1 && guide.sources.every((source) => source.url.startsWith("https://")), `${guide.id}: https sources`);
    for (const line of [...guide.dos, ...guide.donts]) assert.ok(line.length <= 140, `${guide.id}: short lines ("${line.slice(0, 30)}…")`);
  }
});

test("the life-threatening ones start with calling 112, and the known dangerous remedies are warned against", () => {
  const byId = Object.fromEntries(FIRST_AID.map((guide) => [guide.id, guide]));
  for (const id of ["cpr", "choking", "snakebite", "heatstroke"]) assert.equal(byId[id].call112, true, id);
  assert.match(byId.snakebite.donts.join(" "), /tourniquet/);
  assert.match(byId.snakebite.donts.join(" "), /cut, suck/);
  assert.match(byId.burns.donts.join(" "), /ice/i);
  assert.match(byId.burns.dos.join(" "), /20 minutes/);
  assert.match(byId.dogbite.dos.join(" "), /15 minutes/);
  assert.match(byId.dogbite.dos.join(" "), /rabies vaccine/);
  assert.match(byId.heatstroke.donts.join(" "), /No drinks if they're confused/);
});
