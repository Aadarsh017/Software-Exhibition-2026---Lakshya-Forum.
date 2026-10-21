import type { AuthError } from "@supabase/supabase-js";

/** Turns an auth error into a calm, specific sentence (DESIGN.md 9.2). Never shows raw error text. */
export function friendlyAuthMessage(error: AuthError | { code?: string; message?: string }, context: "email" | "code" | "guest" = "email"): string {
  const code = "code" in error ? error.code : undefined;
  switch (code) {
    case "over_email_send_rate_limit":
    case "over_request_rate_limit":
      return "We've sent a few codes already. Please wait a minute and try again.";
    case "otp_expired":
      // Supabase reports a wrong code as "expired" too, so the sentence has to cover both.
      return "That code isn't right, or it has expired. Check it, or send a new one.";
    case "validation_failed":
    case "email_address_invalid":
      return "That email address doesn't look right. Please check it.";
    case "email_address_not_authorized":
      // Supabase's built-in email sender only reaches the project team until custom SMTP is set up (PLAN.md spike S6).
      return "We can't send email to that address yet. We're still setting up email sending.";
    case "email_exists":
    case "user_already_exists":
      return "That email already has an account.";
    case "anonymous_provider_disabled":
      return "Trying without an account isn't switched on yet. Please log in with your email.";
    case "session_expired":
      return "You've been signed out. Please log in again to keep your chats and details.";
    case "captcha_failed":
      return "We couldn't check you're a person. Please try again.";
    case "signup_disabled":
      return "New sign-ups are paused right now. Please try again later.";
    default:
      break;
  }
  if (context === "code") return "That code didn't work. Check it and try again, or send a new one.";
  if (context === "guest") return "We couldn't start a guest session. Please try again.";
  return "Something went wrong. Please try again.";
}
