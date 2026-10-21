"use client";

import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cleanTitle, type ConversationItem } from "./group.ts";

/**
 * The person's chats, read through row-level security (they can only ever see their own). Rename changes the title
 * only; delete removes the chat and its messages (the database cascades). Saved summaries are not touched.
 */
export function useConversations(supabase: SupabaseClient, enabled: boolean) {
  const [items, setItems] = useState<ConversationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!enabled) return;
    const { data, error: failure } = await supabase
      .from("conversations")
      .select("id, title, max_care_level, updated_at")
      .order("updated_at", { ascending: false })
      .limit(200);
    setLoading(false);
    if (failure) {
      setError("We couldn't load your chats.");
      return;
    }
    setError(null);
    setItems((data ?? []) as ConversationItem[]);
  }, [supabase, enabled]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const rename = useCallback(
    async (id: string, title: string): Promise<string | null> => {
      const clean = cleanTitle(title);
      if (!clean) return "Please type a name.";
      const { error: failure } = await supabase.from("conversations").update({ title: clean }).eq("id", id);
      if (failure) return "We couldn't rename that chat.";
      setItems((current) => current.map((item) => (item.id === id ? { ...item, title: clean } : item)));
      return null;
    },
    [supabase],
  );

  const remove = useCallback(
    async (id: string): Promise<string | null> => {
      const { error: failure } = await supabase.from("conversations").delete().eq("id", id);
      if (failure) return "We couldn't delete that chat.";
      setItems((current) => current.filter((item) => item.id !== id));
      return null;
    },
    [supabase],
  );

  return { items, loading, error, reload, rename, remove };
}
