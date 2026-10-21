"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useAccount } from "@/lib/account/use-account";
import { aboutYouSummary, cardSummary, completeness, emptyPersonal, firstName, fromRow, healthSummary, lifestyleSummary, toPersonalRow, type PersonalDraft } from "@/lib/personalization/profile";
import { bloodSummary, type LabRecord } from "@/lib/personalization/labs";
import { planSave, SCHEDULE_COLUMNS, toSchedule, type Schedule, type TimesDraft } from "@/lib/medicines/today";
import { AppShell } from "@/components/app/app-shell";
import { Toggle } from "@/components/ui/toggle";
import { Nox } from "@/components/nox";
import { BookmarkIcon, ChevronRightIcon, DropIcon, HeartIcon, LeafIcon, PersonIcon } from "@/components/chat/icons";
import { AboutYouEditor, EmergencyCardEditor, HealthHistoryEditor, isListField, LifestyleEditor } from "./editors";
import { AlertIcon } from "@/components/nox";
import { BloodReport } from "./blood-report";
import { MarginNote } from "@/components/ui/margin-note";

// One row per topic, and each row's screen holds every field of that topic (DESIGN.md 8.6b).
const SECTIONS = {
  about: "About you",
  health: "Health history",
  lifestyle: "Lifestyle",
  blood: "Blood report",
  card: "Emergency card",
} as const;
type Section = keyof typeof SECTIONS;
// Older links pointed at one field; they open the screen that holds it now.
const MOVED: Record<string, Section> = { name: "about", body: "about", conditions: "health", allergies: "health", medicines: "health", family: "health" };
const toSection = (value: string | null): Section | null => (value === null ? null : value in SECTIONS ? (value as Section) : (MOVED[value] ?? null));

type Tone = "coral" | "lilac" | "mint" | "butter" | "sky" | "grape" | "paper";

function Row({ section, tone, icon, sub, ring = false }: { section: Section; tone: Tone; icon: ReactNode; sub: string; ring?: boolean }) {
  return (
    <Link href={`/app/personalization?section=${section}`} className="row-card" data-ring={ring ? "true" : "false"}>
      <span className="tile" data-tone={tone} aria-hidden="true">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="row-title block">{SECTIONS[section]}</span>
        <span className="row-sub block truncate">{sub}</span>
      </span>
      <ChevronRightIcon />
    </Link>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="grid grid-cols-1 gap-2.5" aria-label={label}>
      <h2 className="section-label">{label}</h2>
      {children}
    </section>
  );
}

/**
 * Personalization (DESIGN.md 8.6b): everything a personal doctor needs to know, one topic per screen, mobile first.
 * Health details and blood results are for accounts only (the database refuses guests); a guest can set a name.
 */
export function PersonalizationApp() {
  const router = useRouter();
  const params = useSearchParams();
  const requested = params.get("section");
  const { supabase, state, profile, updateProfile } = useAccount();
  const ready = state.phase === "ready" ? state : null;
  const [draft, setDraft] = useState<PersonalDraft | null>(null);
  const [labs, setLabs] = useState<LabRecord[]>([]);
  // When each regular medicine is taken (DESIGN.md 8.6e).
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  // The saved health details couldn't be read. Saving now would write the empty form over them (bug review
  // 2026-10-20), so every save waits for a good load.
  const [healthUnread, setHealthUnread] = useState(false);

  const loadSchedules = useCallback(async () => {
    const { data, error } = await supabase.from("medicine_schedule").select(SCHEDULE_COLUMNS).limit(50);
    if (!error) setSchedules(((data ?? []) as Record<string, unknown>[]).map(toSchedule).filter((row): row is Schedule => row !== null));
    return error;
  }, [supabase]);

  const loadMember = useCallback(async (userId: string) => {
    const [health, results, times] = await Promise.all([
      supabase.from("health_profile").select("*").eq("user_id", userId).maybeSingle(),
      supabase.from("lab_results").select("id, marker, label, value, unit, test_date").order("test_date", { ascending: false }).order("created_at", { ascending: false }).limit(300),
      loadSchedules(),
    ]);
    if (health.error || results.error || times) setLoadError("We couldn't load everything. Pull down or reload to try again.");
    setHealthUnread(Boolean(health.error));
    setDraft(fromRow((health.data as Record<string, unknown> | null) ?? null));
    setLabs((results.data ?? []) as LabRecord[]);
  }, [supabase, loadSchedules]);

  useEffect(() => {
    if (!ready) return;
    if (ready.guest) setDraft(emptyPersonal());
    else void loadMember(ready.userId);
  }, [ready?.userId, ready?.guest, loadMember]); // eslint-disable-line react-hooks/exhaustive-deps

  const toList = () => router.push("/app/personalization");

  const persist = async (patch: Partial<PersonalDraft>): Promise<string | null> => {
    if (!ready || ready.guest || !draft) return "Health details need an account. Save your chats first.";
    if (healthUnread) return "We couldn't load your saved details, so saving now could erase them. Please reload the page and try again.";
    const next = { ...draft, ...patch };
    const { error } = await supabase.from("health_profile").upsert({ user_id: ready.userId, ...toPersonalRow(next) }, { onConflict: "user_id" });
    if (error) return "We couldn't save that. Please try again.";
    // Show exactly what was saved (bug review 2026-10-20): the checked values, e.g. no "pregnant" next to "male".
    setDraft(fromRow(toPersonalRow(next)));
    return null;
  };
  const saveDraft = async (patch: Partial<PersonalDraft>): Promise<string | null> => {
    const failure = await persist(patch);
    if (!failure) toList();
    return failure;
  };
  // Health history: the names on the profile, then their times (DESIGN.md 8.6e). Medicines gone from the list, or left
  // with no time, lose their times and ticks.
  const saveHealth = async (patch: Partial<PersonalDraft>, times: TimesDraft): Promise<string | null> => {
    if (!ready || ready.guest) return "Health details need an account. Save your chats first.";
    const plan = planSave(patch.medicines ?? draft?.medicines ?? [], times, schedules);
    if (!plan.ok) return plan.error;
    const failure = await persist(patch);
    if (failure) return failure;
    const steps = [
      plan.remove.length ? supabase.from("medicine_schedule").delete().in("id", plan.remove) : null,
      // Two groups, so a row without a new pill count doesn't send one (it would undo ticks made meanwhile).
      ...[plan.rows.filter((row) => "pills_left" in row), plan.rows.filter((row) => !("pills_left" in row))]
        .filter((rows) => rows.length)
        .map((rows) => supabase.from("medicine_schedule").upsert(rows.map((row) => ({ user_id: ready.userId, ...row })), { onConflict: "user_id,medicine_key" })),
    ];
    for (const step of steps) {
      if (!step) continue;
      const { error } = await step;
      if (error) return /too many/i.test(error.message) ? "That's more medicines than we keep times for (50)." : "Your list is saved, but we couldn't save the times. Please try again.";
    }
    await loadSchedules();
    toList();
    return null;
  };

  if (!ready || !profile || !draft) {
    return (
      <AppShell title="Personalization">
        <main id="main" className="m-auto grid w-full max-w-[640px] grid-cols-1 gap-4 px-4 py-5" aria-busy="true">
          <div className="skeleton h-32 w-full" />
          <div className="skeleton h-16 w-full" />
          <div className="skeleton h-16 w-full" />
        </main>
      </AppShell>
    );
  }

  const member = !ready.guest;
  const wanted = toSection(requested);
  const section = wanted && (member || wanted === "about") ? wanted : null;

  // ---- One topic ------------------------------------------------------------------------------------
  if (section) {
    const back = { onClick: toList, label: "Back to Personalization" };
    let body: ReactNode;
    if (section === "about") {
      body = (
        <AboutYouEditor
          name={profile.display_name}
          draft={draft}
          member={member}
          onSave={async (name, patch) => {
            // The name lives on the account, the rest on the health profile: one Save, and the screen stays on a failure.
            if (patch) {
              const failure = await persist(patch);
              if (failure) return failure;
            }
            if (name !== (profile.display_name ?? null)) {
              const failure = await updateProfile({ display_name: name });
              if (failure) return failure;
            }
            toList();
            return null;
          }}
        />
      );
    } else if (section === "health") {
      const line = params.get("open");
      body = <HealthHistoryEditor draft={draft} schedules={schedules} initialOpen={isListField(line) ? line : null} onSave={saveHealth} />;
    }
    else if (section === "lifestyle") body = <LifestyleEditor draft={draft} onSave={saveDraft} />;
    else if (section === "card") body = <EmergencyCardEditor draft={draft} name={profile.display_name} onSave={saveDraft} />;
    else if (section === "blood") {
      body = (
        <BloodReport
          labs={labs}
          sex={draft.sex_at_birth}
          onAdd={async (rows) => {
            const { data, error } = await supabase.from("lab_results").insert(rows).select("id, marker, label, value, unit, test_date");
            if (error) return /too many/i.test(error.message) ? "You've saved the most values we keep. Remove some old ones first." : "We couldn't save that report. Please try again.";
            setLabs((current) => [...((data ?? []) as LabRecord[]), ...current]);
            return null;
          }}
          onDelete={async (id) => {
            const { error } = await supabase.from("lab_results").delete().eq("id", id);
            if (error) return "We couldn't remove that. Please try again.";
            setLabs((current) => current.filter((row) => row.id !== id));
            return null;
          }}
        />
      );
    }
    return (
      <AppShell title={SECTIONS[section]} back={back}>
        <main id="main" className="flex min-h-full flex-col">
          <h1 className="sr-only">{SECTIONS[section]}</h1>
          {body}
        </main>
      </AppShell>
    );
  }

  // ---- The list -------------------------------------------------------------------------------------
  const progress = completeness(profile.display_name, draft, labs.length);
  const called = firstName(profile.display_name);
  return (
    <AppShell title="Personalization">
      <main id="main" className="m-auto grid w-full max-w-[640px] grid-cols-1 gap-3.5 px-4 py-2 sm:px-6">
        <h1 className="sr-only">Personalization</h1>

        <section className="person-hero" aria-labelledby="hero-title">
          <div className="grid min-w-0 grid-cols-1 gap-2">
            <p className="section-label !px-0 !text-[var(--on-block)]">Your health profile</p>
            <h2 id="hero-title" className="m-0 font-display text-[1.375rem] leading-tight font-extrabold">
              {called ? `${called}, help Nox know you` : "Help Nox know you"}
            </h2>
            {member ? (
              <p className="m-0 flex items-center gap-2 text-[0.875rem] font-semibold">
                <span className="progress" aria-hidden="true">
                  <i style={{ width: `${(progress.done / progress.total) * 100}%` }} />
                </span>
                {progress.done} of {progress.total} done
              </p>
            ) : null}
          </div>
          <Nox className="hidden h-24 w-20 flex-none min-[400px]:block" />
        </section>

        {loadError ? (
          <p className="error-card m-0" role="alert">
            {loadError}
          </p>
        ) : null}

        {member ? (
          <div className="row-card" style={{ cursor: "default" }}>
            <Toggle
              label="Use my profile in answers"
              hint="Off: Nox answers without your details."
              checked={profile.use_profile_in_answers}
              onChange={(value) => void updateProfile({ use_profile_in_answers: value })}
            />
          </div>
        ) : null}

        <Group label="Your profile">
          <Row
            section="about"
            tone="lilac"
            icon={<PersonIcon />}
            sub={member ? aboutYouSummary(profile.display_name, draft) : called ? `Nox calls you ${called}` : "Add the name Nox should use"}
            ring={!called}
          />
          {member ? (
            <>
              <Row section="health" tone="coral" icon={<HeartIcon size={20} />} sub={healthSummary(draft)} />
              <Row section="lifestyle" tone="mint" icon={<LeafIcon />} sub={lifestyleSummary(draft, "Smoking, alcohol, activity")} />
            </>
          ) : null}
        </Group>

        {member ? (
          <Group label="Your records">
            <Row section="blood" tone="sky" icon={<DropIcon />} sub={bloodSummary(labs, draft.sex_at_birth)} ring={labs.length === 0} />
            <Row section="card" tone="butter" icon={<AlertIcon size={18} />} sub={cardSummary(draft)} ring={!draft.emergency_contact_phone} />
          </Group>
        ) : (
          <section className="row-card grid gap-3" style={{ cursor: "default", display: "grid" }} aria-label="Save your chats first">
            <p className="m-0 font-semibold">Health details and blood reports need an account</p>
            <p className="m-0 text-[0.9375rem] text-[var(--ink-muted)]">Add your email (no password). Your chats come with you, and your health profile is kept safely in your account.</p>
            <Link href="/login?next=/app/personalization" className="btn btn-primary w-full">
              <BookmarkIcon /> Save my chats
            </Link>
          </section>
        )}

        <MarginNote lock="Only you can see this. Your name never goes to the AI service." />
      </main>
    </AppShell>
  );
}
