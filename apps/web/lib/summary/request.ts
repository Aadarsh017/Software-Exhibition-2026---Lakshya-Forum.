// Calls the `summary` Edge Function with the person's sign-in token (supabase/functions/README.md).
import type { SupabaseClient } from "@supabase/supabase-js";

export type SummaryReply =
  | { ok: true; summary: unknown; degraded: boolean; prepared_at: string }
  | { ok: false; message: string };

const MESSAGES: Record<string, string> = {
  quota_exceeded: "You've used today's questions, and a summary counts as one. They come back tomorrow morning.",
  consent_required: "Please accept the notices in the chat first, then try again.",
  not_found: "One of those chats couldn't be found. Refresh the page and choose again.",
  rate_limited: "That was quick. Please wait a moment, then try again.",
  unauthenticated: "Your session ended. Please reload the page.",
};

export async function requestSummary(supabase: SupabaseClient, conversationIds: string[]): Promise<SummaryReply> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { ok: false, message: MESSAGES.unauthenticated ?? "" };
  let response: Response;
  try {
    response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/summary`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ conversation_ids: conversationIds }),
    });
  } catch {
    return { ok: false, message: "We couldn't reach the server. Please try again when you're back online." };
  }
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (response.ok && body && body.summary) {
    return { ok: true, summary: body.summary, degraded: body.degraded === true, prepared_at: String(body.prepared_at ?? new Date().toISOString()) };
  }
  const code = (body?.error as { code?: string } | undefined)?.code ?? "";
  return { ok: false, message: MESSAGES[code] ?? "Something went wrong on our side. Please try again." };
}
