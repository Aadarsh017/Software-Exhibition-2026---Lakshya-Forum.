// Security review 2026-10-20: after sign-in, only pages inside the app; never another site, however it is spelled.
import { test } from "node:test";
import assert from "node:assert/strict";
import { safeNext } from "../lib/auth/safe-next.ts";

test("pages inside the app pass, with their query and hash", () => {
  assert.equal(safeNext("/app"), "/app");
  assert.equal(safeNext("/app/settings"), "/app/settings");
  assert.equal(safeNext("/app/personalization?section=about#top"), "/app/personalization?section=about#top");
});

test("other sites and odd spellings fall back to /app", () => {
  for (const bad of ["//evil.com", "/\\evil.com", "/\tevil.com", "/\t/evil.com", "/%5Cevil.com", "https://evil.com", "evil.com", "/\nevil", "/login", "/", "/application", "/app/../login", "", null, undefined, "/\\/evil.com", "/ /evil.com"]) {
    const out = safeNext(bad);
    assert.ok(out === "/app" || out.startsWith("/app/") || out.startsWith("/app?"), `${JSON.stringify(bad)} -> ${out}`);
    assert.ok(!out.includes("evil"), `${JSON.stringify(bad)} -> ${out}`);
  }
  assert.equal(safeNext("/app/../login"), "/app", "a path that climbs out of /app is refused");
});
