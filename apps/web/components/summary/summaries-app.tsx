"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useAccount } from "@/lib/account/use-account";
import { displayTitle, formatWhen } from "@/lib/history/group";
import { useConversations } from "@/lib/history/use-conversations";
import { formatPrepared, newContent } from "@/lib/summary/content";
import { requestSummary } from "@/lib/summary/request";
import { AppShell } from "@/components/app/app-shell";
import { MarginNote } from "@/components/ui/margin-note";
import { ChevronRightIcon, DocIcon } from "@/components/chat/icons";

type Saved = { id: string; title: string | null; created_at: string };
const MAX = 5;

/**
 * Doctor summaries (DESIGN.md 8.7): making a new one from up to five chats, picked as row cards, and the saved ones as
 * row cards, in the same notebook frame as the rest of the app (note on top, content in the middle).
 */
export function SummariesApp() {
  const router = useRouter();
  const { supabase, state } = useAccount();
  const ready = state.phase === "ready";
  const conversations = useConversations(supabase, ready);
  const [saved, setSaved] = useState<Saved[] | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSaved = useCallback(async () => {
    const { data } = await supabase.from("summaries").select("id, title, created_at").order("created_at", { ascending: false }).limit(100);
    setSaved((data ?? []) as Saved[]);
  }, [supabase]);

  useEffect(() => {
    if (ready) void loadSaved();
  }, [ready, loadSaved]);

  function toggle(id: string) {
    setChosen((current) => (current.includes(id) ? current.filter((item) => item !== id) : current.length >= MAX ? current : [...current, id]));
  }

  async function make() {
    if (!chosen.length) return;
    setBusy(true);
    setError(null);
    // Full (200 kept): say so before making one, which would use up one of today's questions (bug review 2026-10-20).
    const { count } = await supabase.from("summaries").select("id", { count: "exact", head: true });
    if ((count ?? 0) >= 200) {
      setBusy(false);
      setError("You have 200 saved summaries, the most Hale keeps. Delete a few old ones, then make this one.");
      return;
    }
    const reply = await requestSummary(supabase, chosen);
    if (!reply.ok) {
      setBusy(false);
      setError(reply.message);
      return;
    }
    const content = newContent(reply.summary, chosen, reply.prepared_at, reply.degraded);
    const { data, error: failure } = await supabase
      .from("summaries")
      .insert({ conversation_id: chosen[0], title: content.summary.title, content })
      .select("id")
      .single();
    setBusy(false);
    if (failure || !data) {
      setError(
        failure && /too many/i.test(failure.message)
          ? "You have 200 saved summaries, the most Hale keeps. Delete a few old ones, then make this one."
          : "The summary was made but couldn't be saved. Please try again.",
      );
      return;
    }
    router.push(`/app/summaries/${data.id}?new=1`);
  }

  const now = new Date();
  return (
    <AppShell title="Doctor summaries">
      <main id="main" className="flex w-full flex-1 flex-col">
        <h1 className="sr-only">Doctor summaries</h1>
        <div className="mx-auto w-full max-w-[640px] px-4 pt-3 sm:px-6">
          <MarginNote>{`Choose up to ${MAX} chats about the same problem. I'll turn your own words into a one-page summary to print or share.`}</MarginNote>
        </div>

        <div className="m-auto grid w-full max-w-[640px] grid-cols-1 gap-5 px-4 pt-4 pb-6 sm:px-6">
          <section className="grid grid-cols-1 gap-2.5" aria-labelledby="new-summary">
            <h2 id="new-summary" className="section-label flex justify-between gap-2">
              <span>Make a new one</span>
              <span aria-live="polite">
                {chosen.length} of {MAX} chosen
              </span>
            </h2>

            {conversations.loading ? <div className="skeleton h-16 w-full" aria-busy="true" aria-label="Loading your chats" /> : null}
            {!conversations.loading && conversations.items.length === 0 ? (
              <div className="row-card" style={{ cursor: "default" }}>
                <span className="tile" data-tone="butter" aria-hidden="true">
                  <DocIcon />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="row-title block">No saved chats yet</span>
                  <span className="row-sub block">
                    <Link href="/app">Ask a question first</Link>, then come back.
                  </span>
                </span>
              </div>
            ) : null}

            {conversations.items.length ? (
              <fieldset className="m-0 grid grid-cols-1 gap-2.5 border-0 p-0">
                <legend className="sr-only">Your chats, choose up to {MAX}</legend>
                {conversations.items.slice(0, 30).map((item) => {
                  const on = chosen.includes(item.id);
                  const full = !on && chosen.length >= MAX;
                  return (
                    <label key={item.id} className="row-card" data-on={on ? "true" : "false"} aria-disabled={full ? "true" : undefined}>
                      <input type="checkbox" className="pick-box" checked={on} disabled={full} onChange={() => toggle(item.id)} />
                      <span className="min-w-0 flex-1">
                        <span className="row-title block truncate">{displayTitle(item.title)}</span>
                        <span className="row-sub block">{formatWhen(item.updated_at, now)}</span>
                      </span>
                    </label>
                  );
                })}
              </fieldset>
            ) : null}

            {error ? (
              <p role="alert" className="error-card m-0">
                {error}
              </p>
            ) : null}
            {conversations.items.length ? (
              <>
                <button type="button" className="btn btn-primary btn-lg w-full" disabled={!chosen.length || busy} onClick={make}>
                  {busy ? "Making your summary…" : chosen.length ? `Make summary from ${chosen.length} ${chosen.length === 1 ? "chat" : "chats"}` : "Choose a chat to start"}
                </button>
                <p className="m-0 text-center text-[0.8125rem] text-[var(--ink-muted)]">Counts as one of today&apos;s questions. Only what you said is used.</p>
              </>
            ) : null}
          </section>

          <section className="grid grid-cols-1 gap-2.5" aria-labelledby="saved-summaries">
            <h2 id="saved-summaries" className="section-label">
              Saved summaries
            </h2>
            {saved === null ? <div className="skeleton h-16 w-full" aria-busy="true" aria-label="Loading your summaries" /> : null}
            {saved && saved.length === 0 ? <MarginNote>None yet. Make one above and it stays here, ready to print.</MarginNote> : null}
            {saved && saved.length ? (
              <ul className="m-0 grid list-none grid-cols-1 gap-2.5 p-0">
                {saved.map((item) => (
                  <li key={item.id}>
                    <Link href={`/app/summaries/${item.id}`} className="row-card">
                      <span className="tile" data-tone="butter" aria-hidden="true">
                        <DocIcon />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="row-title block truncate">{displayTitle(item.title)}</span>
                        <span className="row-sub block">{formatPrepared(item.created_at)}</span>
                      </span>
                      <ChevronRightIcon />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        </div>
      </main>
    </AppShell>
  );
}
