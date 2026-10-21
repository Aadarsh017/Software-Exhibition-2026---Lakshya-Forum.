import { createClient } from "@/lib/supabase/server";

/**
 * Whether the visitor is logged in with an account (not a guest), for the public pages' links (DESIGN.md 8.6b: no
 * "Log in" for someone already logged in). It reads the session cookie and checks its signature with the project's
 * public keys (getClaims), so no Auth request is made per page view. Any error counts as "not logged in".
 */
export async function isSignedInMember(): Promise<boolean> {
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getClaims();
    const claims = data?.claims;
    return Boolean(claims?.sub) && claims?.is_anonymous !== true;
  } catch {
    return false;
  }
}
