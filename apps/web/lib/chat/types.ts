// What the chat function sends (supabase/functions/README.md is the contract) and what the screen keeps.
// Erasable TypeScript only, so the logic in this folder also runs under Node in the tests.

export type CareLevel = "selfcare" | "doctor" | "doctor24" | "emergency" | "ambulance";

export type Claim = { text: string; source_ids: string[] };
/** `kind: "otc"`: an everyday medicine Nox suggested from its checked list (no prescription needed). */
export type Medicine = { name: string; note: string; source_ids: string[]; kind?: "otc" };

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
  /** Things the person said about themselves that their profile lacks; saved only when they tap Add (DESIGN.md 8.6f). */
  profile_updates?: ProfileUpdate[];
  language: string;
};
export type AnswerField = keyof Answer;
export type ProfileUpdate = { list: "medicines" | "conditions" | "allergies"; item: string };

export type Source = {
  id: string;
  kind: "condition" | "medicine";
  publisher: string;
  title: string;
  url: string;
  retrieved_at: string;
  passage: string;
};

export type StepName = "read" | "safety" | "medlineplus" | "fda" | "write";
export type StepState = "pending" | "active" | "done" | "skipped" | "failed";
export const STEP_ORDER: readonly StepName[] = ["read", "safety", "medlineplus", "fda", "write"];

export type ErrorCode =
  | "unauthenticated"
  | "consent_required"
  | "quota_exceeded"
  | "rate_limited"
  | "llm_unavailable"
  | "bad_request"
  | "not_found"
  | "internal"
  | "network";

export type RedFlag = {
  level: "emergency" | "ambulance";
  rule_ids: string[];
  crisis: boolean;
  signs: string[];
  source: "rules" | "model" | "device";
};

export type DonePayload = {
  /** What Nox was given about the person for this answer, as counts (DESIGN.md 8.6f); absent on older servers and replays. */
  used?: { profile: boolean; labs: number; diary: number; past: number; food?: number } | null;
  message_id: string;
  usage: { tokens_in: number; tokens_out: number };
  latency_ms: number;
  degraded: boolean;
  degraded_reason: string | null;
  saved: boolean;
  care_level: CareLevel | null;
  raised_by_rules: boolean;
  replayed: boolean;
};

export type ServerEvent =
  | { event: "meta"; data: { conversation_id: string | null; message_id: string; user_message_id: string } }
  | { event: "status"; data: { step: StepName; state: Exclude<StepState, "pending"> } }
  | { event: "red_flag"; data: Omit<RedFlag, "source"> & { source: "rules" | "model" } }
  | { event: "sources"; data: Source[] }
  | { event: "field"; data: { name: AnswerField; value: unknown } }
  | { event: "done"; data: DonePayload }
  | { event: "error"; data: { code: ErrorCode; message: string; retryable: boolean } };

export type TurnError = {
  code: ErrorCode;
  message: string;
  retryable: boolean;
  /** Extras the server sent with the error (limit, resets_at, retry_after_s, missing…). */
  extra: Record<string, unknown>;
};

export type TurnStatus = "sending" | "streaming" | "done" | "error" | "stopped";

export type Turn = {
  /** The client_message_id: stays the same across retries, so a retry is safe. */
  id: string;
  userText: string;
  status: TurnStatus;
  steps: Record<StepName, StepState>;
  redFlag: RedFlag | null;
  sources: Source[];
  sourcesArrived: boolean;
  fields: Partial<Answer>;
  messageId: string | null;
  done: DonePayload | null;
  error: TurnError | null;
};
