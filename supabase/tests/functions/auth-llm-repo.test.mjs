// Sign-in checking with real signatures, the AI adapter's retry rules, and the exact database requests.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bearerToken, createTokenVerifier } from "../../functions/_shared/auth.ts";
import { createLlm, LlmError, parseJsonObject } from "../../functions/_shared/llm.ts";
import { createRestClient, RestError } from "../../functions/_shared/rest.ts";
import { createRestRepo } from "../../functions/_shared/repo.ts";
import { USER_ID, uuid } from "./support.mjs";

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------
const b64url = (input) => Buffer.from(typeof input === "string" ? input : JSON.stringify(input)).toString("base64url");
const SUPABASE = "https://project.supabase.co";

async function signer() {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid: "key-1", alg: "ES256", use: "sig" };
  const sign = async (claims, header = { alg: "ES256", typ: "JWT", kid: "key-1" }) => {
    const body = `${b64url(header)}.${b64url(claims)}`;
    const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, new TextEncoder().encode(body));
    return `${body}.${Buffer.from(signature).toString("base64url")}`;
  };
  return { jwk, sign };
}

const goodClaims = (extra = {}) => ({
  sub: USER_ID,
  role: "authenticated",
  aud: "authenticated",
  iss: `${SUPABASE}/auth/v1`,
  exp: Math.floor(Date.now() / 1000) + 600,
  is_anonymous: false,
  ...extra,
});

const jwksFetch = (jwks, counter = { n: 0 }, userReply = null) => async (url) => {
  const target = String(url);
  if (target.endsWith("/.well-known/jwks.json")) {
    counter.n += 1;
    return new Response(JSON.stringify({ keys: jwks }), { status: 200 });
  }
  if (target.endsWith("/auth/v1/user")) return userReply ? userReply() : new Response("{}", { status: 401 });
  return new Response("no", { status: 404 });
};

test("tokens: a correctly signed, current user token is accepted; guests are recognised", async () => {
  const { jwk, sign } = await signer();
  const counter = { n: 0 };
  const verify = createTokenVerifier({ supabaseUrl: SUPABASE, publishableKey: "pk", fetch: jwksFetch([jwk], counter) });
  assert.deepEqual(await verify(await sign(goodClaims())), { id: USER_ID, isAnonymous: false });
  assert.deepEqual(await verify(await sign(goodClaims({ is_anonymous: true }))), { id: USER_ID, isAnonymous: true });
  assert.equal(counter.n, 1, "the signing keys are fetched once and reused");
});

test("tokens: forged, expired, wrong-audience and key-role tokens are all refused", async () => {
  const { jwk, sign } = await signer();
  const other = await signer();
  const verify = createTokenVerifier({ supabaseUrl: SUPABASE, publishableKey: "pk", fetch: jwksFetch([jwk]) });
  const refuse = async (token, why) => await assert.rejects(verify(token), (error) => error.code === "unauthenticated", why);

  await refuse(await other.sign(goodClaims()), "signed with another key");
  await refuse(await sign(goodClaims({ exp: Math.floor(Date.now() / 1000) - 5 })), "expired");
  await refuse(await sign(goodClaims({ role: "service_role" })), "a service-role token is not a person");
  await refuse(await sign(goodClaims({ role: "anon" })), "the public key is not a person");
  await refuse(await sign(goodClaims({ aud: "something-else" })), "wrong audience");
  await refuse(await sign(goodClaims({ iss: "https://evil.example/auth/v1" })), "wrong issuer");
  await refuse(await sign(goodClaims({ sub: "not-a-uuid" })), "no valid user id");
  await refuse("a.b.c", "garbage");
  await refuse("only.two", "wrong shape");

  const tampered = (await sign(goodClaims())).split(".");
  tampered[1] = b64url(goodClaims({ sub: "99999999-9999-4999-8999-999999999999" }));
  await refuse(tampered.join("."), "claims changed after signing");

  const none = `${b64url({ alg: "none", typ: "JWT" })}.${b64url(goodClaims())}.`;
  await refuse(none, "unsigned token");
});

test("tokens: a rotated signing key is picked up; unknown algorithms fall back to asking Auth", async () => {
  const first = await signer();
  const second = await signer();
  const counter = { n: 0 };
  let keys = [first.jwk];
  const verify = createTokenVerifier({
    supabaseUrl: SUPABASE,
    publishableKey: "pk",
    fetch: async (url) => {
      if (String(url).endsWith("jwks.json")) {
        counter.n += 1;
        return new Response(JSON.stringify({ keys }), { status: 200 });
      }
      return new Response("{}", { status: 401 });
    },
  });
  await verify(await first.sign(goodClaims()));
  keys = [first.jwk, { ...second.jwk, kid: "key-2" }];
  assert.equal((await verify(await second.sign(goodClaims(), { alg: "ES256", typ: "JWT", kid: "key-2" }))).id, USER_ID);
  assert.equal(counter.n, 2);

  // A legacy HS256 token cannot be checked here, so Auth is asked.
  const legacy = `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(goodClaims())}.${b64url("sig")}`;
  const asks = [];
  const ask = createTokenVerifier({
    supabaseUrl: SUPABASE,
    publishableKey: "pk",
    fetch: async (url, init) => {
      asks.push([String(url), init.headers.Authorization]);
      return new Response(JSON.stringify({ id: USER_ID, role: "authenticated", is_anonymous: true }), { status: 200 });
    },
  });
  assert.deepEqual(await ask(legacy), { id: USER_ID, isAnonymous: true });
  assert.match(asks[0][0], /\/auth\/v1\/user$/);
  const rejecting = createTokenVerifier({ supabaseUrl: SUPABASE, publishableKey: "pk", fetch: async () => new Response("{}", { status: 401 }) });
  await assert.rejects(rejecting(legacy), (error) => error.code === "unauthenticated");
});

test("security: tokens with made-up key ids can't make every request fetch the signing keys again", async () => {
  const { jwk, sign } = await signer();
  const counter = { n: 0 };
  let clock = Date.now();
  const verify = createTokenVerifier({ supabaseUrl: SUPABASE, publishableKey: "pk", fetch: jwksFetch([jwk], counter), now: () => clock });
  await verify(await sign(goodClaims()));
  for (let i = 0; i < 10; i++) {
    await assert.rejects(verify(await sign(goodClaims(), { alg: "ES256", typ: "JWT", kid: `made-up-${i}` })), (error) => error.code === "unauthenticated");
  }
  assert.equal(counter.n, 2, "one normal fetch, then one refetch for the unknown key id");
  clock += 31_000;
  await assert.rejects(verify(await sign(goodClaims(), { alg: "ES256", typ: "JWT", kid: "made-up-later" })), (error) => error.code === "unauthenticated");
  assert.equal(counter.n, 3, "after 30 seconds a refetch is allowed again");
});

test("tokens: the Authorization header must be a Bearer token of the right shape", () => {
  const req = (value) => new Request("https://x.test", { headers: value ? { authorization: value } : {} });
  assert.equal(bearerToken(req("Bearer aaa.bbb.ccc")), "aaa.bbb.ccc");
  for (const bad of [null, "Basic abc", "Bearer", "Bearer a.b", "Bearer sb_publishable_abc"]) {
    assert.throws(() => bearerToken(req(bad)), (error) => error.code === "unauthenticated", String(bad));
  }
});

// ---------------------------------------------------------------------------
// The AI adapter
// ---------------------------------------------------------------------------
const okBody = (text, extra = {}) => JSON.stringify({ model: "m", choices: [{ message: { content: text }, finish_reason: "stop" }], usage: { prompt_tokens: 11, completion_tokens: 7 }, ...extra });
const request = (extra = {}) => ({ model: "m", messages: [{ role: "user", content: "hi" }], maxTokens: 100, temperature: 0, timeoutMs: 2000, ...extra });

test("AI: sends the right request and reads text and token counts", async () => {
  const seen = [];
  const llm = createLlm({
    baseUrl: "https://llm.example/v1",
    apiKey: "secret",
    fetch: async (url, init) => {
      seen.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) });
      return new Response(okBody('{"a":1}'), { status: 200 });
    },
  });
  const result = await llm.complete(request({ json: true }));
  assert.equal(result.text, '{"a":1}');
  assert.deepEqual(result.usage, { tokens_in: 11, tokens_out: 7 });
  assert.equal(seen[0].url, "https://llm.example/v1/chat/completions");
  assert.equal(seen[0].headers.Authorization, "Bearer secret");
  assert.deepEqual(seen[0].body.response_format, { type: "json_object" });
  assert.equal(seen[0].body.max_tokens, 100);
  assert.equal(seen[0].body.stream, false);
});

test("AI: retries once on a busy server, never on a refusal, gives up after that", async () => {
  const run = async (statuses, retries) => {
    let calls = 0;
    const llm = createLlm({
      baseUrl: "https://llm.example/v1",
      apiKey: "k",
      backoffMs: 1,
      retries,
      fetch: async () => {
        const status = statuses[Math.min(calls++, statuses.length - 1)];
        return status === 200 ? new Response(okBody("fine"), { status }) : new Response("x", { status });
      },
    });
    const outcome = await llm.complete(request()).then((r) => r.text, (e) => e);
    return { outcome, calls };
  };
  assert.deepEqual(await run([503, 200], 1), { outcome: "fine", calls: 2 });
  assert.equal((await run([503, 503], 1)).calls, 2);
  assert.ok((await run([503, 503], 1)).outcome instanceof LlmError);
  assert.equal((await run([401, 200], 1)).calls, 1, "a bad key is not retried");
  assert.equal((await run([503, 200], 0)).calls, 1, "retries can be switched off per call");
});

test("AI: if JSON mode is refused, it tries once more without it", async () => {
  const bodies = [];
  const llm = createLlm({
    baseUrl: "https://llm.example/v1",
    apiKey: "k",
    backoffMs: 1,
    fetch: async (url, init) => {
      const body = JSON.parse(init.body);
      bodies.push(body);
      return body.response_format ? new Response("unsupported", { status: 400 }) : new Response(okBody("{}"), { status: 200 });
    },
  });
  assert.equal((await llm.complete(request({ json: true }))).text, "{}");
  assert.equal(bodies.length, 2);
  assert.equal("response_format" in bodies[1], false);
  // bug review 2026-10-20: also for calls with no retries (the safety extraction).
  bodies.length = 0;
  assert.equal((await llm.complete(request({ json: true, retries: 0 }))).text, "{}");
  assert.equal(bodies.length, 2);
});

const sseStream = (chunks, { cut = false } = {}) => {
  const encoder = new TextEncoder();
  let i = 0;
  return new Response(
    new ReadableStream({
      pull(controller) {
        if (i < chunks.length) controller.enqueue(encoder.encode(chunks[i++]));
        else if (cut) controller.error(new Error("connection reset"));
        else controller.close();
      },
    }),
    { status: 200 },
  );
};
const delta = (text) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;

test("AI streaming: passes pieces through, reads usage, copes with split lines", async () => {
  const pieces = [];
  const llm = createLlm({
    baseUrl: "https://llm.example/v1",
    apiKey: "k",
    fetch: async () =>
      sseStream([delta("Hel"), "data: " + JSON.stringify({ choices: [{ delta: { content: "lo" } }] }).slice(0, 20), JSON.stringify({ choices: [{ delta: { content: "lo" } }] }).slice(20) + "\n\n", `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 5, completion_tokens: 2 } })}\n\n`, "data: [DONE]\n\n"]),
  });
  const result = await llm.stream({ ...request(), firstTokenTimeoutMs: 1000, onDelta: (t) => pieces.push(t) });
  assert.equal(result.text, "Hello");
  assert.deepEqual(pieces, ["Hel", "lo"]);
  assert.deepEqual(result.usage, { tokens_in: 5, tokens_out: 2 });
});

test("AI streaming: a failure before anything arrived is retried; after text arrived it is not repeated", async () => {
  let calls = 0;
  const before = createLlm({
    baseUrl: "https://llm.example/v1",
    apiKey: "k",
    backoffMs: 1,
    fetch: async () => (++calls === 1 ? new Response("busy", { status: 503 }) : sseStream([delta("ok"), "data: [DONE]\n\n"])),
  });
  assert.equal((await before.stream({ ...request(), firstTokenTimeoutMs: 1000, onDelta() {} })).text, "ok");
  assert.equal(calls, 2);

  calls = 0;
  const seen = [];
  const after = createLlm({
    baseUrl: "https://llm.example/v1",
    apiKey: "k",
    backoffMs: 1,
    fetch: async () => (++calls, sseStream([delta("par"), delta("tial")], { cut: true })),
  });
  await assert.rejects(after.stream({ ...request(), firstTokenTimeoutMs: 1000, onDelta: (t) => seen.push(t) }), LlmError);
  assert.equal(calls, 1, "text was already delivered, so the same words are never sent twice");
  assert.deepEqual(seen, ["par", "tial"]);
});

test("AI streaming: gives up if no first text arrives in time", async () => {
  const llm = createLlm({
    baseUrl: "https://llm.example/v1",
    apiKey: "k",
    retries: 0,
    fetch: (url, init) =>
      new Promise((resolve, reject) => init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })))),
  });
  const started = Date.now();
  await assert.rejects(llm.stream({ ...request({ timeoutMs: 5000 }), firstTokenTimeoutMs: 60, onDelta() {} }), (error) => error instanceof LlmError && error.reason === "timeout");
  assert.ok(Date.now() - started < 1500);
});

test("AI: pulls a JSON object out of a fenced or chatty reply", () => {
  assert.deepEqual(parseJsonObject('Sure! ```json\n{"a": 1}\n``` done'), { a: 1 });
  assert.equal(parseJsonObject("no json"), null);
  assert.equal(parseJsonObject("[1,2]"), null);
  assert.equal(parseJsonObject("{broken"), null);
});

// ---------------------------------------------------------------------------
// The database requests
// ---------------------------------------------------------------------------
function recordingRepo(reply = () => ({ status: 200, body: [] })) {
  const calls = [];
  const rest = createRestClient({
    supabaseUrl: "https://project.supabase.co",
    secretKey: "sb_secret_abc",
    fetch: async (url, init) => {
      const u = new URL(String(url));
      const record = { method: init.method, path: u.pathname, query: Object.fromEntries(u.searchParams), headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined };
      calls.push(record);
      const { status, body } = reply(record);
      return new Response(body === undefined ? "" : JSON.stringify(body), { status });
    },
  });
  return { repo: createRestRepo(rest, () => Date.parse("2026-10-19T10:00:00Z")), calls };
}

test("database: every read is limited to the caller's own rows (the secret key skips row-level security)", async () => {
  const { repo, calls } = recordingRepo();
  const c = uuid(7);
  await repo.getProfile(USER_ID);
  await repo.getHealthProfile(USER_ID);
  await repo.getConsents(USER_ID);
  await repo.findUserMessage(USER_ID, c, uuid(8));
  await repo.findAnswer(USER_ID, uuid(9));
  await repo.loadHistory(USER_ID, c, 8);
  await repo.loadForSummary(USER_ID, [c]);
  for (const call of calls) {
    const filter = call.query.user_id ?? call.query.id;
    assert.equal(filter, `eq.${USER_ID}`, `${call.path} must filter by the user`);
  }
  assert.equal(calls.length, 8, "loadForSummary makes two reads");
});

test("database: secret keys are sent as apikey only; old JWT-style keys also as a Bearer token", async () => {
  const { repo, calls } = recordingRepo();
  await repo.getProfile(USER_ID);
  assert.equal(calls[0].headers.apikey, "sb_secret_abc");
  assert.equal("Authorization" in calls[0].headers, false);

  const legacyCalls = [];
  const legacy = createRestClient({ supabaseUrl: SUPABASE, secretKey: "aaa.bbb.ccc", fetch: async (u, init) => (legacyCalls.push(init.headers), new Response("[]")) });
  await legacy.get("/rest/v1/profiles");
  assert.equal(legacyCalls[0].Authorization, "Bearer aaa.bbb.ccc");
});

test("database: writes use the right conflict handling", async () => {
  const { repo, calls } = recordingRepo((call) => (call.path.endsWith("/conversations") && call.method === "GET" ? { status: 200, body: [{ id: uuid(7), title: null }] } : { status: 201, body: undefined }));
  const claimed = await repo.claimConversation(USER_ID, uuid(7), "en");
  assert.deepEqual(claimed, { id: uuid(7), title: null });
  assert.equal(calls[0].query.on_conflict, "id");
  assert.match(calls[0].headers.Prefer, /ignore-duplicates/);
  assert.equal(calls[1].query.user_id, `eq.${USER_ID}`, "the follow-up read proves the conversation is the caller's");

  await repo.cacheSet("k", "openfda", { a: 1 }, 3600);
  const write = calls.at(-1);
  assert.match(write.headers.Prefer, /merge-duplicates/);
  assert.equal(write.body.expires_at, "2026-10-19T11:00:00.000Z");

  await repo.setTitleIfEmpty(USER_ID, uuid(7), "Headache", "headache");
  const patch = calls.at(-1);
  assert.equal(patch.method, "PATCH");
  assert.deepEqual([patch.query.id, patch.query.user_id, patch.query.title], [`eq.${uuid(7)}`, `eq.${USER_ID}`, "is.null"]);

  await repo.consumeQuota(USER_ID, 8, "Asia/Kolkata").catch(() => {});
  assert.equal(calls.at(-1).path, "/rest/v1/rpc/consume_quota");
  assert.deepEqual(calls.at(-1).body, { p_user: USER_ID, p_limit: 8, p_timezone: "Asia/Kolkata" });

  await repo.deleteAuthUser(USER_ID);
  assert.deepEqual([calls.at(-1).method, calls.at(-1).path], ["DELETE", `/auth/v1/admin/users/${USER_ID}`]);
});

test("database: a duplicate message is reported as such, other failures are not hidden", async () => {
  const dup = recordingRepo(() => ({ status: 409, body: { code: "23505" } }));
  assert.equal(await dup.repo.insertMessage({ id: uuid(1), conversation_id: uuid(2), user_id: USER_ID, role: "user", content: "x" }), "duplicate");
  const broken = recordingRepo(() => ({ status: 500, body: { code: "XX000" } }));
  await assert.rejects(broken.repo.insertMessage({ id: uuid(1), conversation_id: uuid(2), user_id: USER_ID, role: "user", content: "x" }), RestError);
});
