"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount } from "@/lib/account/use-account";
import { COMMON_SYMPTOMS, DIARY_COLUMNS, emptyDraft, FEELINGS, groupByDay, timeOf, toDiaryRow, type DiaryDraft, type DiaryRecord, type Feeling } from "@/lib/diary/diary";
import { isReadingKind, readingBand, readingContext, readingText, type ReadingContext, type ReadingKind } from "@/lib/diary/readings";
import { displayTitle } from "@/lib/history/group";
import { AppShell } from "@/components/app/app-shell";
import { ChoiceGroup } from "@/components/onboarding/choice-group";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EditorScreen } from "@/components/personalization/editors";
import { BookmarkIcon, CloseIcon } from "@/components/chat/icons";
import { MarginNote } from "@/components/ui/margin-note";
import { ReadingForm, TrendCard } from "./readings";

const FEELING_TONE: Record<Feeling, string> = { better: "mint", same: "butter", worse: "coral" };
const SEVERITY = Array.from({ length: 11 }, (_, n) => ({ value: String(n), label: String(n) }));

/**
 * The health diary (DESIGN.md 8.6c, 8.6d): how you feel, a symptom, how bad, temperature, a note, and home readings
 * (blood pressure, sugar, weight), by day. Nox reads the last two weeks (when the profile is allowed in answers) and the
 * doctor summary prints it. Accounts only.
 */
export function DiaryApp() {
  const router = useRouter();
  const params = useSearchParams();
  const adding = params.get("add");
  const { supabase, state } = useAccount();
  const ready = state.phase === "ready" ? state : null;
  const [entries, setEntries] = useState<DiaryRecord[] | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const feelingBusy = useRef(false);
  const [feelingSaving, setFeelingSaving] = useState(false);
  const [removing, setRemoving] = useState<DiaryRecord | null>(null);
  // Pregnancy and diabetes change what a reading means (DESIGN.md 8.6d).
  const [context, setContext] = useState<ReadingContext>({});

  const load = useCallback(async () => {
    const [log, chats, health] = await Promise.all([
      supabase.from("health_log").select(DIARY_COLUMNS).order("logged_at", { ascending: false }).limit(200),
      supabase.from("conversations").select("title").order("updated_at", { ascending: false }).limit(6),
      supabase.from("health_profile").select("conditions, pregnancy").maybeSingle(),
    ]);
    const profile = health.data as { conditions: string[] | null; pregnancy: string | null } | null;
    setContext(readingContext(Array.isArray(profile?.conditions) ? profile.conditions : [], profile?.pregnancy));
    setEntries((log.data ?? []) as DiaryRecord[]);
    const titles = (chats.data ?? []).map((row) => displayTitle((row as { title: string | null }).title)).filter((title) => title && title !== "Untitled chat");
    setRecent([...new Set(titles)].slice(0, 4));
  }, [supabase]);

  useEffect(() => {
    if (ready && !ready.guest) void load();
    if (ready?.guest) setEntries([]);
  }, [ready?.userId, ready?.guest, load]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save(row: Record<string, unknown>): Promise<string | null> {
    const { data, error } = await supabase.from("health_log").insert(row).select(DIARY_COLUMNS);
    if (error) return /too many/i.test(error.message) ? "Your diary is full. Remove some old entries first." : "We couldn't save that. Please try again.";
    setEntries((current) => [...((data ?? []) as DiaryRecord[]), ...(current ?? [])]);
    return null;
  }

  if (!ready || entries === null) {
    return (
      <AppShell title="Health diary">
        <main id="main" className="m-auto grid w-full max-w-[640px] grid-cols-1 gap-4 px-4 py-5" aria-busy="true">
          <div className="skeleton h-36 w-full" />
          <div className="skeleton h-16 w-full" />
        </main>
      </AppShell>
    );
  }

  if (ready.guest) {
    return (
      <AppShell title="Health diary">
        <main id="main" className="m-auto grid w-full max-w-[640px] grid-cols-1 gap-4 px-4 py-5">
          <h1 className="sr-only">Health diary</h1>
          <section className="diary-hero grid gap-3">
            <p className="m-0 font-display text-[1.375rem] leading-tight font-extrabold">Keep a diary your doctor can read</p>
            <p className="m-0">Log how you feel, a temperature or a symptom. Nox uses it, and your doctor summary prints it. It&apos;s kept in your account.</p>
            <Link href="/login?next=/app/diary" className="btn btn-primary w-full">
              <BookmarkIcon /> Save my chats to start
            </Link>
          </section>
        </main>
      </AppShell>
    );
  }

  // ---- Add a reading (DESIGN.md 8.6d) ----------------------------------------------------------------
  if (adding === "reading") {
    const lastWeight = entries.find((entry) => entry.weight_kg != null && entry.weight_kg !== "")?.weight_kg;
    return (
      <AppShell title="New reading" back={{ onClick: () => router.push("/app/diary"), label: "Back to the diary" }}>
        <main id="main" className="flex min-h-full flex-col">
          <h1 className="sr-only">New reading</h1>
          <ReadingForm
            key={params.get("kind") ?? "bp"}
            lastWeight={lastWeight == null ? null : Number(lastWeight)}
            initialKind={isReadingKind(params.get("kind")) ? (params.get("kind") as ReadingKind) : "bp"}
            context={context}
            onSave={async (row) => {
              const failure = await save(row);
              if (!failure) router.push("/app/diary");
              return failure;
            }}
          />
        </main>
      </AppShell>
    );
  }

  // ---- Add details --------------------------------------------------------------------------------
  if (adding) {
    return (
      <AppShell title="New entry" back={{ onClick: () => router.push("/app/diary"), label: "Back to the diary" }}>
        <main id="main" className="flex min-h-full flex-col">
          <h1 className="sr-only">New diary entry</h1>
          <EntryForm
            suggestions={[...new Set([...recent, ...COMMON_SYMPTOMS])].slice(0, 4)}
            onSave={async (draft) => {
              const result = toDiaryRow(draft);
              if (!result.ok) return result.error;
              const failure = await save(result.row);
              if (!failure) router.push("/app/diary");
              return failure;
            }}
          />
        </main>
      </AppShell>
    );
  }

  // ---- The diary ----------------------------------------------------------------------------------
  const groups = groupByDay(entries);
  return (
    <AppShell title="Health diary">
      <main id="main" className="m-auto grid w-full max-w-[640px] grid-cols-1 gap-5 px-4 pt-3 pb-8 sm:px-6">
        <h1 className="sr-only">Health diary</h1>
        <section className="diary-hero grid grid-cols-1 gap-3" aria-labelledby="today-title">
          <p id="today-title" className="m-0 font-display text-[1.375rem] leading-tight font-extrabold">
            How are you today?
          </p>
          <div className="grid grid-cols-3 gap-2">
            {FEELINGS.map((feeling) => (
              <button
                key={feeling.value}
                type="button"
                className="btn feel-btn"
                data-tone={FEELING_TONE[feeling.value]}
                disabled={feelingSaving}
                onClick={async () => {
                  // One entry per tap: a quick double tap used to save two (bug review 2026-10-20).
                  if (feelingBusy.current) return;
                  feelingBusy.current = true;
                  setFeelingSaving(true);
                  setStatus("Saving…");
                  const failure = await save({ symptom: null, severity: null, temperature_c: null, feeling: feeling.value, note: null, conversation_id: null });
                  setStatus(failure ?? `Saved: ${feeling.label.toLowerCase()}. Add details if you like.`);
                  feelingBusy.current = false;
                  setFeelingSaving(false);
                }}
              >
                {feeling.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Link href="/app/diary?add=1" className="btn w-full" aria-label="Add details: a symptom, how bad it is, your temperature, a note">
              Add details
            </Link>
            <Link href="/app/diary?add=reading" className="btn w-full" aria-label="Add a reading: blood pressure, sugar or weight">
              Add a reading
            </Link>
          </div>
          <p className="m-0 text-[0.875rem]" role="status">
            {status ?? ""}
          </p>
        </section>

        <TrendCard entries={entries} context={context} />

        {groups.length ? (
          groups.map((group) => (
            <section key={group.label} className="grid grid-cols-1 gap-2" aria-label={group.label}>
              <h2 className="section-label">{group.label}</h2>
              <ul className="m-0 grid list-none grid-cols-1 gap-2 p-0">
                {group.items.map((entry) => {
                  const reading = readingText(entry);
                  const band = readingBand(entry, context);
                  return (
                  <li key={entry.id} className="row-card" style={{ cursor: "default" }}>
                    <span className="w-12 flex-none text-[0.875rem] font-semibold text-[var(--ink-muted)]">{timeOf(entry.logged_at)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="row-title block">{entry.symptom ?? reading ?? (entry.feeling ? "How I feel" : "Note")}</span>
                      <span className="row-sub block">
                        {[entry.symptom ? reading : null, entry.severity !== null ? `${entry.severity}/10` : null, entry.temperature_c !== null ? `${Number(entry.temperature_c)} °C` : null, entry.note].filter(Boolean).join(" · ") || " "}
                      </span>
                    </span>
                    {band ? (
                      <span className="flag-chip" data-flag={band.band}>
                        {band.label}
                      </span>
                    ) : entry.feeling ? (
                      <span className="flag-chip" data-flag={entry.feeling === "worse" ? "high" : entry.feeling === "same" ? "low" : "in_range"}>
                        {FEELINGS.find((item) => item.value === entry.feeling)?.label}
                      </span>
                    ) : null}
                    <button type="button" className="icon-ghost -mr-1" onClick={() => setRemoving(entry)} aria-label={`Remove the entry from ${group.label} at ${timeOf(entry.logged_at)}`}>
                      <CloseIcon size={16} />
                    </button>
                  </li>
                  );
                })}
              </ul>
            </section>
          ))
        ) : null}

        <MarginNote lock="Only you can see this. Nox reads the last two weeks (when your profile is on), and your doctor summary prints it.">
          {groups.length ? undefined : "Nothing logged yet. One tap above is enough to start."}
        </MarginNote>
      </main>

      <ConfirmDialog
        open={removing !== null}
        title="Remove this entry?"
        confirmLabel="Remove"
        onCancel={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return null;
          const { error } = await supabase.from("health_log").delete().eq("id", removing.id);
          if (error) return "We couldn't remove that. Please try again.";
          setEntries((current) => (current ?? []).filter((entry) => entry.id !== removing.id));
          setRemoving(null);
          return null;
        }}
      >
        <p className="m-0">It is removed from your diary and from future doctor summaries.</p>
      </ConfirmDialog>
    </AppShell>
  );
}

function EntryForm({ suggestions, onSave }: { suggestions: string[]; onSave: (draft: DiaryDraft) => Promise<string | null> }) {
  const [draft, setDraft] = useState<DiaryDraft>(emptyDraft());
  const update = (patch: Partial<DiaryDraft>) => setDraft((current) => ({ ...current, ...patch }));
  return (
    <EditorScreen intro="Log what's happening now. Skip anything." saveLabel="Save to my diary" onSave={() => onSave(draft)}>
      <div>
        <label className="field-label" htmlFor="symptom">
          What is it?
        </label>
        <input id="symptom" className="field" value={draft.symptom} maxLength={60} placeholder="For example, fever" onChange={(event) => update({ symptom: event.target.value })} />
        <div className="mt-2 flex flex-wrap gap-2">
          {suggestions.map((item) => (
            <button key={item} type="button" className="chip" aria-pressed={draft.symptom === item} onClick={() => update({ symptom: item })}>
              {item}
            </button>
          ))}
        </div>
      </div>
      <ChoiceGroup<Feeling> label="Compared with before" options={FEELINGS} value={draft.feeling} onChange={(feeling) => update({ feeling })} clearable columns={3} />
      <ChoiceGroup<string>
        label="How bad, from 0 (none) to 10 (worst)"
        options={SEVERITY}
        value={draft.severity === null ? null : String(draft.severity)}
        onChange={(value) => update({ severity: value === null ? null : Number(value) })}
        clearable
        columns={6}
      />
      <div className="flex items-center justify-between gap-3">
        <label className="field-label !mb-0" htmlFor="temperature">
          Temperature (°C)
        </label>
        <input id="temperature" className="field !w-32 flex-none" inputMode="decimal" placeholder="37.0" value={draft.temperature} onChange={(event) => update({ temperature: event.target.value })} />
      </div>
      <div>
        <label className="field-label" htmlFor="note">
          A note
        </label>
        <textarea id="note" className="field min-h-[64px] py-3" rows={2} maxLength={280} value={draft.note} placeholder="What helped, what didn't, anything new" onChange={(event) => update({ note: event.target.value })} />
      </div>
    </EditorScreen>
  );
}
