import type { AuthError, Session, SupabaseClient } from "@supabase/supabase-js";
import { captchaToken } from "@/lib/auth/captcha";

type SessionError = AuthError | { code: string; message: string };

// This browser was last signed in as a member (bug review 2026-10-20). If that session ends without signing out
// (revoked, or the refresh failed), a new guest must not be made in its place: their messages would go to a throwaway
// account while the screen still showed their name. They are asked to log in again instead.
const MEMBER_KEY = "hale-member";
function markMember(member: boolean): void {
  try {
    if (member) localStorage.setItem(MEMBER_KEY, "1");
    else localStorage.removeItem(MEMBER_KEY);
  } catch {
    // Storage blocked: behave as before (a guest when there is no session).
  }
}
function wasMember(): boolean {
  try {
    return localStorage.getItem(MEMBER_KEY) === "1";
  } catch {
    return false;
  }
}
/** Signing out on purpose, or deleting the account: the next visit may start as a guest again. */
export function forgetMember(): void {
  markMember(false);
}

// One guest sign-in at a time for the whole page. Without this, two callers (React runs effects twice in
// development, or two components start at once) could each create a guest, and the page would end up holding one
// guest's session while saving under the other's id.
let pending: Promise<{ session: Session | null; error: SessionError | null }> | null = null;

/** The current session, or a new guest session if there is none. Safe to call from many places at once. */
export function ensureSession(supabase: SupabaseClient): Promise<{ session: Session | null; error: SessionError | null }> {
  if (pending) return pending;
  pending = (async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session) {
      markMember(!session.user.is_anonymous);
      return { session, error: null };
    }
    if (wasMember()) return { session: null, error: { code: "session_expired", message: "Your session ended." } };
    // A new guest passes Cloudflare's check first (lib/auth/captcha.ts); without a site key there is no check.
    let token: string | undefined;
    try {
      token = await captchaToken("guest");
    } catch (failure) {
      return { session: null, error: failure as SessionError };
    }
    const { data, error } = await supabase.auth.signInAnonymously(token ? { options: { captchaToken: token } } : undefined);
    return { session: data.session ?? null, error };
  })().finally(() => {
    pending = null;
  });
  return pending;
}

/** The id of the person this browser is signed in as right now (never a stale copy kept in React state). */
export async function currentUserId(supabase: SupabaseClient): Promise<string | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.user.id ?? null;
}
