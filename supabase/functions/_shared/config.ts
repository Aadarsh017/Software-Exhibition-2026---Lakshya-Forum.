// Settings read from the environment. Supabase provides SUPABASE_URL and the keys; everything else
// is set with `supabase secrets set` (scripts/set-function-secrets.sh). Nothing here is ever sent
// to the browser.
import { REQUIRED_CONSENTS } from "./vendor/consent.js";

export type Config = {
  supabaseUrl: string;
  publishableKey: string;
  secretKey: string;
  allowedOrigins: string[];
  aiEnabled: boolean;
  llm: {
    baseUrl: string;
    apiKey: string;
    modelFast: string;
    modelMain: string;
    maxTokensParam: "max_tokens" | "max_completion_tokens";
    answerMaxTokens: number;
    timeoutMs: number;
    firstTokenTimeoutMs: number;
  };
  extractTimeoutMs: number;
  ground: { perSourceTimeoutMs: number; overallTimeoutMs: number; nlmTool: string; nlmEmail: string; openFdaKey: string };
  quota: { guest: number; member: number; timezone: string };
  ratePerMinute: number;
  dailyTokenCap: number; // 0 means no cap
  consents: Record<string, string>;
  limits: { messageChars: number; historyItems: number; historyChars: number };
};

type Env = (name: string) => string | undefined;

function int(env: Env, name: string, fallback: number, min = 0): number {
  const raw = env(name);
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= min ? Math.floor(value) : fallback;
}

function text(env: Env, name: string, fallback = ""): string {
  const raw = env(name)?.trim();
  return raw ? raw : fallback; // an empty setting counts as not set
}

/**
 * New-style keys arrive as JSON maps in SUPABASE_SECRET_KEYS / SUPABASE_PUBLISHABLE_KEYS when the
 * platform provides them; the legacy names are the fallback. SB_SECRET_KEY lets you set one yourself.
 */
function pickKey(env: Env, own: string, jsonMap: string, legacy: string): string {
  const mine = text(env, own);
  if (mine) return mine;
  const map = text(env, jsonMap);
  if (map) {
    try {
      const parsed = JSON.parse(map) as Record<string, unknown>;
      const value = parsed.default ?? Object.values(parsed)[0];
      if (typeof value === "string" && value) return value;
    } catch {
      // not JSON: ignore and fall back
    }
  }
  return text(env, legacy);
}

export class ConfigError extends Error {
  missing: string[];
  constructor(missing: string[]) {
    super(`missing settings: ${missing.join(", ")}`);
    this.name = "ConfigError";
    this.missing = missing;
  }
}

export function loadConfig(env: Env): Config {
  const supabaseUrl = text(env, "SUPABASE_URL").replace(/\/+$/, "");
  const secretKey = pickKey(env, "SB_SECRET_KEY", "SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
  const publishableKey = pickKey(env, "SB_PUBLISHABLE_KEY", "SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
  const missing = [
    ["SUPABASE_URL", supabaseUrl],
    ["a secret key (SUPABASE_SERVICE_ROLE_KEY or SB_SECRET_KEY)", secretKey],
    ["a publishable key (SUPABASE_ANON_KEY or SB_PUBLISHABLE_KEY)", publishableKey],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length) throw new ConfigError(missing);

  const llmBase = text(env, "LLM_BASE_URL").replace(/\/+$/, "");
  const llmKey = text(env, "LLM_API_KEY");
  const modelMain = text(env, "LLM_MODEL_MAIN");
  const modelFast = text(env, "LLM_MODEL_FAST", modelMain);
  const llmConfigured = Boolean(llmBase && llmKey && modelMain);

  return {
    supabaseUrl,
    publishableKey,
    secretKey,
    allowedOrigins: text(env, "ALLOWED_ORIGINS", "http://localhost:3000")
      .split(",")
      .map((origin) => origin.trim().replace(/\/+$/, ""))
      .filter(Boolean),
    // The kill switch: AI_ENABLED=false turns every answer into the sources-only mode.
    aiEnabled: llmConfigured && text(env, "AI_ENABLED", "true").toLowerCase() !== "false",
    llm: {
      baseUrl: llmBase,
      apiKey: llmKey,
      modelFast,
      modelMain,
      maxTokensParam: text(env, "LLM_MAX_TOKENS_PARAM") === "max_completion_tokens" ? "max_completion_tokens" : "max_tokens",
      answerMaxTokens: int(env, "LLM_ANSWER_MAX_TOKENS", 1400, 200),
      timeoutMs: int(env, "LLM_TIMEOUT_MS", 60_000, 1000),
      firstTokenTimeoutMs: int(env, "LLM_FIRST_TOKEN_TIMEOUT_MS", 20_000, 1000),
    },
    extractTimeoutMs: int(env, "EXTRACT_TIMEOUT_MS", 3500, 500),
    ground: {
      perSourceTimeoutMs: int(env, "GROUND_SOURCE_TIMEOUT_MS", 4000, 500),
      overallTimeoutMs: int(env, "GROUND_TIMEOUT_MS", 6000, 500),
      nlmTool: text(env, "NLM_TOOL", "health-chat-helper"),
      nlmEmail: text(env, "NLM_EMAIL"),
      openFdaKey: text(env, "OPENFDA_API_KEY"),
    },
    quota: {
      guest: int(env, "QUOTA_GUEST", 8),
      member: int(env, "QUOTA_USER", 30),
      timezone: text(env, "QUOTA_TIMEZONE", "Asia/Kolkata"),
    },
    ratePerMinute: int(env, "RATE_PER_MINUTE", 8, 1),
    dailyTokenCap: int(env, "DAILY_TOKEN_CAP", 0),
    consents: { ...REQUIRED_CONSENTS },
    limits: { messageChars: 4000, historyItems: 12, historyChars: 12_000 },
  };
}
