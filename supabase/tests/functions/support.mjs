// Fakes for testing the Edge Function code without a network, a database or an AI.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../../functions/_shared/config.ts";
import { AppError } from "../../functions/_shared/errors.ts";
import { createLogger } from "../../functions/_shared/log.ts";
import { createRateLimiter } from "../../functions/_shared/rate.ts";
import { REQUIRED_CONSENTS } from "../../../packages/shared/src/consent.js";

const here = dirname(fileURLToPath(import.meta.url));
export const fixture = (name) => readFileSync(join(here, "..", "fixtures", name), "utf8");

export const USER_ID = "11111111-1111-4111-8111-111111111111";
export const OTHER_ID = "22222222-2222-4222-8222-222222222222";
export const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
export function testConfig(extra = {}) {
  const env = {
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    SUPABASE_ANON_KEY: "publishable-key",
    LLM_BASE_URL: "https://llm.example/v1",
    LLM_API_KEY: "llm-key",
    LLM_MODEL_MAIN: "main-model",
    LLM_MODEL_FAST: "fast-model",
    ALLOWED_ORIGINS: "http://localhost:3000",
    NLM_EMAIL: "ops@example.com",
    ...extra,
  };
  return loadConfig((name) => env[name]);
}

// ---------------------------------------------------------------------------
// An in-memory database that behaves like the real Repo
// ---------------------------------------------------------------------------
export function createMemoryRepo({ consents = "all", profile = {}, health = null, labs = [], diary = [], past = [], food = { meals: [], water: [] }, failInsert = false } = {}) {
  const state = {
    profiles: new Map([[USER_ID, { display_name: null, language: "en", save_chats: true, use_profile_in_answers: true, ...profile }]]),
    health: new Map(health ? [[USER_ID, health]] : []),
    labs,
    diary,
    consents: consents === "all" ? Object.entries(REQUIRED_CONSENTS).map(([doc_type, version]) => ({ user_id: USER_ID, doc_type, version })) : consents,
    conversations: new Map(),
    messages: [],
    used: new Map(),
    tokens: { in: 0, out: 0 },
    ruleEvents: [],
    cache: new Map(),
    cacheWrites: [],
    deleted: [],
    quotaCalls: 0,
    pingFails: false,
    titles: [],
  };
  const repo = {
    state,
    async getProfile(userId) {
      return state.profiles.get(userId) ?? null;
    },
    async getHealthProfile(userId) {
      return state.health.get(userId) ?? null;
    },
    async getLabResults(userId) {
      return userId === USER_ID ? state.labs : [];
    },
    async getHealthLog(userId) {
      return userId === USER_ID ? state.diary : [];
    },
    async getFoodLog(userId) {
      return userId === USER_ID ? food : { meals: [], water: [] };
    },
    async getPastConsultations(userId, _sinceIso, excludeId) {
      state.pastAsked = (state.pastAsked ?? 0) + 1;
      return userId === USER_ID ? past.filter((item) => item.id !== excludeId) : [];
    },
    async getConsents(userId) {
      return state.consents.filter((row) => row.user_id === userId).map(({ doc_type, version }) => ({ doc_type, version }));
    },
    async claimConversation(userId, id, language) {
      const existing = state.conversations.get(id);
      if (existing && existing.user_id !== userId) return null;
      if (!existing) state.conversations.set(id, { id, user_id: userId, title: null, language, max_care_level: null, created_at: new Date().toISOString() });
      return { id, title: state.conversations.get(id).title };
    },
    async findUserMessage(userId, conversationId, clientMessageId) {
      const row = state.messages.find((m) => m.user_id === userId && m.conversation_id === conversationId && m.client_message_id === clientMessageId && m.role === "user");
      return row ? { id: row.id, content: row.content ?? "", created_at: row.created_at } : null;
    },
    async findAnswer(userId, userMessageId) {
      const row = state.messages.find((m) => m.user_id === userId && m.reply_to === userMessageId && m.role === "assistant");
      return row
        ? { id: row.id, answer: row.answer ?? null, sources: row.sources ?? null, care_level: row.care_level ?? null, rule_ids: row.rule_ids ?? [], raised_by_rules: row.raised_by_rules === true }
        : null;
    },
    async loadHistory(userId, conversationId, limit) {
      return state.messages
        .filter((m) => m.user_id === userId && m.conversation_id === conversationId)
        .slice(-limit)
        .map((m) => ({ id: m.id, role: m.role, text: m.content ?? "" }));
    },
    async insertMessage(message) {
      if (failInsert) throw new Error("db down");
      if (message.client_message_id && state.messages.some((m) => m.conversation_id === message.conversation_id && m.client_message_id === message.client_message_id)) return "duplicate";
      if (message.reply_to && state.messages.some((m) => m.reply_to === message.reply_to)) return "duplicate";
      state.messages.push({ created_at: new Date().toISOString(), ...message });
      return "inserted";
    },
    async setTitleIfEmpty(userId, conversationId, title, topic) {
      const conversation = state.conversations.get(conversationId);
      if (conversation && conversation.user_id === userId && conversation.title == null) {
        conversation.title = title;
        conversation.topic = topic;
        state.titles.push(title);
      }
    },
    async consumeQuota(userId, limit) {
      state.quotaCalls += 1;
      const used = (state.used.get(userId) ?? 0) + 1;
      state.used.set(userId, used);
      return { allowed: used <= limit, used, remaining: Math.max(limit - used, 0) };
    },
    async releaseQuota(userId) {
      state.released = (state.released ?? 0) + 1;
      state.used.set(userId, Math.max((state.used.get(userId) ?? 0) - 1, 0));
    },
    async deleteEmptyConversation(userId, conversationId) {
      const conversation = state.conversations.get(conversationId);
      if (conversation && conversation.user_id === userId && !state.messages.some((m) => m.conversation_id === conversationId)) {
        state.conversations.delete(conversationId);
      }
    },
    async addUsageTokens(userId, tokensIn, tokensOut) {
      state.tokens.in += tokensIn;
      state.tokens.out += tokensOut;
    },
    async usageTotalsToday() {
      return { messages: 0, tokens_in: state.tokens.in, tokens_out: state.tokens.out };
    },
    async logRuleEvent(event) {
      state.ruleEvents.push(event);
    },
    async cacheGet(key) {
      return state.cache.get(key);
    },
    async cacheSet(key, source, payload, ttl) {
      state.cache.set(key, payload);
      state.cacheWrites.push({ key, source, ttl });
    },
    async loadForSummary(userId, ids) {
      const conversations = [...state.conversations.values()].filter((c) => c.user_id === userId && ids.includes(c.id));
      const messages = state.messages.filter((m) => m.user_id === userId && ids.includes(m.conversation_id));
      return { conversations, messages };
    },
    async deleteAuthUser(userId) {
      state.deleted.push(userId);
    },
    async ping() {
      if (state.pingFails) throw new Error("down");
    },
  };
  return repo;
}

// ---------------------------------------------------------------------------
// A scripted AI
// ---------------------------------------------------------------------------
const zero = { tokens_in: 120, tokens_out: 80 };

/**
 * `reply` is what the model "writes" for the answer (an object, a string for raw output, or a function of the request).
 * `extractReply` is what the fast model returns (an object, or a function of the prompt, or an Error).
 */
export function scriptedLlm({ reply, extractReply, streamError, completeReply, chunk = 17 } = {}) {
  const calls = { stream: [], complete: [] };
  const llm = {
    calls,
    async complete(request) {
      calls.complete.push(request);
      const isExtract = request.model === "fast-model";
      let out = isExtract ? extractReply : (completeReply ?? reply);
      if (typeof out === "function") out = out(request);
      if (out instanceof Error) throw out;
      if (out === undefined) throw new Error("no scripted reply");
      return { text: typeof out === "string" ? out : JSON.stringify(out), usage: zero, model: request.model, finishReason: "stop" };
    },
    async stream(request) {
      calls.stream.push(request);
      if (streamError) throw streamError;
      const out = typeof reply === "function" ? reply(request) : reply;
      const text = typeof out === "string" ? out : JSON.stringify(out);
      for (let i = 0; i < text.length; i += chunk) request.onDelta(text.slice(i, i + chunk));
      return { text, usage: zero, model: request.model, finishReason: "stop" };
    },
  };
  return llm;
}

// ---------------------------------------------------------------------------
// A fake internet: MedlinePlus and openFDA answer from saved real replies
// ---------------------------------------------------------------------------
export function fakeFetch({ medlineplus = {}, openfda = {}, failHosts = [], delayMs = 0, log = [] } = {}) {
  const impl = async (input, init = {}) => {
    const url = new URL(String(input));
    log.push(url.toString());
    if (failHosts.includes(url.host)) return new Response("boom", { status: 500 });
    if (delayMs) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, delayMs);
        init.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        });
      });
    }
    if (url.host === "wsearch.nlm.nih.gov") {
      // A key like 'title:"insomnia"' answers only the title search; a plain key answers both kinds.
      const raw = (url.searchParams.get("term") ?? "").toLowerCase();
      const term = raw.replace(/^title:/, "").replace(/"/g, "");
      const body = medlineplus[raw] ?? medlineplus[term] ?? medlineplus["*"];
      return body ? new Response(body, { status: 200 }) : new Response('<nlmSearchResult><count>0</count></nlmSearchResult>', { status: 200 });
    }
    if (url.host === "api.fda.gov") {
      const search = url.searchParams.get("search") ?? "";
      const name = /generic_name(?:\.exact)?:"([^"]+)"/.exec(search)?.[1]?.toLowerCase() ?? "";
      const body = openfda[name];
      return body ? new Response(body, { status: 200 }) : new Response(fixture("openfda-none.json"), { status: 404 });
    }
    return new Response("not found", { status: 404 });
  };
  impl.log = log;
  return impl;
}

export const standardInternet = (extra = {}) =>
  fakeFetch({
    medlineplus: { headache: fixture("medlineplus-headache.xml"), "sore throat": fixture("medlineplus-sore-throat.xml") },
    openfda: { acetaminophen: fixture("openfda-acetaminophen.json") },
    ...extra,
  });

// ---------------------------------------------------------------------------
// Dependencies for the chat handler
// ---------------------------------------------------------------------------
export function makeDeps({ repo, llm, fetch, config, user = { id: USER_ID, isAnonymous: false }, logs = [], rate } = {}) {
  const cfg = config ?? testConfig();
  const background = [];
  let counter = 100;
  return {
    config: cfg,
    repo: repo ?? createMemoryRepo(),
    verify: async (token) => {
      if (token.startsWith("bad")) throw new AppError("unauthenticated", "Please sign in again.");
      return user;
    },
    llm: llm === undefined ? scriptedLlm({ reply: goodAnswer() }) : llm,
    fetch: fetch ?? standardInternet(),
    log: createLogger("test", (line) => logs.push(line)),
    rate: rate ?? createRateLimiter(1000),
    now: () => Date.now(),
    newId: () => uuid(++counter),
    waitUntil: (promise) => background.push(promise),
    background,
    logs,
  };
}

export function chatRequest(body, { token = "good", origin = "http://localhost:3000", method = "POST" } = {}) {
  return new Request("https://project.supabase.co/functions/v1/chat", {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}.x.y`, origin },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
}

export const turnBody = (message, extra = {}) => ({
  client_message_id: uuid(1),
  conversation_id: uuid(50),
  message,
  client: { ui_lang: "en" },
  ...extra,
});

// ---------------------------------------------------------------------------
// Reading the stream
// ---------------------------------------------------------------------------
export async function readSse(response) {
  const text = await response.text();
  const events = [];
  for (const block of text.split("\n\n")) {
    const event = /^event: (.+)$/m.exec(block)?.[1];
    const data = /^data: (.+)$/m.exec(block)?.[1];
    if (event && data) events.push({ event, data: JSON.parse(data) });
  }
  return events;
}

export const fieldsOf = (events) => {
  const out = {};
  for (const e of events) if (e.event === "field") out[e.data.name] = e.data.value;
  return out;
};
export const eventsNamed = (events, name) => events.filter((e) => e.event === name).map((e) => e.data);

/** A well-behaved model answer for a headache question that cites S1. */
export function goodAnswer(overrides = {}) {
  return {
    care_level: "selfcare",
    care_reason: "Most headaches are mild and ease with rest.",
    headline: "Most headaches like this are mild and settle with rest.",
    summary: "I can't examine you, so I can't be sure. Many headaches come from tight muscles and stress. Rest and water often help.",
    likely_causes: [{ text: "Headaches are commonly caused by tight muscles from stress", source_ids: ["S1"] }],
    try_tonight: [{ text: "Rest in a quiet dark room and drink water", source_ids: [] }],
    see_doctor_if: [{ text: "The headache lasts more than 3 days", source_ids: [] }],
    emergency_if: [{ text: "You get a sudden severe headache or a stiff neck with fever", source_ids: ["S1"] }],
    medicines: [],
    questions_for_you: ["How long has it been going on?"],
    unknowns: "I don't know your medical history.",
    questions_for_doctor: ["Could this be a migraine?"],
    profile_updates: [],
    language: "en",
    ...overrides,
  };
}
