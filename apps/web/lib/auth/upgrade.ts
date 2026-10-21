// Sign-in with an email code, and the special case of a guest adding an email: the same account, same chats
// (Supabase "anonymous user to permanent user"). Written against a tiny interface so it can be tested with a fake.
// Erasable TypeScript only.

export type AuthError = { code?: string; message?: string; status?: number } | null;

export type AuthClient = {
  updateUser(attributes: { email: string }, options?: { emailRedirectTo?: string }): Promise<{ error: AuthError }>;
  signInWithOtp(credentials: { email: string; options?: { shouldCreateUser?: boolean; emailRedirectTo?: string; captchaToken?: string } }): Promise<{ error: AuthError }>;
  verifyOtp(params: { email: string; token: string; type: "email" | "email_change" }): Promise<{ error: AuthError }>;
};

/** "upgrade": a guest adds an email to the account they already have. "login": a normal sign-in (a new session). */
export type Mode = "upgrade" | "login";

export type Started = { ok: true; mode: Mode } | { ok: false; reason: "exists" | "error"; error: AuthError };

const EXISTS_CODES = new Set(["email_exists", "user_already_exists", "identity_already_exists", "email_conflict_identity_not_deletable"]);

export function isEmailTaken(error: AuthError): boolean {
  if (!error) return false;
  if (error.code && EXISTS_CODES.has(error.code)) return true;
  return /already (?:been )?registered|already exists|already in use/i.test(error.message ?? "");
}

/**
 * Sends the code. A guest asking to "continue with email" keeps their account: the email is added to it, and the
 * code that arrives confirms the change. If the address already belongs to someone, we say so instead of silently
 * making a second account (the caller can then offer a normal log in).
 */
export async function startEmail(
  auth: AuthClient,
  options: { email: string; isGuest: boolean; redirectTo: string; forceLogin?: boolean; captcha?: () => Promise<string | undefined> },
): Promise<Started> {
  const email = options.email.trim();
  if (options.isGuest && !options.forceLogin) {
    const { error } = await auth.updateUser({ email }, { emailRedirectTo: options.redirectTo });
    if (!error) return { ok: true, mode: "upgrade" };
    return { ok: false, reason: isEmailTaken(error) ? "exists" : "error", error };
  }
  // Sending a code is what the CAPTCHA guards (lib/auth/captcha.ts); a guest adding an email needs none. Tokens work
  // once, so one is fetched only here, right before it is used.
  let captchaToken: string | undefined;
  try {
    captchaToken = options.captcha ? await options.captcha() : undefined;
  } catch (failure) {
    return { ok: false, reason: "error", error: failure as AuthError };
  }
  const { error } = await auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true, emailRedirectTo: options.redirectTo, ...(captchaToken ? { captchaToken } : {}) },
  });
  return error ? { ok: false, reason: "error", error } : { ok: true, mode: "login" };
}

export async function verifyEmail(auth: AuthClient, options: { email: string; code: string; mode: Mode }): Promise<{ error: AuthError }> {
  return auth.verifyOtp({ email: options.email.trim(), token: options.code.trim(), type: options.mode === "upgrade" ? "email_change" : "email" });
}
