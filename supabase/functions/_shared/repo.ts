// The real data access, through PostgREST with the secret key. The secret key bypasses row-level
// security, so EVERY query below filters by the caller's user id. Tests check the exact requests.
import { RestError, type RestClient } from "./rest.ts";
import type { Answer, CareLevel, DiaryEntry, HealthProfile, HistoryItem, LabResult, NewMessage, Profile, Repo, Source, StoredAnswer, SummaryConversation, SummaryMessage } from "./types.ts";

const rows = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? (value as Record<string, unknown>[]) : []);
const first = (value: unknown): Record<string, unknown> | null => rows(value)[0] ?? null;
const inList = (ids: string[]) => `in.(${ids.join(",")})`;

export function createRestRepo(rest: RestClient, now: () => number = Date.now): Repo {
  return {
    async getProfile(userId) {
      const row = first(await rest.get("/rest/v1/profiles", { select: "display_name,language,save_chats,use_profile_in_answers", id: `eq.${userId}`, limit: "1" }));
      return row ? (row as unknown as Profile) : null;
    },

    async getHealthProfile(userId) {
      const row = first(
        await rest.get("/rest/v1/health_profile", {
          select: "age_range,sex_at_birth,pregnancy,conditions,allergies,medicines,height_cm,weight_kg,smoking,alcohol,activity,family_history",
          user_id: `eq.${userId}`,
          limit: "1",
        }),
      );
      return row ? (row as unknown as HealthProfile) : null;
    },

    async getHealthLog(userId, sinceIso) {
      const rows = await rest.get("/rest/v1/health_log", {
        select: "logged_at,symptom,severity,temperature_c,feeling,note,bp_systolic,bp_diastolic,pulse,glucose_mgdl,glucose_timing,weight_kg",
        user_id: `eq.${userId}`,
        logged_at: `gte.${sinceIso}`,
        order: "logged_at.desc",
        limit: "20",
      });
      return Array.isArray(rows) ? (rows as unknown as DiaryEntry[]) : [];
    },

    async getFoodLog(userId, sinceDay) {
      const [meals, water] = await Promise.all([
        rest.get("/rest/v1/food_log", { select: "day,meal,items,portion,outside,note", user_id: `eq.${userId}`, day: `gte.${sinceDay}`, order: "day.desc", limit: "16" }),
        rest.get("/rest/v1/water_log", { select: "day,glasses", user_id: `eq.${userId}`, day: `gte.${sinceDay}`, order: "day.desc", limit: "4" }),
      ]);
      return {
        meals: rows(meals).map((row) => ({
          day: String(row.day),
          meal: String(row.meal),
          items: Array.isArray(row.items) ? row.items.filter((item): item is string => typeof item === "string") : [],
          portion: typeof row.portion === "string" ? row.portion : null,
          outside: row.outside === true,
          note: typeof row.note === "string" ? row.note : null,
        })),
        water: rows(water).map((row) => ({ day: String(row.day), glasses: Number(row.glasses) || 0 })),
      };
    },

    async getPastConsultations(userId, sinceIso, excludeId) {
      const chats = rows(
        await rest.get("/rest/v1/conversations", {
          select: "id,title,max_care_level,updated_at",
          user_id: `eq.${userId}`,
          updated_at: `gte.${sinceIso}`,
          max_care_level: "not.is.null",
          order: "updated_at.desc",
          limit: "7",
        }),
      )
        .filter((chat) => chat.id !== excludeId)
        .slice(0, 6);
      if (!chats.length) return [];
      const checks = rows(
        await rest.get("/rest/v1/health_log", {
          select: "conversation_id,feeling,logged_at",
          user_id: `eq.${userId}`,
          conversation_id: `in.(${chats.map((chat) => String(chat.id)).join(",")})`,
          feeling: "not.is.null",
          order: "logged_at.desc",
          limit: "30",
        }),
      );
      return chats.map((chat) => {
        const last = checks.find((check) => check.conversation_id === chat.id);
        return {
          id: String(chat.id),
          title: typeof chat.title === "string" ? chat.title : null,
          max_care_level: typeof chat.max_care_level === "string" ? chat.max_care_level : null,
          updated_at: String(chat.updated_at),
          check_in: last ? { feeling: String(last.feeling), logged_at: String(last.logged_at) } : null,
        };
      });
    },

    async getLabResults(userId) {
      const rows = await rest.get("/rest/v1/lab_results", {
        select: "marker,label,value,unit,test_date",
        user_id: `eq.${userId}`,
        order: "test_date.desc,created_at.desc",
        limit: "120",
      });
      return Array.isArray(rows) ? (rows as unknown as LabResult[]) : [];
    },

    async getConsents(userId) {
      return rows(await rest.get("/rest/v1/consents", { select: "doc_type,version", user_id: `eq.${userId}` })).map((row) => ({
        doc_type: String(row.doc_type),
        version: String(row.version),
      }));
    },

    async claimConversation(userId, conversationId, language) {
      await rest.post(
        "/rest/v1/conversations",
        { id: conversationId, user_id: userId, language },
        { params: { on_conflict: "id" }, prefer: "resolution=ignore-duplicates,return=minimal" },
      );
      const row = first(await rest.get("/rest/v1/conversations", { select: "id,title", id: `eq.${conversationId}`, user_id: `eq.${userId}`, limit: "1" }));
      return row ? { id: String(row.id), title: (row.title as string | null) ?? null } : null;
    },

    async findUserMessage(userId, conversationId, clientMessageId) {
      const row = first(
        await rest.get("/rest/v1/messages", {
          select: "id,content,created_at",
          conversation_id: `eq.${conversationId}`,
          user_id: `eq.${userId}`,
          client_message_id: `eq.${clientMessageId}`,
          role: "eq.user",
          limit: "1",
        }),
      );
      return row ? { id: String(row.id), content: String(row.content ?? ""), created_at: String(row.created_at) } : null;
    },

    async findAnswer(userId, userMessageId) {
      const row = first(
        await rest.get("/rest/v1/messages", {
          select: "id,answer,sources,care_level,rule_ids,raised_by_rules",
          reply_to: `eq.${userMessageId}`,
          user_id: `eq.${userId}`,
          role: "eq.assistant",
          limit: "1",
        }),
      );
      if (!row) return null;
      return {
        id: String(row.id),
        answer: (row.answer as Answer | null) ?? null,
        sources: (row.sources as Source[] | null) ?? null,
        care_level: (row.care_level as CareLevel | null) ?? null,
        rule_ids: Array.isArray(row.rule_ids) ? (row.rule_ids as string[]) : [],
        raised_by_rules: row.raised_by_rules === true,
      } satisfies StoredAnswer;
    },

    async loadHistory(userId, conversationId, limit) {
      const list = rows(
        await rest.get("/rest/v1/messages", {
          select: "id,role,content,care_level",
          conversation_id: `eq.${conversationId}`,
          user_id: `eq.${userId}`,
          order: "created_at.desc",
          limit: String(limit),
        }),
      );
      return list
        .reverse()
        .map((row) => ({ id: String(row.id), role: row.role as HistoryItem["role"], text: String(row.content ?? ""), care: typeof row.care_level === "string" ? row.care_level : null }));
    },

    async insertMessage(message: NewMessage) {
      try {
        await rest.post("/rest/v1/messages", message, { prefer: "return=minimal" });
        return "inserted";
      } catch (error) {
        if (error instanceof RestError && error.isDuplicate) return "duplicate";
        throw error;
      }
    },

    async setTitleIfEmpty(userId, conversationId, title, topic) {
      await rest.patch("/rest/v1/conversations", { id: `eq.${conversationId}`, user_id: `eq.${userId}`, title: "is.null" }, { title, topic });
    },

    async consumeQuota(userId, limit, timezone) {
      const row = first(await rest.post("/rest/v1/rpc/consume_quota", { p_user: userId, p_limit: limit, p_timezone: timezone }));
      if (!row) throw new RestError(500, "no_quota_row");
      return { allowed: row.allowed === true, used: Number(row.used), remaining: Number(row.remaining) };
    },

    async releaseQuota(userId, timezone) {
      await rest.post("/rest/v1/rpc/release_quota", { p_user: userId, p_timezone: timezone });
    },

    async deleteEmptyConversation(userId, conversationId) {
      await rest.post("/rest/v1/rpc/delete_empty_conversation", { p_user: userId, p_conversation: conversationId });
    },

    async addUsageTokens(userId, tokensIn, tokensOut, timezone) {
      await rest.post("/rest/v1/rpc/add_usage_tokens", {
        p_user: userId,
        p_tokens_in: Math.max(0, Math.round(tokensIn)),
        p_tokens_out: Math.max(0, Math.round(tokensOut)),
        p_timezone: timezone,
      });
    },

    async usageTotalsToday(timezone) {
      const row = first(await rest.post("/rest/v1/rpc/usage_totals_today", { p_timezone: timezone }));
      return { messages: Number(row?.messages ?? 0), tokens_in: Number(row?.tokens_in ?? 0), tokens_out: Number(row?.tokens_out ?? 0) };
    },

    async logRuleEvent(event) {
      await rest.post("/rest/v1/rule_events", event, { prefer: "return=minimal" });
    },

    async cacheGet(key) {
      const row = first(
        await rest.get("/rest/v1/source_cache", { select: "payload", key: `eq.${key}`, expires_at: `gt.${new Date(now()).toISOString()}`, limit: "1" }),
      );
      return row ? row.payload : undefined;
    },

    async cacheSet(key, source, payload, ttlSeconds) {
      const at = now();
      await rest.post(
        "/rest/v1/source_cache",
        { key, source, payload, fetched_at: new Date(at).toISOString(), expires_at: new Date(at + ttlSeconds * 1000).toISOString() },
        { params: { on_conflict: "key" }, prefer: "resolution=merge-duplicates,return=minimal" },
      );
    },

    async loadForSummary(userId, conversationIds) {
      const [conversations, messages] = await Promise.all([
        rest.get("/rest/v1/conversations", {
          select: "id,title,max_care_level,created_at",
          user_id: `eq.${userId}`,
          id: inList(conversationIds),
        }),
        rest.get("/rest/v1/messages", {
          select: "conversation_id,role,content,answer,care_level,created_at",
          user_id: `eq.${userId}`,
          conversation_id: inList(conversationIds),
          order: "created_at.asc",
          limit: "300",
        }),
      ]);
      return {
        conversations: rows(conversations) as unknown as SummaryConversation[],
        messages: rows(messages) as unknown as SummaryMessage[],
      };
    },

    async deleteAuthUser(userId) {
      await rest.del(`/auth/v1/admin/users/${userId}`);
    },

    async ping() {
      await rest.get("/rest/v1/feature_flags", { select: "key", limit: "1" });
    },
  };
}
