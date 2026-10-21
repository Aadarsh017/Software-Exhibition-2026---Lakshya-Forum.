"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useAccount } from "@/lib/account/use-account";
import { normalizeContent, summaryToText, type SummaryContent } from "@/lib/summary/content";
import { personalSections, personalToText, type PersonalSections } from "@/lib/summary/personal";
import { fromRow } from "@/lib/personalization/profile";
import type { LabRecord } from "@/lib/personalization/labs";
import { DIARY_COLUMNS, type DiaryRecord } from "@/lib/diary/diary";
import { addDays, DOSE_COLUMNS, doseDay, SCHEDULE_COLUMNS, toSchedule, type Dose, type Schedule } from "@/lib/medicines/today";
import { AppShell } from "@/components/app/app-shell";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DoctorSummary } from "./doctor-summary";
import { SummaryEditor } from "./summary-editor";

/** One saved summary: read, print or save as PDF, copy, edit, delete (DESIGN.md 8.7). */
export function SummaryView() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const fresh = useSearchParams().get("new") === "1";
  const { supabase, state } = useAccount();
  const [content, setContent] = useState<SummaryContent | null>(null);
  const [missing, setMissing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [personal, setPersonal] = useState<PersonalSections | null>(null);

  // About me, blood results, the diary (DESIGN.md 8.6c) and medicine ticks (8.6e): from the person's own records, accounts only.
  useEffect(() => {
    if (state.phase !== "ready" || state.guest) return;
    const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
    void Promise.all([
      supabase.from("health_profile").select("*").maybeSingle(),
      supabase.from("lab_results").select("id, marker, label, value, unit, test_date").order("test_date", { ascending: false }).limit(300),
      // Every entry of the two weeks: the averages and counts below are labelled "last 2 weeks" (bug review 2026-10-20:
      // 50 rows cut off the older readings of someone logging several times a day).
      supabase.from("health_log").select(DIARY_COLUMNS).gte("logged_at", since).order("logged_at", { ascending: false }).limit(1000),
      supabase.from("medicine_schedule").select(SCHEDULE_COLUMNS).limit(50),
      supabase.from("dose_log").select(DOSE_COLUMNS).gte("taken_on", addDays(doseDay(), -14)).limit(3000),
    ]).then(([health, labs, diary, schedules, doses]) => {
      const medicines = {
        schedules: ((schedules.data ?? []) as Record<string, unknown>[]).map(toSchedule).filter((row): row is Schedule => row !== null),
        doses: (doses.data ?? []) as Dose[],
      };
      setPersonal(personalSections(health.data ? fromRow(health.data as Record<string, unknown>) : null, (labs.data ?? []) as LabRecord[], (diary.data ?? []) as DiaryRecord[], new Date(), medicines));
    });
  }, [state, supabase]);

  useEffect(() => {
    if (state.phase !== "ready") return;
    let cancelled = false;
    supabase
      .from("summaries")
      .select("content")
      .eq("id", params.id)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        if (!data) setMissing(true);
        else setContent(normalizeContent(data.content));
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, state.phase, params.id]);

  async function save(next: SummaryContent): Promise<string | null> {
    const { error } = await supabase.from("summaries").update({ title: next.summary.title, content: next }).eq("id", params.id);
    if (error) return "We couldn't save your changes. Please try again.";
    setContent(next);
    setEditing(false);
    setNote("Saved");
    return null;
  }

  async function copy() {
    if (!content) return;
    try {
      await navigator.clipboard.writeText([summaryToText(content), personal ? personalToText(personal) : ""].filter(Boolean).join("\n\n"));
      setNote("Copied as text");
    } catch {
      setNote("Couldn't copy. Select the text instead.");
    }
  }

  return (
    <AppShell title="Visit summary" back={{ href: "/app/summaries", label: "Back to all summaries" }}>
      {/* grid-cols-1: the column is the screen's width, never the widest thing inside it (DESIGN.md 8.3). */}
      <main id="main" className="mx-auto grid w-full max-w-[820px] grid-cols-1 gap-4 px-4 py-6 sm:px-6">
        {missing ? (
          <div className="error-card" role="alert">
            <p className="m-0 font-bold">We couldn&apos;t find this summary</p>
            <p className="mt-1 mb-0">
              It may have been deleted. <Link href="/app/summaries">See your summaries</Link>
            </p>
          </div>
        ) : null}

        {!content && !missing ? <div className="skeleton h-96 w-full" aria-busy="true" aria-label="Loading the summary" /> : null}

        {content ? (
          <>
            {!editing ? (
              // One main action, then the rest in one even row (founder, 2026-10-19: the buttons wrapped into a pile).
              <div className="no-print grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))]">
                <button type="button" className="btn btn-primary w-full" onClick={() => window.print()}>
                  Print or save as PDF
                </button>
                <div className="grid grid-cols-3 gap-2 sm:contents">
                  <button type="button" className="btn w-full" onClick={copy}>
                    Copy
                  </button>
                  <button type="button" className="btn w-full" onClick={() => setEditing(true)}>
                    Edit
                  </button>
                  <button type="button" className="btn w-full" onClick={() => setDeleting(true)}>
                    Delete
                  </button>
                </div>
              </div>
            ) : null}
            <p className="no-print m-0 min-h-0 text-center text-[0.875rem] text-[var(--ink-muted)]" role="status">
              {note ?? ""}
            </p>

            {fresh && !editing ? (
              <p className="no-print banner m-0">Check it and edit anything that&apos;s wrong before you print. It only uses what you said.</p>
            ) : null}
            {content.degraded && !editing ? (
              <p className="no-print banner m-0">Our AI helper was offline, so this is your own words in order. You can edit it.</p>
            ) : null}

            {editing ? <SummaryEditor initial={content} onSave={save} onCancel={() => setEditing(false)} /> : <DoctorSummary content={content} personal={personal} />}
          </>
        ) : null}
      </main>

      <ConfirmDialog
        open={deleting}
        title="Delete this summary?"
        confirmLabel="Delete summary"
        onCancel={() => setDeleting(false)}
        onConfirm={async () => {
          const { error } = await supabase.from("summaries").delete().eq("id", params.id);
          if (error) return "We couldn't delete it. Please try again.";
          router.replace("/app/summaries");
          return null;
        }}
      >
        <p className="m-0">This removes the summary from your account. The chats it came from stay.</p>
      </ConfirmDialog>
    </AppShell>
  );
}
