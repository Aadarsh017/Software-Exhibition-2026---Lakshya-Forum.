// Types shared by the Edge Functions.
// Every file in _shared uses erasable TypeScript only (no enums, namespaces or parameter properties)
// and imports with explicit .ts extensions, so the same files run in Deno and in Node's test runner.

export type CareLevel = "selfcare" | "doctor" | "doctor24" | "emergency" | "ambulance";

/** A statement in an answer. Empty source_ids means "general guidance". */
export type Claim = { text: string; source_ids: string[] };
/** `kind: "otc"` marks an everyday medicine Nox suggested from the checked list (otc.ts); the others are ones the person named. */
export type Medicine = { name: string; note: string; source_ids: string[]; kind?: "otc" };
/**
 * Something the person said about themselves that their profile doesn't have yet (DESIGN.md 8.6f). Nox only proposes
 * it; the app asks the person, and saves it only when they tap Add.
 */
export type ProfileUpdate = { list: "medicines" | "conditions" | "allergies"; item: string };

/** The answer contract (PLAN.md 6.5). Field order is the order the model is asked to write them. */
export type Answer = {
  care_level: CareLevel;
  care_reason: string;
  headline: string;
  summary: string;
  likely_causes: Claim[];
  try_tonight: Claim[];
  see_doctor_if: Claim[];
  emergency_if: Claim[];
  medicines: Medicine[];
  questions_for_you: string[];
  unknowns: string;
  questions_for_doctor: string[];
  profile_updates: ProfileUpdate[];
  language: string;
};
export type AnswerField = keyof Answer;

export type Source = {
  id: string; // "S1", "S2"…
  kind: "condition" | "medicine";
  publisher: string;
  title: string;
  url: string;
  retrieved_at: string;
  passage: string; // at most 600 characters, quoted from the source
};

export type StatusStep = "read" | "safety" | "medlineplus" | "fda" | "write";
export type StatusState = "active" | "done" | "skipped" | "failed";

export type ErrorCode =
  | "unauthenticated"
  | "consent_required"
  | "quota_exceeded"
  | "rate_limited"
  | "llm_unavailable"
  | "bad_request"
  | "not_found"
  | "internal";

export type Usage = { tokens_in: number; tokens_out: number };

/** `care`: the care level of an earlier answer, when it was saved (used to tell whether a follow-up raises it). */
export type HistoryItem = { role: "user" | "assistant"; text: string; care?: string | null };

export type AuthUser = { id: string; isAnonymous: boolean };

// ---------------------------------------------------------------------------
// Data access. The functions only talk to the database through this interface, so tests can
// pass an in-memory version. The real one (repo.ts) goes through PostgREST with the secret key.
// ---------------------------------------------------------------------------

export type Profile = { display_name: string | null; language: string; save_chats: boolean; use_profile_in_answers: boolean };

export type HealthProfile = {
  age_range: string | null;
  sex_at_birth: string | null;
  pregnancy: string | null;
  conditions: string[];
  allergies: string[];
  medicines: string[];
  // Personal doctor v1 (migration 20261019050000). Optional, so older rows and fakes still fit.
  height_cm?: number | string | null;
  weight_kg?: number | string | null;
  smoking?: string | null;
  alcohol?: string | null;
  activity?: string | null;
  family_history?: string[];
};

/** A health diary entry (table health_log). */
export type DiaryEntry = {
  logged_at: string;
  symptom: string | null;
  severity: number | null;
  temperature_c: number | string | null;
  feeling: string | null;
  note: string | null;
  // Home readings (DESIGN.md 8.6d); optional so older rows and tests fit.
  bp_systolic?: number | null;
  bp_diastolic?: number | null;
  pulse?: number | null;
  glucose_mgdl?: number | null;
  glucose_timing?: string | null;
  weight_kg?: number | string | null;
};

/** A value the person typed from a blood report (table lab_results). */
export type LabResult = { marker: string; label: string | null; value: number | string; unit: string; test_date: string };

export type StoredAnswer = {
  id: string;
  answer: Answer | null;
  sources: Source[] | null;
  care_level: CareLevel | null;
  rule_ids: string[];
  raised_by_rules: boolean;
};

export type NewMessage = {
  id: string;
  conversation_id: string;
  user_id: string;
  role: "user" | "assistant";
  content: string;
  client_message_id?: string | null;
  reply_to?: string | null;
  answer?: Answer | null;
  sources?: Source[] | null;
  rule_ids?: string[];
  care_level?: CareLevel | null;
  raised_by_rules?: boolean;
  content_version?: string | null;
  model?: string | null;
  tokens_in?: number | null;
  tokens_out?: number | null;
  latency_ms?: number | null;
};

export type SummaryMessage = {
  conversation_id: string;
  role: "user" | "assistant";
  content: string | null;
  answer: Answer | null;
  care_level: CareLevel | null;
  created_at: string;
};

/** Thali (DESIGN.md 8.6g): a meal the person logged, and water glasses on a day. */
export type FoodEntry = { day: string; meal: string; items: string[]; portion: string | null; outside: boolean; note: string | null };
export type WaterEntry = { day: string; glasses: number };

/**
 * An earlier consultation: another of the person's chats about a health problem, with the last check-in on it, so Nox
 * remembers past visits like a family doctor (DESIGN.md 8.6f).
 */
export type PastConsultation = {
  id: string;
  title: string | null;
  max_care_level: string | null;
  updated_at: string;
  check_in: { feeling: string; logged_at: string } | null;
};

export type SummaryConversation = {
  id: string;
  title: string | null;
  max_care_level: CareLevel | null;
  created_at: string;
};

export type RuleEvent = {
  user_id: string | null;
  rule_ids: string[];
  level: "emergency" | "ambulance";
  source: "rules" | "model" | "client";
};

export interface Repo {
  getProfile(userId: string): Promise<Profile | null>;
  getHealthProfile(userId: string): Promise<HealthProfile | null>;
  /** Newest first. */
  getLabResults(userId: string): Promise<LabResult[]>;
  /** The last two weeks of the health diary, newest first. */
  getHealthLog(userId: string, sinceIso: string): Promise<DiaryEntry[]>;
  /** Other chats about a health problem since a date, newest first, at most 6, without the one named. */
  getPastConsultations?(userId: string, sinceIso: string, excludeId: string | null): Promise<PastConsultation[]>;
  /** Thali since a day (YYYY-MM-DD), newest first: meals (at most 16) and water (at most 4 days). */
  getFoodLog?(userId: string, sinceDay: string): Promise<{ meals: FoodEntry[]; water: WaterEntry[] }>;
  getConsents(userId: string): Promise<{ doc_type: string; version: string }[]>;
  /** Creates the conversation if it is new. Returns null when the id belongs to someone else. */
  claimConversation(userId: string, conversationId: string, language: string): Promise<{ id: string; title: string | null } | null>;
  /** The saved question for a client message id, with its words and when it was saved (security review 2026-10-20). */
  findUserMessage(userId: string, conversationId: string, clientMessageId: string): Promise<{ id: string; content: string; created_at: string } | null>;
  findAnswer(userId: string, userMessageId: string): Promise<StoredAnswer | null>;
  /** The newest messages first-to-last, at most `limit`. */
  loadHistory(userId: string, conversationId: string, limit: number): Promise<(HistoryItem & { id: string })[]>;
  insertMessage(message: NewMessage): Promise<"inserted" | "duplicate">;
  setTitleIfEmpty(userId: string, conversationId: string, title: string, topic: string | null): Promise<void>;
  consumeQuota(userId: string, limit: number, timezone: string): Promise<{ allowed: boolean; used: number; remaining: number }>;
  /** Gives back one counted question today (a parallel duplicate that never ran). */
  releaseQuota(userId: string, timezone: string): Promise<void>;
  /** Removes a conversation this request just created, when it holds nothing (a refused first question). */
  deleteEmptyConversation(userId: string, conversationId: string): Promise<void>;
  addUsageTokens(userId: string, tokensIn: number, tokensOut: number, timezone: string): Promise<void>;
  usageTotalsToday(timezone: string): Promise<{ messages: number; tokens_in: number; tokens_out: number }>;
  logRuleEvent(event: RuleEvent): Promise<void>;
  cacheGet(key: string): Promise<unknown | undefined>;
  cacheSet(key: string, source: string, payload: unknown, ttlSeconds: number): Promise<void>;
  loadForSummary(userId: string, conversationIds: string[]): Promise<{ conversations: SummaryConversation[]; messages: SummaryMessage[] }>;
  deleteAuthUser(userId: string): Promise<void>;
  ping(): Promise<void>;
}

export type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
