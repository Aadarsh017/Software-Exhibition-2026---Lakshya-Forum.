// The words the screen uses for each error code. Chosen by code (never the server's English), so they can be translated.
import type { TurnError } from "./types.ts";

export type FriendlyError = { title: string; body: string; canRetry: boolean; tone: "calm" | "error" };

function timeOfDay(iso: unknown): string | null {
  if (typeof iso !== "string") return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function friendlyError(error: TurnError, guest: boolean): FriendlyError {
  switch (error.code) {
    case "quota_exceeded": {
      const at = timeOfDay(error.extra.resets_at);
      return {
        tone: "calm",
        canRetry: false,
        title: "You've used today's questions",
        body: `${at ? `They come back at ${at}. ` : "They come back tomorrow morning. "}For anything urgent, call 112 or your doctor.${guest ? " Log in with your email for more questions a day." : ""}`,
      };
    }
    case "rate_limited": {
      const wait = Number(error.extra.retry_after_s);
      return { tone: "calm", canRetry: true, title: "That was quick", body: `Please wait ${Number.isFinite(wait) && wait > 0 ? `${Math.ceil(wait)} seconds` : "a moment"}, then try again.` };
    }
    case "unauthenticated":
      return { tone: "error", canRetry: true, title: "Your session ended", body: "We couldn't confirm it's you. Try again, or log in. Your message is kept." };
    case "consent_required":
      return { tone: "calm", canRetry: true, title: "One quick step first", body: "Please accept the notices above, then send your message again." };
    case "bad_request":
      return { tone: "error", canRetry: false, title: "We couldn't send that", body: error.message || "Please check your message and try again." };
    case "not_found":
      return { tone: "error", canRetry: false, title: "We couldn't find this chat", body: "Start a new chat to carry on." };
    case "network":
      return { tone: "error", canRetry: true, title: "No connection", body: "We couldn't reach the server. Your message is kept. Try again when you're back online." };
    default:
      return { tone: "error", canRetry: true, title: "Something went wrong on our side", body: "Your message is kept. Please try again." };
  }
}

/** The one line shown when the answer is a fixed or sources-only one. Null when the answer is a normal one. */
export function degradedNotice(reason: string | null): string | null {
  switch (reason) {
    case null:
    case "quota":
    case "consent":
    case "db":
      return null; // an emergency answer: its own wording already says what to do
    case "ai_off":
    case "llm_error":
      return "Our AI helper is offline right now. Here is what trusted sources say.";
    case "incomplete":
    case "truncated":
      return "This answer was cut short. Try asking again for the full version.";
    default:
      return "This answer may be incomplete.";
  }
}
