"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useAccount } from "@/lib/account/use-account";
import { buildExport, exportFileName, readAll } from "@/lib/account/export";
import { applyTextSize } from "@/lib/onboarding/apply";
import { LANGUAGES, TEXT_SIZES, type Language, type TextSize } from "@/lib/onboarding/settings";
import { AppShell } from "@/components/app/app-shell";
import { ChoiceGroup } from "@/components/onboarding/choice-group";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Toggle } from "@/components/ui/toggle";
import { Nox } from "@/components/nox";
import { BookIcon, ChevronRightIcon, DownloadIcon } from "@/components/chat/icons";
import { MarginNote } from "@/components/ui/margin-note";
import { displayName } from "@/lib/personalization/profile";
import { browserStore, forgetOpenChat } from "@/lib/chat/open-chat";
import { forgetMember } from "@/lib/supabase/ensure-session";

const CONSENT_NAMES: Record<string, string> = {
  age_18: "I'm 18 or older",
  terms: "Terms and Privacy Notice",
  ai_processing: "Messages sent to an AI service",
};

/** A Tuckii-style row: a coloured tile, a title, a quiet line and a chevron. A link, or a button for actions. */
function SettingsRow({ href, onClick, tone, icon, title, sub, danger = false }: { href?: string; onClick?: () => void; tone: string; icon: ReactNode; title: string; sub: string; danger?: boolean }) {
  const inner = (
    <>
      <span className="tile" data-tone={tone} aria-hidden="true">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`row-title block${danger ? " text-[var(--alert-text)]" : ""}`}>{title}</span>
        <span className="row-sub block">{sub}</span>
      </span>
      <ChevronRightIcon />
    </>
  );
  return href ? (
    <Link href={href} className="row-card">
      {inner}
    </Link>
  ) : (
    <button type="button" className="row-card" onClick={onClick}>
      {inner}
    </button>
  );
}

function Status({ text }: { text: string | null }) {
  return (
    <p className="m-0 text-[0.875rem] text-[var(--ink-muted)]" role="status">
      {text ?? ""}
    </p>
  );
}

// The pages inside Settings (DESIGN.md 8.3, 8.6b): the list fits one frame, and each row opens one page.
const PAGES = { display: "Language and text", delete: "Delete", help: "Terms and privacy" } as const;
type Page = keyof typeof PAGES;
const toPage = (value: string | null): Page | null => (value !== null && value in PAGES ? (value as Page) : null);

/**
 * Settings, app settings only (DESIGN.md 8.6b): account, preferences, privacy, your data, help. Health details live in
 * Personalization; Personalization and Doctor summaries are in the sidebar, so they aren't repeated here.
 */
export function SettingsApp() {
  const router = useRouter();
  const page = toPage(useSearchParams().get("page"));
  const { supabase, state, profile, consents, updateProfile } = useAccount();
  const ready = state.phase === "ready" ? state : null;
  const guest = ready?.guest ?? true;

  const [prefStatus, setPrefStatus] = useState<string | null>(null);
  const [privacyStatus, setPrivacyStatus] = useState<string | null>(null);
  const [dataStatus, setDataStatus] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"chats" | "account" | null>(null);

  async function save(patch: Parameters<typeof updateProfile>[0], setStatus: (text: string | null) => void) {
    setStatus("Saving…");
    const failure = await updateProfile(patch);
    setStatus(failure ?? "Saved");
  }

  async function exportEverything() {
    if (!ready) return;
    setDataStatus("Collecting your data…");
    try {
      // Pages are cut on a fixed order: a tie on the first column (many ticks on one day) is broken by the id, so no row
      // is skipped or repeated at a page edge (bug review 2026-10-20). water_log has one row per day, no id.
      const page = (table: string, order: string, tie: string | null = "id") => (from: number, to: number) => {
        const query = supabase.from(table).select("*").order(order, { ascending: true });
        return (tie ? query.order(tie, { ascending: true }) : query).range(from, to);
      };
      const [profileRow, healthRow, labResults, healthLog, medicineSchedule, doseLog, foodLog, waterLog, consentRows, conversations, messages, summaries, feedback] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", ready.userId).maybeSingle(),
        ready.guest ? Promise.resolve({ data: null }) : supabase.from("health_profile").select("*").eq("user_id", ready.userId).maybeSingle(),
        ready.guest ? Promise.resolve([]) : readAll(page("lab_results", "test_date")),
        ready.guest ? Promise.resolve([]) : readAll(page("health_log", "logged_at")),
        ready.guest ? Promise.resolve([]) : readAll(page("medicine_schedule", "created_at")),
        ready.guest ? Promise.resolve([]) : readAll(page("dose_log", "taken_on")),
        ready.guest ? Promise.resolve([]) : readAll(page("food_log", "day")),
        ready.guest ? Promise.resolve([]) : readAll(page("water_log", "day", null)),
        readAll(page("consents", "accepted_at")),
        readAll(page("conversations", "created_at")),
        readAll(page("messages", "created_at")),
        readAll(page("summaries", "created_at")),
        readAll(page("feedback", "created_at")),
      ]);
      const now = new Date();
      const file = buildExport(
        {
          user: { id: ready.userId, email: ready.email, guest: ready.guest },
          profile: profileRow.data,
          health_profile: healthRow.data,
          lab_results: labResults,
          health_log: healthLog,
          medicine_schedule: medicineSchedule,
          dose_log: doseLog,
          food_log: foodLog,
          water_log: waterLog,
          consents: consentRows,
          conversations,
          messages,
          summaries,
          feedback,
        },
        now,
      );
      const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = exportFileName(now);
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      setDataStatus(`Downloaded ${conversations.length} chats, ${messages.length} messages and ${summaries.length} summaries.`);
    } catch {
      setDataStatus("We couldn't collect everything. Please try again.");
    }
  }

  async function deleteAllChats(): Promise<string | null> {
    if (!ready) return "Please wait a moment and try again.";
    const { error } = await supabase.from("conversations").delete().eq("user_id", ready.userId);
    if (error) return "We couldn't delete your chats. Please try again.";
    forgetOpenChat(browserStore("session"), browserStore("local"));
    setConfirm(null);
    setDataStatus("All your chats are deleted. Saved summaries are still here.");
    return null;
  }

  async function deleteAccount(): Promise<string | null> {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return "Your session ended. Please reload the page.";
    let response: Response;
    try {
      response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/delete-account`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ confirm: "DELETE" }),
      });
    } catch {
      return "We couldn't reach the server. Nothing was deleted. Please try again.";
    }
    if (response.status !== 204) return "Something went wrong and nothing was deleted. Please try again.";
    forgetMember();
    await supabase.auth.signOut({ scope: "local" });
    forgetOpenChat(browserStore("session"), browserStore("local"));
    router.replace(`/account-deleted?at=${encodeURIComponent(new Date().toISOString())}`);
    return null;
  }

  if (!ready || !profile) {
    return (
      <AppShell title="Settings">
        <main id="main" className="m-auto grid w-full max-w-[720px] grid-cols-1 gap-4 px-4 py-6" aria-busy="true">
          <div className="skeleton h-10 w-1/2" />
          <div className="skeleton h-40 w-full" />
        </main>
      </AppShell>
    );
  }

  const language = LANGUAGES.find((option) => option.value === profile.language)?.label ?? "English";
  const size = TEXT_SIZES.find((option) => option.value === profile.text_size)?.label ?? "Medium";
  const toList = () => router.push("/app/settings");

  let body: ReactNode;
  if (page === "display") {
    body = (
      <main id="main" className="flex w-full flex-1 flex-col">
        <h1 className="sr-only">{PAGES.display}</h1>
        <div className="mx-auto w-full max-w-[640px] px-4 pt-3 sm:px-6">
          <MarginNote>Changes save as you tap.</MarginNote>
        </div>
        {/* One card per setting, its choices in one even row (founder, 2026-10-19, as on Lifestyle). */}
        <div className="m-auto grid w-full max-w-[640px] grid-cols-1 gap-4 px-4 pt-4 pb-6 sm:px-6">
          <div className="card p-4">
            <ChoiceGroup<Language>
              label="Language"
              options={LANGUAGES.map((option) => ({ value: option.value, label: option.label }))}
              value={profile.language}
              columns={2}
              onChange={(value) => value && void save({ language: value }, setPrefStatus)}
              hint="Nox replies in the language you write in; when you mix the two, in this one. Menus stay in English for now."
            />
          </div>
          <div className="card grid gap-3 p-4">
            <ChoiceGroup<TextSize>
              label="Text size"
              options={TEXT_SIZES}
              value={profile.text_size}
              columns={2}
              wideColumns={4}
              onChange={(value) => {
                if (!value) return;
                applyTextSize(value);
                void save({ text_size: value }, setPrefStatus);
              }}
            />
            {/* Every size is in rem, so this line grows and shrinks with the choice, right away. */}
            <p className="m-0 rounded-[var(--r-sm)] bg-[var(--paper-sunk)] px-3 py-2.5">
              <span className="font-bold">Preview:</span> this is how your answers will read.
            </p>
          </div>
          <Status text={prefStatus} />
        </div>
      </main>
    );
  } else if (page === "delete") {
    body = (
      <main id="main" className="flex w-full flex-1 flex-col">
        <h1 className="sr-only">{PAGES.delete}</h1>
        <div className="mx-auto w-full max-w-[640px] px-4 pt-3 sm:px-6">
          <MarginNote>Want a copy first? Use Export everything on the Settings page.</MarginNote>
        </div>
        <div className="m-auto grid w-full max-w-[640px] grid-cols-1 gap-3 px-4 pt-4 pb-6 sm:px-6">
        <SettingsRow onClick={() => setConfirm("chats")} tone="paper" icon={<span aria-hidden="true">✕</span>} title="Delete all my chats" sub="Summaries and your details stay" />
        <SettingsRow onClick={() => setConfirm("account")} tone="coral" icon={<span aria-hidden="true">!</span>} title="Delete my account" sub="Everything is removed now. It can't be undone." danger />
        <Status text={dataStatus} />
        </div>
      </main>
    );
  } else if (page === "help") {
    body = (
      <main id="main" className="m-auto grid w-full max-w-[640px] grid-cols-1 gap-3 px-4 py-5 sm:px-6">
        <h1 className="sr-only">{PAGES.help}</h1>
        <SettingsRow href="/terms" tone="paper" icon={<BookIcon size={18} />} title="Terms" sub="What this app is and isn't" />
        <SettingsRow href="/privacy" tone="paper" icon={<BookIcon size={18} />} title="Privacy Notice" sub="What we keep, and what goes to the AI service" />
        <h2 className="section-label mt-3">What you agreed to</h2>
        {consents.length ? (
          <ul className="card m-0 grid list-none gap-2 p-4">
            {consents.map((row) => (
              <li key={`${row.doc_type}-${row.version}`} className="flex flex-wrap justify-between gap-x-3 gap-y-0.5 border-b-[1px] border-[var(--hairline)] pb-2 last:border-b-0 last:pb-0">
                <span>{CONSENT_NAMES[row.doc_type] ?? row.doc_type}</span>
                <span className="text-[0.9375rem] text-[var(--ink-muted)]">
                  version {row.version} · {new Date(row.accepted_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <MarginNote>{"Nothing yet. You'll be asked before your first answer."}</MarginNote>
        )}
      </main>
    );
  } else {
    body = (
      <main id="main" className="m-auto grid w-full max-w-[640px] grid-cols-1 gap-4 px-4 pt-3 pb-5 sm:px-6">
        <h1 className="sr-only">Settings</h1>

        <section className="settings-hero" aria-labelledby="account">
          <div className="grid min-w-0 gap-1.5">
            <h2 id="account" className="section-label !px-0 !text-[var(--ink)]">
              Your account
            </h2>
            {/* The name first, the email small beneath it (founder, 2026-10-19). */}
            {displayName(profile.display_name) ? (
              <p className="m-0 truncate font-display text-[1.5rem] leading-tight font-extrabold">{displayName(profile.display_name)}</p>
            ) : guest ? (
              <p className="m-0 font-display text-[1.5rem] leading-tight font-extrabold">Guest</p>
            ) : (
              <Link href="/app/personalization?section=about" className="w-fit font-display text-[1.5rem] leading-tight font-extrabold">
                Add your name
              </Link>
            )}
            {!guest && ready.email ? <p className="-mt-1 mb-0 truncate text-[0.875rem] text-[var(--ink-muted)]">{ready.email}</p> : null}
            {guest ? (
              <>
                <p className="m-0 text-[0.9375rem]">Guest chats are removed after 30 days without use.</p>
                <Link href="/login?next=/app/settings" className="btn btn-primary w-fit">
                  Save my chats with my email
                </Link>
              </>
            ) : (
              <p className="m-0 text-[0.9375rem]">Your chats are saved to this account. Sign out from the sidebar.</p>
            )}
          </div>
          <Nox className="hidden h-24 w-20 flex-none min-[420px]:block" />
        </section>

        <section className="grid grid-cols-1 gap-2.5" aria-labelledby="preferences">
          <h2 id="preferences" className="section-label">
            Preferences
          </h2>
          <SettingsRow href="/app/settings?page=display" tone="sky" icon={<span aria-hidden="true" className="font-extrabold">Aa</span>} title={PAGES.display} sub={`${language} · ${size.toLowerCase()} text`} />
          <div className="row-card" style={{ cursor: "default" }}>
            <Toggle
              label="Save my chats"
              checked={profile.save_chats}
              onChange={(value) => void save({ save_chats: value }, setPrivacyStatus)}
              hint="Off: new chats aren't stored. Saved ones stay until you delete them."
            />
          </div>
          <Status text={privacyStatus} />
        </section>

        <section className="grid grid-cols-1 gap-2.5" aria-labelledby="data">
          <h2 id="data" className="section-label">
            Your data
          </h2>
          <SettingsRow onClick={exportEverything} tone="mint" icon={<DownloadIcon size={20} />} title="Export everything" sub="A file with all your chats, summaries and details" />
          <SettingsRow href="/app/settings?page=delete" tone="coral" icon={<span aria-hidden="true">✕</span>} title="Delete chats or account" sub="Choose what to remove" />
          <Status text={dataStatus} />
        </section>

        <section className="grid grid-cols-1 gap-2.5" aria-labelledby="help">
          <h2 id="help" className="section-label">
            Help
          </h2>
          <SettingsRow href="/app/settings?page=help" tone="paper" icon={<BookIcon size={18} />} title="Terms and privacy" sub="And what you agreed to, and when" />
        </section>
      </main>
    );
  }

  return (
    <AppShell title={page ? PAGES[page] : "Settings"} back={page ? { onClick: toList, label: "Back to Settings" } : undefined}>
      {body}

      <ConfirmDialog open={confirm === "chats"} title="Delete all your chats?" confirmLabel="Delete all chats" onCancel={() => setConfirm(null)} onConfirm={deleteAllChats}>
        <p className="m-0">Every chat and every message in your account is removed now. This can&apos;t be undone.</p>
        <p className="m-0">Your saved doctor summaries, settings and health details stay.</p>
      </ConfirmDialog>

      <ConfirmDialog open={confirm === "account"} title="Delete your account?" confirmLabel="Delete my account" requireText="DELETE" onCancel={() => setConfirm(null)} onConfirm={deleteAccount}>
        <p className="m-0">This removes your account and everything in it, now: chats, doctor summaries, settings, health details, blood results, your health diary, medicines, what you logged in Thali, feedback and the notices you accepted.</p>
        <p className="m-0">It can&apos;t be undone. Copies inside our database provider&apos;s own backups disappear when those backups expire.</p>
        <p className="m-0">Want a copy first? Use &ldquo;Export everything&rdquo;.</p>
      </ConfirmDialog>
    </AppShell>
  );
}
