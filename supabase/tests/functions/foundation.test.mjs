// The small building blocks: streaming JSON reader, SSE, CORS, errors, logging, settings, rate limit.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createFieldStream } from "../../functions/_shared/json-stream.ts";
import { createSse } from "../../functions/_shared/sse.ts";
import { corsHeaders, errorResponse, isUuid, readJsonObject } from "../../functions/_shared/http.ts";
import { AppError } from "../../functions/_shared/errors.ts";
import { createLogger } from "../../functions/_shared/log.ts";
import { ConfigError, loadConfig } from "../../functions/_shared/config.ts";
import { createRateLimiter } from "../../functions/_shared/rate.ts";
import { testConfig } from "./support.mjs";

const collect = (text, size = 5) => {
  const seen = [];
  const stream = createFieldStream((name, value) => seen.push([name, value]));
  for (let i = 0; i < text.length; i += size) stream.push(text.slice(i, i + size));
  return { seen, ...stream.end() };
};

test("JSON reader: each field is reported as soon as it is complete, however the text is chopped", () => {
  const json = JSON.stringify({ care_level: "doctor", headline: 'He said "hi", {ok}', list: [{ text: "a, b", source_ids: ["S1"] }], n: 12, flag: true, nothing: null, tail: "end" });
  for (const size of [1, 2, 3, 7, 50, 500]) {
    const { seen, complete, fields } = collect(json, size);
    assert.deepEqual(seen.map(([name]) => name), ["care_level", "headline", "list", "n", "flag", "nothing", "tail"], `chunk size ${size}`);
    assert.equal(fields.headline, 'He said "hi", {ok}');
    assert.deepEqual(fields.list, [{ text: "a, b", source_ids: ["S1"] }]);
    assert.equal(complete, true);
  }
});

test("JSON reader: a field appears before the rest of the text has arrived", () => {
  const seen = [];
  const stream = createFieldStream((name) => seen.push(name));
  stream.push('{"care_level": "doctor", "headline": "Abc');
  assert.deepEqual(seen, ["care_level"], "the unfinished headline is not reported yet");
  stream.push('def", "summary": "xy');
  assert.deepEqual(seen, ["care_level", "headline"]);
  stream.push('z"}');
  assert.deepEqual(seen, ["care_level", "headline", "summary"]);
});

test("JSON reader: skips a code fence, ignores trailing text, survives cut-off and bad values", () => {
  const fenced = collect('```json\n{"a": "1", "b": [1, 2]}\n```\nHope this helps!');
  assert.deepEqual(fenced.fields, { a: "1", b: [1, 2] });
  assert.equal(fenced.complete, true);

  const cut = collect('{"a": "done", "b": ["unfinished", "list');
  assert.deepEqual(cut.fields, { a: "done" });
  assert.equal(cut.complete, false);

  const escaped = collect('{"a": "line\\nbreak \\"q\\" \\\\ \\u00e9"}');
  assert.equal(escaped.fields.a, 'line\nbreak "q" \\ é');

  const empty = collect("no json at all");
  assert.deepEqual(empty.fields, {});
});

test("SSE: sends a comment first, then events, and stops quietly when the browser goes away", async () => {
  const { stream, writer } = createSse({ heartbeatMs: 5 });
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  assert.match(decoder.decode((await reader.read()).value), /^: connected/);
  assert.equal(writer.send("meta", { a: 1 }), true);
  assert.equal(decoder.decode((await reader.read()).value), 'event: meta\ndata: {"a":1}\n\n');
  const beat = decoder.decode((await reader.read()).value);
  assert.match(beat, /^: ping/);
  await reader.cancel();
  assert.equal(writer.send("x", {}), false, "sending after the reader left is a harmless no-op");
  assert.equal(writer.closed, true);
});

test("CORS: only listed origins are echoed", () => {
  const allowed = ["http://localhost:3000", "https://app.example"];
  assert.equal(corsHeaders("http://localhost:3000/", allowed)["Access-Control-Allow-Origin"], "http://localhost:3000/");
  assert.equal(corsHeaders("https://evil.example", allowed)["Access-Control-Allow-Origin"], undefined);
  assert.equal(corsHeaders(null, allowed)["Access-Control-Allow-Origin"], undefined);
  assert.equal(corsHeaders("https://x.example", ["*"])["Access-Control-Allow-Origin"], "*");
  assert.match(corsHeaders("http://localhost:3000", allowed)["Access-Control-Allow-Headers"], /authorization/);
});

test("requests: JSON only, size-limited, objects only", async () => {
  const make = (body, type = "application/json") => new Request("https://x.test", { method: "POST", headers: { "content-type": type }, body });
  assert.deepEqual(await readJsonObject(make('{"a":1}'), 100), { a: 1 });
  await assert.rejects(readJsonObject(make("[1]"), 100), /JSON object/);
  await assert.rejects(readJsonObject(make("{bad"), 100), /valid JSON/);
  await assert.rejects(readJsonObject(make('{"a":"' + "x".repeat(200) + '"}'), 100), /too long/);
  await assert.rejects(readJsonObject(make("{}", "text/plain"), 100), /JSON/);
  // security: a streamed body with no length is cut off as soon as it passes the limit, not read to the end
  let pulled = 0;
  const endless = new ReadableStream({
    pull(controller) {
      pulled += 1;
      controller.enqueue(new TextEncoder().encode("x".repeat(64)));
    },
  });
  const streamed = new Request("https://x.test", { method: "POST", headers: { "content-type": "application/json" }, body: endless, duplex: "half" });
  await assert.rejects(readJsonObject(streamed, 100), /too long/);
  assert.ok(pulled < 10, `stopped after ${pulled} chunks`);
  assert.deepEqual(await readJsonObject(make('{"name":"Asha ✓"}'), 100), { name: "Asha ✓" });
  assert.equal(isUuid("00000000-0000-4000-8000-000000000001"), true);
  assert.equal(isUuid("not-a-uuid"), false);
});

test("errors: a stable shape, the right status, and retry hints", async () => {
  const response = errorResponse(new AppError("quota_exceeded", "Come back tomorrow.", { limit: 8, resets_at: "x" }), { "X-Test": "1" });
  assert.equal(response.status, 429);
  assert.deepEqual(await response.json(), { error: { code: "quota_exceeded", message: "Come back tomorrow.", retryable: false, limit: 8, resets_at: "x" } });
  const limited = errorResponse(new AppError("rate_limited", "Slow down.", { retry_after_s: 12.2 }));
  assert.equal(limited.headers.get("Retry-After"), "13");
  const unknown = errorResponse(new Error("secret internal detail"));
  assert.equal(unknown.status, 500);
  const text = JSON.stringify(await unknown.json());
  assert.doesNotMatch(text, /secret internal detail/, "unexpected errors never leak their message");
});

test("logs: only allow-listed fields, short strings, never content", () => {
  const lines = [];
  const log = createLogger("chat", (line) => lines.push(JSON.parse(line)));
  log.info("turn", { user: "u1", ms: 12, message_text: "I have chest pain", answer: "x", email: "a@b.c", rule_ids: ["chest-pain"], reason: "x".repeat(500) });
  const [line] = lines;
  assert.equal(line.user, "u1");
  assert.deepEqual(line.rule_ids, ["chest-pain"]);
  assert.equal(line.reason.length, 80);
  for (const banned of ["message_text", "answer", "email"]) assert.equal(banned in line, false, banned);
});

test("settings: reads the platform keys, applies defaults, names what is missing", () => {
  const config = testConfig();
  assert.equal(config.quota.guest, 8);
  assert.equal(config.quota.member, 30);
  assert.equal(config.aiEnabled, true);
  assert.equal(config.llm.modelFast, "fast-model");
  assert.equal(testConfig({ AI_ENABLED: "false" }).aiEnabled, false, "the kill switch");
  assert.equal(testConfig({ LLM_API_KEY: "" }).aiEnabled, false, "no AI key means no AI");
  assert.equal(testConfig({ LLM_MODEL_FAST: "" }).llm.modelFast, "main-model", "fast model falls back to the main one");
  assert.equal(testConfig({ QUOTA_GUEST: "abc" }).quota.guest, 8, "bad numbers fall back to the default");
  assert.deepEqual(testConfig({ SUPABASE_SECRET_KEYS: '{"default":"sb_secret_x"}', SUPABASE_SERVICE_ROLE_KEY: "" }).secretKey, "sb_secret_x");
  assert.throws(() => loadConfig(() => undefined), (error) => error instanceof ConfigError && error.missing.length === 3 && !/key-value/.test(error.message));
});

test("burst limiter: allows a few per minute, says how long to wait, forgets after a minute", () => {
  let now = 1_000_000;
  const rate = createRateLimiter(3, () => now);
  for (let i = 0; i < 3; i++) assert.equal(rate("u").ok, true);
  const blocked = rate("u");
  assert.equal(blocked.ok, false);
  assert.ok(blocked.retryAfterSeconds >= 1 && blocked.retryAfterSeconds <= 60);
  assert.equal(rate("someone-else").ok, true, "per person");
  now += 61_000;
  assert.equal(rate("u").ok, true);
});
