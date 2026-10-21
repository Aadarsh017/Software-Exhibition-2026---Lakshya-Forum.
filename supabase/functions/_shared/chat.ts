// POST /functions/v1/chat: one question, one streamed answer (PLAN.md 5.4, 5.5).
//
//   before the stream starts (a normal JSON error is returned):
//     sign-in, request shape, burst limit, consent, conversation, quota
//   inside the stream (events):
//     meta, status, red_flag, sources, field…, done      or      error
//
// Everything outside (the database, the AI, the web) is passed in, so tests run this whole flow
// with fakes. Safety order: the red-flag rules run first and can open the emergency view before any
// network call; the care level only goes up; the user's words are saved before the AI is asked.
import {
  assemble,
  chatTitle,
  cleanField,
  crisisAnswer,
  digest,
  emergencyAnswer,
  FIELD_ORDER,
  newCleanContext,
  readingGrade,
  sourcesOnlyAnswer,
  type CleanContext,
} from "./answer.ts";
import { findDrugMentions, resolveDrug } from "./aliases.ts";
import { bearerToken, type VerifyToken } from "./auth.ts";
import { computeFloor, isEmergency, wasRaised, type Floor } from "./care.ts";
import type { Config } from "./config.ts";
import { AppError, errorReason, toAppError } from "./errors.ts";
import { extract, focusWords, keywordExtraction, type Extraction } from "./extract.ts";
import { ground, type Grounding } from "./ground/index.ts";
import { corsHeaders, errorResponse, isUuid, preflight, readJsonObject } from "./http.ts";
import { createFieldStream } from "./json-stream.ts";
import { parseJsonObject, type Llm, type LlmResult } from "./llm.ts";
import type { Logger } from "./log.ts";
import { otcOptions, type OtcOptions } from "./otc.ts";
import { findTopics } from "./terms.ts";
import { answerSystemPrompt, bloodLines, buildAnswerMessage, buildCrisisMessage, crisisSystemPrompt, PROMPT_VERSION } from "./prompt.ts";
import type { RateLimiter } from "./rate.ts";
import { createSse, sseResponse, type SseWriter } from "./sse.ts";
import type { Answer, AnswerField, AuthUser, CareLevel, DiaryEntry, Fetch, FoodEntry, HealthProfile, HistoryItem, LabResult, PastConsultation, Profile, Repo, Source, StoredAnswer, Usage, WaterEntry } from "./types.ts";
import { missingConsents } from "./vendor/consent.js";
import { createRedactionMap, redact, restore, type RedactionMap } from "./vendor/pii.js";
import { checkRedFlags, RULES_VERSION } from "./vendor/redflags.js";

export type ChatDeps = {
  config: Config;
  repo: Repo;
  verify: VerifyToken;
  /** null when no AI is configured. */
  llm: Llm | null;
  fetch: Fetch;
  log: Logger;
  rate: RateLimiter;
  now: () => number;
  newId: () => string;
  /** Keeps the instance alive after the response ends (EdgeRuntime.waitUntil). */
  waitUntil?: (promise: Promise<unknown>) => void;
};

type ChatRequest = {
  clientMessageId: string;
  conversationId: string | null;
  message: string;
  history: HistoryItem[];
  uiLang: "en" | "hi";
  save: boolean | undefined;
  useProfile: boolean | undefined;
};

export function parseChatRequest(body: Record<string, unknown>, limits: Config["limits"]): ChatRequest {
  if (!isUuid(body.client_message_id)) throw new AppError("bad_request", "The request is missing a message id.");
  if (body.conversation_id != null && !isUuid(body.conversation_id)) throw new AppError("bad_request", "The conversation id is not valid.");
  if (typeof body.message !== "string") throw new AppError("bad_request", "Please type a message.");
  // eslint-disable-next-line no-control-regex
  const message = body.message.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  if (!message) throw new AppError("bad_request", "Please type a message.");
  if (message.length > limits.messageChars) {
    throw new AppError("bad_request", `That message is too long. Please keep it under ${limits.messageChars} characters.`);
  }

  // The newest messages are kept when the history is too long, never the oldest (bug review 2026-10-20).
  const history: HistoryItem[] = [];
  let used = 0;
  if (Array.isArray(body.history)) {
    for (const item of body.history.slice(-limits.historyItems).reverse()) {
      if (!item || typeof item !== "object") continue;
      const { role, text } = item as { role?: unknown; text?: unknown };
      if ((role !== "user" && role !== "assistant") || typeof text !== "string") continue;
      const clipped = text.slice(0, 2000);
      used += clipped.length;
      if (used > limits.historyChars) break;
      history.unshift({ role, text: clipped });
    }
  }

  const client = body.client && typeof body.client === "object" ? (body.client as Record<string, unknown>) : {};
  const options = body.options && typeof body.options === "object" ? (body.options as Record<string, unknown>) : {};
  return {
    clientMessageId: body.client_message_id,
    conversationId: (body.conversation_id as string | null | undefined) ?? null,
    message,
    history,
    uiLang: client.ui_lang === "hi" ? "hi" : "en",
    save: typeof options.save === "boolean" ? options.save : undefined,
    useProfile: typeof options.use_profile === "boolean" ? options.use_profile : undefined,
  };
}

type Plan = {
  user: AuthUser;
  req: ChatRequest;
  profile: Profile | null;
  save: boolean;
  useProfile: boolean;
  conversationId: string | null;
  userMessageId: string;
  assistantId: string;
  insertUserMessage: boolean;
  replay: StoredAnswer | null;
  staticReason: "consent" | "quota" | "db" | null;
  /** This request counted a question (so a parallel duplicate can give it back). */
  quotaCounted?: boolean;
  history: (HistoryItem & { id?: string })[];
  started: number;
};

const nextMidnightIst = (now: number): string => {
  const ist = new Date(now + 5.5 * 3600_000);
  const next = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + 1) - 5.5 * 3600_000;
  return new Date(next).toISOString();
};

/** Whether today's AI tokens (everyone's, DAILY_TOKEN_CAP) are used up. Checked at most once a minute. */
export function createTokenCapCheck(deps: Pick<ChatDeps, "config" | "repo" | "now">): () => Promise<boolean> {
  const { config, repo } = deps;
  let capCache: { at: number; reached: boolean } | null = null;
  return async function tokenCapReached(): Promise<boolean> {
    if (!config.dailyTokenCap) return false;
    if (capCache && deps.now() - capCache.at < 60_000) return capCache.reached;
    try {
      const totals = await repo.usageTotalsToday(config.quota.timezone);
      capCache = { at: deps.now(), reached: totals.tokens_in + totals.tokens_out >= config.dailyTokenCap };
    } catch {
      capCache = { at: deps.now(), reached: false }; // if we cannot tell, do not switch the AI off
    }
    return capCache.reached;
  };
}

export function createChatHandler(deps: ChatDeps): (request: Request) => Promise<Response> {
  const { config, repo, log } = deps;
  const tokenCapReached = createTokenCapCheck(deps);

  /** A plan that touches no database: the fixed emergency or crisis answer. */
  function fixedPlan(user: AuthUser, req: ChatRequest, profile: Profile | null, reason: "db", started: number): Plan {
    return {
      user, req, profile, save: false, useProfile: false, conversationId: null, userMessageId: deps.newId(), assistantId: deps.newId(),
      insertUserMessage: false, replay: null, staticReason: reason, history: req.history, started,
    };
  }

  // -------------------------------------------------------------------------
  // Before the stream: everything that may still be answered with a normal error.
  // -------------------------------------------------------------------------
  async function prepare(user: AuthUser, req: ChatRequest): Promise<Plan> {
    const started = deps.now();

    // The rules need no third party and no database, so an emergency can be answered even before
    // consent, over quota, or while the database is down.
    const rulesFloor = computeFloor(req.message, [], []);
    let urgent = isEmergency(rulesFloor.level) || rulesFloor.crisis;

    // One round of reads, all at once. The client makes the conversation id for a new chat, so even the
    // question lookup and the history can start now; both only ever return this person's own rows.
    const guess = req.conversationId;
    let profile: Profile | null = null;
    let consents: { doc_type: string; version: string }[] = [];
    let existing: { id: string; content: string; created_at: string } | null = null;
    let stored: (HistoryItem & { id: string })[] = [];
    try {
      [profile, consents, existing, stored] = await Promise.all([
        repo.getProfile(user.id),
        repo.getConsents(user.id),
        guess ? repo.findUserMessage(user.id, guess, req.clientMessageId) : Promise.resolve(null),
        guess ? repo.loadHistory(user.id, guess, config.limits.historyItems) : Promise.resolve([]),
      ]);
    } catch (error) {
      if (!urgent) throw error;
      log.warn("prepare_db_failed_urgent", { reason: errorReason(error) });
      return fixedPlan(user, req, null, "db", started);
    }
    // An emergency may only show across messages ("my baby has a fever", then "she is 6 weeks old"): judge it with the
    // earlier messages too, before consent or the daily limit can stop it (bug review 2026-10-20).
    if (!urgent) {
      const prior: HistoryItem[] = stored.length ? stored.filter((item) => item.id !== existing?.id) : req.history;
      const earlier = prior.filter((item) => item.role === "user").map((item) => item.text);
      const withContext = computeFloor(req.message, earlier.slice(-2), []);
      urgent = isEmergency(withContext.level) || withContext.crisis;
    }

    let staticReason: Plan["staticReason"] = null;
    const missing = missingConsents(consents, config.consents);
    if (missing.length) {
      if (!urgent) throw new AppError("consent_required", "Please accept the terms and AI notice first.", { missing });
      staticReason = "consent";
    }

    const save = staticReason === "consent" ? false : (profile?.save_chats ?? true) && req.save !== false;
    const useProfile = !user.isAnonymous && (profile?.use_profile_in_answers ?? true) && req.useProfile !== false;
    const assistantId = deps.newId();
    const conversationId: string | null = save ? (guess ?? deps.newId()) : null;
    const retried = save && existing !== null; // this exact question was already saved (and counted) once
    const userMessageId = retried && existing ? existing.id : deps.newId();
    const history: Plan["history"] = save ? stored.filter((item) => item.id !== existing?.id) : req.history;

    // A retry (security review 2026-10-20): it must carry the very words that were saved, never a new question under an
    // old id; and while the first try may still be writing its answer, a second one waits instead of running the AI again.
    if (retried && existing) {
      if (normalizeQuestion(existing.content) !== normalizeQuestion(req.message)) {
        throw new AppError("bad_request", "This message was already sent with different words. Please send it as a new message.");
      }
    }

    // Then, together: make sure the conversation is theirs, look for a finished answer to a retried question,
    // and count the question. A retry of a counted question costs nothing, and so does a question asked while the AI is
    // off or today's AI budget is spent: the reply is the offline one (bug review 2026-10-20).
    const limit = user.isAnonymous ? config.quota.guest : config.quota.member;
    const aiOn = Boolean(deps.llm) && config.aiEnabled && !(await tokenCapReached());
    let claimed: { id: string; title: string | null } | null;
    let replay: StoredAnswer | null;
    let quota: { allowed: boolean; used: number } | null;
    try {
      [claimed, replay, quota] = await Promise.all([
        save && conversationId ? repo.claimConversation(user.id, conversationId, req.uiLang) : Promise.resolve({ id: "", title: null }),
        retried && existing ? repo.findAnswer(user.id, existing.id) : Promise.resolve(null),
        staticReason === null && !retried && aiOn ? repo.consumeQuota(user.id, limit, config.quota.timezone) : Promise.resolve(null),
      ]);
    } catch (error) {
      // The database failing here must not cost someone the emergency answer either (bug review 2026-10-20).
      if (!urgent) throw error;
      log.warn("prepare_db_failed_urgent", { reason: errorReason(error), round: 2 });
      return fixedPlan(user, req, profile, "db", started);
    }
    if (!claimed) throw new AppError("not_found", "I couldn't find that conversation.");
    if (retried && existing && !replay?.answer && deps.now() - Date.parse(existing.created_at) < RETRY_WAIT_MS && !urgent) {
      throw new AppError("rate_limited", "I'm still answering this one. Please try again in a moment.", { retry_after_s: 15 });
    }
    if (quota && !quota.allowed) {
      if (!urgent) {
        // A first question refused for the limit leaves no empty "Untitled chat" behind (bug review 2026-10-20).
        if (save && conversationId && stored.length === 0 && !retried) {
          await repo.deleteEmptyConversation(user.id, conversationId).catch((error) => log.warn("delete_empty_conversation_failed", { reason: errorReason(error) }));
        }
        throw new AppError("quota_exceeded", "You've used today's questions. They come back tomorrow morning.", {
          limit,
          used: quota.used,
          resets_at: nextMidnightIst(deps.now()),
        });
      }
      staticReason = "quota"; // emergencies are never blocked, and cost nothing
    }
    const insertUserMessage = save && !retried;
    return { user, req, profile, save, useProfile, conversationId, userMessageId, assistantId, insertUserMessage, replay, staticReason, history, started, quotaCounted: quota !== null };
  }

  // -------------------------------------------------------------------------
  // The handler
  // -------------------------------------------------------------------------
  return async function handle(request: Request): Promise<Response> {
    const cors = corsHeaders(request.headers.get("origin"), config.allowedOrigins);
    if (request.method === "OPTIONS") return preflight(cors);
    try {
      if (request.method !== "POST") throw new AppError("bad_request", "Use POST.");
      const user = await deps.verify(bearerToken(request));
      const req = parseChatRequest(await readJsonObject(request, 64 * 1024), config.limits);
      const allowed = deps.rate(user.id);
      if (!allowed.ok) {
        throw new AppError("rate_limited", "You're sending messages quickly. Please wait a moment.", { retry_after_s: allowed.retryAfterSeconds });
      }
      const plan = await prepare(user, req);
      const { stream, writer } = createSse();
      const turn = runTurn(plan, writer)
        .catch((error) => {
          const failure = toAppError(error);
          log.error("turn_failed", { code: failure.code, reason: errorReason(error), user: user.id });
          writer.send("error", { code: failure.code, message: failure.message, retryable: failure.retryable });
        })
        .finally(() => writer.close());
      deps.waitUntil?.(turn);
      return sseResponse(stream, cors);
    } catch (error) {
      const failure = toAppError(error);
      if (failure.code === "internal") log.error("request_failed", { reason: errorReason(error) });
      else log.info("request_refused", { code: failure.code });
      return errorResponse(failure, cors);
    }
  };

  // -------------------------------------------------------------------------
  // The turn
  // -------------------------------------------------------------------------
  async function runTurn(plan: Plan, writer: SseWriter): Promise<void> {
    const { user, req, profile } = plan;
    const send = (event: string, data: unknown) => writer.send(event, data);
    const ms = () => deps.now() - plan.started;
    const bg = (promise: Promise<unknown>, what: string) => {
      const guarded = promise.catch((error) => log.warn("background_failed", { step: what, reason: errorReason(error) }));
      deps.waitUntil?.(guarded);
      return guarded;
    };

    send("meta", { conversation_id: plan.conversationId, message_id: plan.assistantId, user_message_id: plan.userMessageId });

    // A repeat of a finished question: send the saved answer again, change nothing.
    if (plan.replay?.answer) {
      replayStored(plan.replay, writer, plan.assistantId);
      log.info("turn", { user: user.id, guest: user.isAnonymous, conversation: plan.conversationId ?? undefined, replayed: true, ms: ms() });
      return;
    }

    // ---- Read and safety (local, instant) ---------------------------------
    send("status", { step: "read", state: "active" });
    const map = createRedactionMap();
    // The saved display name is always hidden, and so is each part of it ("Asha Kulkarni" -> "Asha", "Kulkarni").
    const nameParts = (profile?.display_name ?? "").split(/\s+/).filter((part) => part.length >= 3);
    const neverSend = profile?.display_name ? [profile.display_name, ...nameParts] : [];
    const hide = (text: string) => redact(text, { neverSend, map }).text;
    // Nox greets the person by name (prompt rule 13), but the AI only ever sees a placeholder such as [NAME_1]: the
    // real name goes back in on the way out (restoreDeep). A name the redactor doesn't replace is simply not used.
    const firstName = (profile?.display_name ?? "").trim().split(/\s+/)[0] ?? "";
    const nameToken = firstName ? hide(firstName) : "";
    const addressAs = /^\[NAME_\d+\]$/.test(nameToken) ? nameToken : null;
    const message = hide(req.message);
    // The person's own words first: a name they gave ("my name is …", here or earlier) is then hidden everywhere,
    // including Nox's earlier replies, which were saved with the real name put back (bug review 2026-10-20).
    const userTexts = plan.history.map((item) => (item.role === "user" ? hide(item.text) : null));
    for (const [placeholder, value] of map.byPlaceholder) {
      if (placeholder.startsWith("[NAME_") && !neverSend.includes(value)) neverSend.push(value);
    }
    const history = plan.history.map((item, index) => ({ ...item, text: userTexts[index] ?? hide(item.text) }));
    const earlierUser = plan.history.filter((item) => item.role === "user").map((item) => item.text);
    const earlierUserHidden = history.filter((item) => item.role === "user").map((item) => item.text);

    send("status", { step: "safety", state: "active" });
    let floor: Floor = computeFloor(req.message, earlierUser.slice(-2), []);
    if (floor.level && isEmergency(floor.level)) {
      send("red_flag", { level: floor.level, rule_ids: floor.ruleIds, crisis: floor.crisis, signs: floor.signs, source: "rules" });
      if (floor.ruleIds.length) {
        void bg(repo.logRuleEvent({ user_id: user.id, rule_ids: floor.ruleIds, level: floor.level as "emergency" | "ambulance", source: "rules" }), "rule_event");
      }
    }

    // The person's words are saved before the AI is asked, so they are never lost.
    let saved = plan.save;
    if (plan.save && plan.insertUserMessage && plan.conversationId) {
      try {
        const outcome = await repo.insertMessage({
          id: plan.userMessageId,
          conversation_id: plan.conversationId,
          user_id: user.id,
          role: "user",
          content: req.message,
          client_message_id: req.clientMessageId,
          rule_ids: floor.ruleIds,
          content_version: RULES_VERSION,
        });
        if (outcome === "duplicate") {
          // A parallel request with the same id saved this question a moment ago (Stop, then Ask again, while the first
          // was still starting). That one answers it; this one gives back its question and stops, so the question is
          // neither counted nor answered twice (bug review 2026-10-20).
          if (plan.quotaCounted) void bg(repo.releaseQuota(user.id, config.quota.timezone), "release_quota");
          send("error", { code: "rate_limited", message: "I'm still answering this one. Please try again in a moment.", retryable: true, retry_after_s: 15 });
          return;
        }
      } catch (error) {
        saved = false;
        log.warn("save_user_message_failed", { reason: errorReason(error), user: user.id });
      }
    }

    // The saved profile and blood results load while the question is being understood (only when the person allows it).
    const healthLoad: Promise<HealthProfile | null> = plan.useProfile ? repo.getHealthProfile(user.id).catch((): HealthProfile | null => null) : Promise.resolve(null);
    const labsLoad: Promise<LabResult[]> =
      plan.useProfile && typeof repo.getLabResults === "function" ? repo.getLabResults(user.id).catch((): LabResult[] => []) : Promise.resolve([]);
    const twoWeeksAgo = new Date(deps.now() - 14 * 86_400_000).toISOString();
    const diaryLoad: Promise<DiaryEntry[]> =
      plan.useProfile && typeof repo.getHealthLog === "function" ? repo.getHealthLog(user.id, twoWeeksAgo).catch((): DiaryEntry[] => []) : Promise.resolve([]);
    // Thali (rule 21): what the person ate in the last three days.
    // Meal days are the person's own local dates: count back three days in India time, not UTC.
    const threeDaysAgo = new Date(deps.now() + 5.5 * 3_600_000 - 3 * 86_400_000).toISOString().slice(0, 10);
    const foodLoad: Promise<{ meals: FoodEntry[]; water: WaterEntry[] }> =
      plan.useProfile && typeof repo.getFoodLog === "function"
        ? repo.getFoodLog(user.id, threeDaysAgo).catch(() => ({ meals: [] as FoodEntry[], water: [] as WaterEntry[] }))
        : Promise.resolve({ meals: [], water: [] });
    // Earlier consultations (rule 17): the person's other problem chats from the last 60 days, like a doctor's memory.
    const sixtyDaysAgo = new Date(deps.now() - 60 * 86_400_000).toISOString();
    const pastLoad: Promise<PastConsultation[]> =
      plan.useProfile && typeof repo.getPastConsultations === "function"
        ? repo.getPastConsultations(user.id, sixtyDaysAgo, plan.conversationId).catch((): PastConsultation[] => [])
        : Promise.resolve([]);

    const aiAvailable = Boolean(deps.llm) && config.aiEnabled && plan.staticReason === null && !(await tokenCapReached());
    let urgent = isEmergency(floor.level) || floor.crisis;
    let mode: "normal" | "crisis" = floor.crisis ? "crisis" : "normal";

    let extraction: Extraction;
    let grounding: Grounding | null = null;
    let usage: Usage = { tokens_in: 0, tokens_out: 0 };
    let model: string | null = null;
    let degraded: string | null = plan.staticReason ?? (aiAvailable ? null : "ai_off");
    const emitted = new Map<string, string>();
    const emitField = (name: string, value: unknown) => {
      const restored = restoreDeep(value, map);
      const key = JSON.stringify(restored);
      if (emitted.get(name) === key) return;
      emitted.set(name, key);
      send("field", { name, value: restored });
    };

    // ---- Understand the question (skipped when it is a crisis or an emergency without AI) ----
    if (mode === "crisis" || (!aiAvailable && urgent)) {
      extraction = keywordExtraction(message, earlierUserHidden.join("\n"));
    } else {
      extraction = await extract(message, earlierUserHidden.slice(-2).join("\n"), {
        llm: aiAvailable ? deps.llm : null,
        model: config.llm.modelFast,
        timeoutMs: config.extractTimeoutMs,
      });
      if (extraction.usage) usage = addUsage(usage, extraction.usage);
      if (extraction.flags.length) {
        const before = { level: floor.level, crisis: floor.crisis };
        floor = computeFloor(req.message, earlierUser.slice(-2), extraction.flags);
        // A crisis the model noticed switches to the calm crisis flow, and is sent even when the level was already the
        // highest (bug review 2026-10-20).
        urgent = isEmergency(floor.level) || floor.crisis;
        if (floor.crisis) mode = "crisis";
        if (floor.level && isEmergency(floor.level) && (floor.level !== before.level || floor.crisis !== before.crisis)) {
          send("red_flag", { level: floor.level, rule_ids: floor.ruleIds, crisis: floor.crisis, signs: floor.signs, source: "model" });
          void bg(repo.logRuleEvent({ user_id: user.id, rule_ids: floor.ruleIds.length ? floor.ruleIds : ["model-flag"], level: floor.level as "emergency" | "ambulance", source: "model" }), "rule_event");
        }
      }
    }
    send("status", { step: "read", state: "done" });
    send("status", { step: "safety", state: "done" });

    const replyLang = extraction.language === "hi" || (extraction.language === "hinglish" && req.uiLang === "hi") ? "hi" : "en";

    // A short reply (PLAN.md §12) to a message that raises nothing new: a greeting, thanks, or a question about the
    // person's saved details. The safety checks decide first: never when they found anything in this message or a key
    // question is pending, never for a medicine, never in or after the self-harm flow, and never without the AI.
    const brief =
      extraction.brief &&
      mode === "normal" &&
      aiAvailable &&
      floor.level === null &&
      !floor.crisis &&
      floor.followUps.length === 0 &&
      findDrugMentions(message).length === 0 &&
      !earlierUser.some((text) => checkRedFlags(text).crisis);

    // ---- Look things up (not for crisis, short replies, or emergencies we answer without the AI) ---
    const groundable = mode === "normal" && !brief && !(urgent && !aiAvailable);
    const health = await healthLoad;
    // Everyday medicines Nox may suggest (otc.ts), checked against the profile. Never in an emergency or a crisis.
    const otc: OtcOptions | undefined =
      groundable && !urgent && aiAvailable ? otcOptions({ text: `${extraction.topics.join(" ")} ${message}`, whoFor: extraction.whoFor, profile: health }) : undefined;
    const named = new Set(extraction.drugs.map((drug) => resolveDrug(drug).generic));
    const otcLookups = (otc?.offered ?? [])
      .filter((item) => item.lookup && !named.has(item.id))
      .map((item) => item.lookup as string)
      .slice(0, Math.max(0, 4 - extraction.drugs.length));
    const isOtcLookup = (asWritten: string) => otcLookups.includes(asWritten);
    if (groundable) {
      try {
        grounding = await ground(
          {
            topics: extraction.topics,
            drugs: [...extraction.drugs, ...otcLookups],
            focus: focusWords(message, extraction),
            forChild: extraction.whoFor === "baby" || extraction.whoFor === "child",
          },
          {
            fetch: deps.fetch,
            repo,
            now: deps.now,
            perSourceTimeoutMs: config.ground.perSourceTimeoutMs,
            overallTimeoutMs: config.ground.overallTimeoutMs,
            who: { tool: config.ground.nlmTool, email: config.ground.nlmEmail },
            openFdaKey: config.ground.openFdaKey,
            onStatus: (step, state) => send("status", { step, state }),
            onWarn: (event, fields) => log.warn(event, fields),
          },
        );
      } catch (error) {
        log.warn("ground_failed", { reason: errorReason(error) });
        send("status", { step: "medlineplus", state: "failed" });
        send("status", { step: "fda", state: "failed" });
      }
    }
    // Labels fetched for everyday medicines are shown only if the answer uses them (see "Keep it" below).
    const otcSourceIds = new Set<string>();
    for (const item of otc?.offered ?? []) {
      const label = item.lookup ? grounding?.drugSources.find((drug) => drug.asWritten === item.lookup) : undefined;
      if (label) {
        item.sourceId = label.id;
        otcSourceIds.add(label.id);
      }
    }
    const shownSources = (grounding?.sources ?? []).filter((source) => !otcSourceIds.has(source.id));
    if (groundable) {
      send("sources", shownSources);
    } else {
      send("status", { step: "medlineplus", state: "skipped" });
      send("status", { step: "fda", state: "skipped" });
      send("sources", []);
    }
    const sources: Source[] = grounding?.sources ?? [];
    // A follow-up (DESIGN.md 7.6): this message continues a problem already answered. Nox then talks about what is new
    // and doesn't repeat the warning signs, unless something in this message calls for them (answer.ts).
    const earlierTopics = new Set(earlierUser.flatMap((text) => findTopics(text, 5)).map((topic) => topic.toLowerCase()));
    const newProblem = extraction.topics.some((topic) => !earlierTopics.has(topic.toLowerCase()));
    const levels = ["selfcare", "doctor", "doctor24", "emergency", "ambulance"];
    const standing = plan.history.reduce<string | null>((best, item) => {
      const care = item.role === "assistant" && item.care && levels.includes(item.care) ? item.care : null;
      return care && (!best || levels.indexOf(care) > levels.indexOf(best)) ? care : best;
    }, null);
    const followUp = mode === "normal" && !brief && plan.history.some((item) => item.role === "assistant") ? { newProblem, standing: standing as CareLevel | null } : undefined;

    // The medicines the person named, without the ones looked up only as everyday options.
    const personDrugNames = (grounding?.drugNames ?? []).filter((drug) => !isOtcLookup(drug.asWritten));
    const personDrugSources = (grounding?.drugSources ?? []).filter((drug) => !isOtcLookup(drug.asWritten));
    const otcGenerics = new Set(otcLookups.map((name) => resolveDrug(name).generic || name));
    const unlabelled = (grounding?.unlabelled ?? []).filter((item) => !otcGenerics.has(item.name) || named.has(item.name));

    // ---- Write the answer --------------------------------------------------
    send("status", { step: "write", state: "active" });
    const ctx: CleanContext = newCleanContext({
      sources,
      floor,
      language: replyLang,
      mode,
      drugNames: personDrugNames,
      drugSources: personDrugSources,
      brief,
      otc,
      followUp,
      // Proposed profile additions (rule 20) only where the profile is in use, so Nox can see what it already has.
      known: plan.useProfile
        ? await healthLoad.then((health) => ({ medicines: health?.medicines ?? [], conditions: health?.conditions ?? [], allergies: health?.allergies ?? [] }))
        : null,
    });

    let answer: Answer;
    if (!aiAvailable) {
      answer = fixedAnswer(floor, shownSources, replyLang);
    } else {
      const llm = deps.llm as Llm;
      const system = mode === "crisis" ? crisisSystemPrompt() : answerSystemPrompt();
      const userText =
        mode === "crisis"
          ? buildCrisisMessage({ message, history, language: replyLang })
          : buildAnswerMessage({
              message,
              history,
              extraction,
              floor,
              sources,
              // Saved lists are the person's own words too: hidden like their messages (names, numbers). The checks
              // above (OTC options, profile proposals) use the real lists.
              profile: health
                ? {
                    ...health,
                    conditions: health.conditions.map(hide),
                    allergies: health.allergies.map(hide),
                    medicines: health.medicines.map(hide),
                    family_history: health.family_history ? health.family_history.map(hide) : health.family_history,
                  }
                : health,
              unlabelled,
              language: replyLang,
              brief,
              name: addressAs,
              labs: (await labsLoad).map((row) => ({ ...row, label: row.label ? hide(row.label) : row.label })),
              // The "not suitable" reasons quote the person's own profile items: hidden like everything else.
              otc: otc ? { ...otc, none: otc.none ? hide(otc.none) : otc.none, blocked: otc.blocked.map((item) => ({ ...item, reason: hide(item.reason) })) } : otc,
              followUp: Boolean(followUp && !followUp.newProblem),
              // The person's own words in the diary are hidden like their messages (names, numbers).
              diary: (await diaryLoad).map((entry) => ({ ...entry, symptom: entry.symptom ? hide(entry.symptom) : null, note: entry.note ? hide(entry.note) : null })),
              // A renamed chat can hold anything: titles are hidden like messages.
              past: (await pastLoad).map((item) => ({ ...item, title: item.title ? hide(item.title) : null })),
              // Food names and notes are the person's own words: hidden like their messages.
              food: await foodLoad.then((food) => ({ ...food, meals: food.meals.map((meal) => ({ ...meal, items: meal.items.map(hide), note: meal.note ? hide(meal.note) : null })) })),
              now: deps.now(),
            });
      const messages = [
        { role: "system" as const, content: system },
        { role: "user" as const, content: userText },
      ];
      const fieldStream = createFieldStream((name, value) => {
        const cleaned = cleanField(name, value, ctx);
        if (cleaned !== undefined) emitField(name, cleaned);
      });

      let result: LlmResult | null = null;
      let streamedChars = 0;
      let streamFailed = false;
      try {
        result = await llm.stream({
          model: config.llm.modelMain,
          messages,
          json: true,
          temperature: 0.2,
          maxTokens: config.llm.answerMaxTokens,
          timeoutMs: config.llm.timeoutMs,
          firstTokenTimeoutMs: config.llm.firstTokenTimeoutMs,
          onDelta: (text) => {
            streamedChars += text.length;
            fieldStream.push(text);
          },
        });
        model = result.model;
        usage = addUsage(usage, result.usage);
      } catch (error) {
        log.warn("llm_stream_failed", { reason: errorReason(error), user: user.id });
        degraded = "llm_error";
        streamFailed = true;
        // The provider's own count never arrived: estimate it (about 4 characters a token), so the daily cap still
        // sees what was spent (bug review 2026-10-20).
        usage = addUsage(usage, { tokens_in: Math.ceil((system.length + userText.length) / 4), tokens_out: Math.ceil(streamedChars / 4) });
      }

      let raw: Record<string, unknown> = fieldStream.end().fields;
      const usable = (fields: Record<string, unknown>) => typeof fields.headline === "string" && typeof fields.summary === "string";
      if (!usable(raw) && emitted.size === 0) {
        // Nothing usable arrived: one non-streamed repair attempt.
        try {
          const repaired = await llm.complete({
            model: config.llm.modelMain,
            messages,
            json: true,
            temperature: 0,
            maxTokens: config.llm.answerMaxTokens,
            timeoutMs: Math.min(config.llm.timeoutMs, 40_000),
            retries: 0,
          });
          usage = addUsage(usage, repaired.usage);
          model = repaired.model;
          raw = parseJsonObject(repaired.text) ?? {};
          if (usable(raw)) degraded = null;
        } catch (error) {
          log.warn("llm_repair_failed", { reason: errorReason(error), user: user.id });
        }
      }

      if (usable(raw)) {
        ctx.stats = { doseHits: 0, droppedCitations: 0, downgraded: 0, softened: 0 };
        const assembled = assemble(raw, ctx);
        answer = assembled.answer;
        // The AI wrote this answer, even if the stream broke near the end: not "AI offline" (bug review 2026-10-20).
        if (streamFailed && degraded === "llm_error") degraded = assembled.missing.length > 3 ? "incomplete" : null;
        if (assembled.missing.some((field) => field === "headline" || field === "summary")) degraded = degraded ?? "incomplete";
        if (result?.finishReason === "length" && assembled.missing.length > 3) degraded = degraded ?? "truncated";
      } else if (emitted.size > 0) {
        ctx.stats = { doseHits: 0, droppedCitations: 0, downgraded: 0, softened: 0 };
        answer = assemble(raw, ctx).answer; // part of the answer was already shown: complete it safely
        degraded = degraded ?? "incomplete";
      } else {
        answer = fixedAnswer(floor, shownSources, replyLang);
        degraded = degraded ?? "llm_error";
      }
    }

    for (const field of FIELD_ORDER) emitField(field, answer[field as AnswerField]);
    send("status", { step: "write", state: "done" });

    // ---- Keep it ----------------------------------------------------------
    const finalAnswer = restoreDeep(answer, map) as Answer;
    // An everyday medicine's label joins the sources only when the answer cites it.
    const cited = new Set(
      (["likely_causes", "try_tonight", "see_doctor_if", "emergency_if", "medicines"] as const).flatMap((field) =>
        ((finalAnswer[field] ?? []) as { source_ids?: string[] }[]).flatMap((item) => item.source_ids ?? []),
      ),
    );
    const keptSources = sources.filter((source) => !otcSourceIds.has(source.id) || cited.has(source.id));
    if (keptSources.length !== shownSources.length) send("sources", keptSources);
    const raised = mode === "normal" && wasRaised(floor, ctx.state.modelLevel);
    const latency = ms();
    if (plan.save && plan.conversationId) {
      try {
        const outcome = await repo.insertMessage({
          id: plan.assistantId,
          conversation_id: plan.conversationId,
          user_id: user.id,
          role: "assistant",
          content: digest(finalAnswer),
          reply_to: plan.userMessageId,
          answer: finalAnswer,
          sources: keptSources,
          rule_ids: floor.ruleIds,
          care_level: finalAnswer.care_level,
          raised_by_rules: raised,
          content_version: `${RULES_VERSION}/${PROMPT_VERSION}`,
          model,
          tokens_in: usage.tokens_in,
          tokens_out: usage.tokens_out,
          latency_ms: latency,
        });
        if (outcome === "inserted") {
          void bg(repo.setTitleIfEmpty(user.id, plan.conversationId, chatTitle(req.message, extraction.topics), extraction.topics[0] ?? null), "title");
        }
      } catch (error) {
        saved = false;
        log.warn("save_answer_failed", { reason: errorReason(error), user: user.id });
      }
    }
    if (usage.tokens_in || usage.tokens_out) {
      void bg(repo.addUsageTokens(user.id, usage.tokens_in, usage.tokens_out, config.quota.timezone), "usage");
    }

    // What Nox was given about the person, as counts only, so the answer can say so (DESIGN.md 8.6f).
    const [usedHealth, usedLabs, usedDiary, usedPast, usedFood] = await Promise.all([healthLoad, labsLoad, diaryLoad, pastLoad, foodLoad]);
    send("done", {
      // Nothing when there was no AI answer (emergency text, static or degraded replies).
      used: urgent || degraded !== null
        ? null
        : {
            // What the prompt actually held (bug review 2026-10-20), not every row loaded.
            profile: Boolean(usedHealth),
            labs: bloodLines(usedLabs, usedHealth?.sex_at_birth).length,
            diary: Math.min(usedDiary.length, 12),
            past: Math.min(usedPast.length, 6),
            food: brief ? 0 : Math.min(usedFood.meals.length, 16),
          },
      message_id: plan.assistantId,
      usage,
      latency_ms: latency,
      degraded: degraded !== null,
      degraded_reason: degraded,
      saved,
      care_level: finalAnswer.care_level,
      raised_by_rules: raised,
      replayed: false,
    });
    log.info("turn", {
      user: user.id,
      guest: user.isAnonymous,
      conversation: plan.conversationId ?? undefined,
      message: plan.assistantId,
      ms: latency,
      mode: brief ? "brief" : mode,
      degraded: degraded !== null,
      reason: degraded ?? undefined,
      saved,
      rule_ids: floor.ruleIds,
      level: finalAnswer.care_level,
      raised,
      tokens_in: usage.tokens_in,
      tokens_out: usage.tokens_out,
      model: model ?? undefined,
      dose_hits: ctx.stats.doseHits,
      dropped_citations: ctx.stats.droppedCitations,
      softened: ctx.stats.softened + ctx.stats.downgraded,
      grade: finalAnswer.language === "en" ? (readingGrade(finalAnswer.summary) ?? undefined) : undefined,
      language: replyLang,
      via: extraction.via,
      count: sources.length,
    });
  }

  function fixedAnswer(floor: Floor, sources: Source[], language: string): Answer {
    if (floor.crisis) return crisisAnswer(language);
    if (isEmergency(floor.level)) return emergencyAnswer(floor, language);
    return sourcesOnlyAnswer(floor, sources, language);
  }

  function replayStored(stored: StoredAnswer, writer: SseWriter, assistantId: string): void {
    const answer = stored.answer as Answer;
    if (stored.care_level && (stored.care_level === "emergency" || stored.care_level === "ambulance") && stored.rule_ids.length) {
      const crisis = stored.rule_ids.includes("self-harm") || stored.rule_ids.includes("model-crisis");
      writer.send("red_flag", { level: stored.care_level, rule_ids: stored.rule_ids, crisis, signs: [], source: "rules" });
    }
    writer.send("sources", stored.sources ?? []);
    for (const field of FIELD_ORDER) writer.send("field", { name: field, value: answer[field as AnswerField] });
    writer.send("done", {
      message_id: stored.id || assistantId,
      usage: { tokens_in: 0, tokens_out: 0 },
      latency_ms: 0,
      degraded: false,
      degraded_reason: null,
      saved: true,
      care_level: stored.care_level,
      raised_by_rules: stored.raised_by_rules,
      replayed: true,
    });
  }
}

function addUsage(a: Usage, b: Usage): Usage {
  return { tokens_in: a.tokens_in + b.tokens_in, tokens_out: a.tokens_out + b.tokens_out };
}

/** How long a saved question with no answer yet counts as "still being answered" (security review 2026-10-20). */
const RETRY_WAIT_MS = 90_000;

/** The same question, ignoring spacing and letter case, for comparing a retry with what was saved. */
function normalizeQuestion(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Puts the person's real details back where placeholders like [NAME_1] stand. */
function restoreDeep(value: unknown, map: RedactionMap): unknown {
  if (typeof value === "string") {
    const restored = restore(value, map);
    // A name saved in lower case ("raunak") still starts a sentence with a capital. Only where something was put back.
    return restored === value ? restored : restored.replace(/(^\s*|[.!?]\s+)(\p{Ll})/gu, (_match, before: string, letter: string) => before + letter.toUpperCase());
  }
  if (Array.isArray(value)) return value.map((item) => restoreDeep(item, map));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, restoreDeep(item, map)]));
  }
  return value;
}
