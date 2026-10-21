// The sign-in emails must stay safe and simple: code and link present, nothing that phones home.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const NAMES = ["magic_link", "confirmation", "email_change"];
const html = (name) => readFileSync(join(root, "supabase", "templates", `${name}.html`), "utf8");

test("the files on disk match the generator", () => {
  execFileSync("node", [join(root, "scripts", "build-email-templates.mjs"), "--check"], { stdio: "pipe" });
});

for (const name of NAMES) {
  test(`${name}: shows the code and a fallback link`, () => {
    const source = html(name);
    assert.match(source, /\{\{ \.Token \}\}/, "needs the 6-digit code");
    assert.match(source, /href="\{\{ \.ConfirmationURL \}\}"/, "needs the link as a fallback");
    assert.match(source, /works for 15 minutes/, "must match otp_expiry = 900 in config.toml");
    assert.match(source, /call 112/i, "keeps the emergency line");
  });

  test(`${name}: nothing that loads or runs anything`, () => {
    const source = html(name);
    assert.doesNotMatch(source, /<script|<img|<link|<iframe|@import|url\(/i);
    // The only URL allowed is the Supabase placeholder; no hard-coded links or trackers.
    assert.doesNotMatch(source.replace(/\{\{ \.ConfirmationURL \}\}/g, ""), /https?:\/\//i);
  });

  test(`${name}: only known Supabase placeholders, small, accessible`, () => {
    const source = html(name);
    const placeholders = new Set(source.match(/\{\{[^}]+\}\}/g));
    for (const placeholder of placeholders) {
      assert.ok(["{{ .Token }}", "{{ .ConfirmationURL }}"].includes(placeholder), `unexpected placeholder ${placeholder}`);
    }
    assert.ok(source.length < 10_000, "email clients clip long messages");
    assert.match(source, /<html lang="en">/);
    assert.match(source, /<title>[^<]+<\/title>/);
    assert.match(source, /role="presentation"/);
  });
}
