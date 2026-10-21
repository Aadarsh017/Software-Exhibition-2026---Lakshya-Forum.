"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { isLanguage, isTextSize, type Language, type TextSize } from "@/lib/onboarding/settings";

export type AccountProfile = {
  display_name: string | null;
  language: Language;
  text_size: TextSize;
  save_chats: boolean;
  use_profile_in_answers: boolean;
  onboarded_at: string | null;
};

export type ConsentRecord = { doc_type: string; version: string; accepted_at: string };

export type AccountState =
  | { phase: "loading" }
  | { phase: "ready"; userId: string; guest: boolean; email: string | null };

/**
 * The signed-in person (guest or member), their settings and their consent history, for the pages around the chat
 * (Settings, Summaries). It never starts a session itself: with none, it sends the person to /app, which does.
 */
export function useAccount() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [state, setState] = useState<AccountState>({ phase: "loading" });
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [consents, setConsents] = useState<ConsentRecord[]>([]);

  const load = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      router.replace("/app");
      return;
    }
    const user = session.user;
    setState({ phase: "ready", userId: user.id, guest: user.is_anonymous === true, email: user.email ?? null });
    const [profileRow, consentRows] = await Promise.all([
      supabase.from("profiles").select("display_name, language, text_size, save_chats, use_profile_in_answers, onboarded_at").eq("id", user.id).maybeSingle(),
      supabase.from("consents").select("doc_type, version, accepted_at").order("accepted_at", { ascending: true }),
    ]);
    if (profileRow.data) {
      const row = profileRow.data;
      setProfile({
        display_name: row.display_name ?? null,
        language: isLanguage(row.language) ? row.language : "en",
        text_size: isTextSize(row.text_size) ? row.text_size : "m",
        save_chats: row.save_chats !== false,
        use_profile_in_answers: row.use_profile_in_answers !== false,
        onboarded_at: row.onboarded_at ?? null,
      });
    }
    setConsents((consentRows.data ?? []) as ConsentRecord[]);
  }, [supabase, router]);

  useEffect(() => {
    void load();
  }, [load]);

  const updateProfile = useCallback(
    async (patch: Partial<Omit<AccountProfile, "onboarded_at">>): Promise<string | null> => {
      if (state.phase !== "ready") return "Please wait a moment and try again.";
      // Check a row really changed: a write under someone else's id would otherwise "succeed" silently.
      const { data, error } = await supabase.from("profiles").update(patch).eq("id", state.userId).select("id");
      if (error || !data?.length) return "We couldn't save that. Please reload the page and try again.";
      setProfile((current) => (current ? { ...current, ...patch } : current));
      return null;
    },
    [supabase, state],
  );

  return { supabase, state, profile, consents, updateProfile, reload: load };
}
