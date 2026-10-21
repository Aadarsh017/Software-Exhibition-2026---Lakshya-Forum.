"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { LogoMark } from "@/components/nox";
import { CareBand } from "@/components/chat/care-band";
import { ConsentCard } from "@/components/chat/consent-card";
import type { Profile } from "@/lib/chat/use-chat";
import {
  emptyHealth,
  hasAnyHealthAnswer,
  LANGUAGES,
  TEXT_SIZES,
  type HealthDraft,
  type Language,
  type TextSize,
} from "@/lib/onboarding/settings";
import { ChoiceGroup } from "./choice-group";
import { HealthFields } from "./health-fields";
import { MarginNote } from "@/components/ui/margin-note";

export type OnboardingProps = {
  guest: boolean;
  needsConsent: boolean;
  /** Opened again from "Settings": no first-time wording, and it ends with Back to chat. */
  settingsMode: boolean;
  profile: Profile;
  onAcceptConsents: () => Promise<string | null>;
  onSaveSettings: (patch: Partial<Pick<Profile, "display_name" | "language" | "text_size" | "use_profile_in_answers">>) => Promise<string | null>;
  onLoadHealth: () => Promise<HealthDraft | null>;
  onSaveHealth: (draft: HealthDraft) => Promise<string | null>;
  onFinish: () => Promise<string | null>;
  onClose: () => void;
  applyTextSize: (size: TextSize) => void;
};

function Frame({ step, title, intro, children }: { step: 1 | 2 | 3; title: string; intro?: string; children: ReactNode }) {
  return (
    <section className="card grid gap-5 p-5 sm:p-7" aria-labelledby="onboarding-title">
      <div className="grid gap-1.5">
        <p className="m-0 flex items-center gap-3 text-[0.9375rem] font-semibold text-[var(--ink-muted)]">
          Step {step} of 3
          <span className="step-dots" aria-hidden="true">
            {[1, 2, 3].map((n) => (
              <i key={n} className={n <= step ? "on" : ""} />
            ))}
          </span>
        </p>
        <h1 id="onboarding-title" className="text-[clamp(1.75rem,1.4rem+1.4vw,2.25rem)] leading-tight">
          {title}
        </h1>
        {intro ? <MarginNote>{intro}</MarginNote> : null}
      </div>
      {children}
    </section>
  );
}

const errorBox = (message: string | null) =>
  message ? (
    <p role="alert" className="error-card m-0">
      {message}
    </p>
  ) : null;

export function Onboarding(props: OnboardingProps) {
  const { guest, needsConsent, settingsMode, profile } = props;
  const [step, setStep] = useState<1 | 2 | 3>(needsConsent && !settingsMode ? 1 : 2);

  return (
    <main id="main" className="app-frame">
      <div className="mx-auto flex w-full max-w-[var(--w-wide)] flex-none items-center justify-between gap-3 px-4 py-3 sm:px-8">
        <Link href="/" className="flex items-center gap-2 whitespace-nowrap font-display text-[1.0625rem] font-extrabold tracking-tight no-underline sm:text-[1.3125rem]">
          <LogoMark size={28} />
          <span>hale</span>
        </Link>
      </div>

      <div className="app-scroll">
      <div className="m-auto grid w-full max-w-[640px] grid-cols-1 gap-4 px-4 pb-6 pt-2 sm:px-6">
        {step === 1 ? (
          <Frame step={1} title="Before we start" intro="Three quick things, so you know how this works.">
            <ConsentCard
              bare
              onAccept={async () => {
                const failure = await props.onAcceptConsents();
                if (!failure) setStep(2);
                return failure;
              }}
            />
          </Frame>
        ) : null}

        {step === 2 ? <PreferencesStep {...props} profile={profile} onNext={() => setStep(3)} /> : null}
        {step === 3 ? <HealthStep {...props} guest={guest} onBack={() => setStep(2)} /> : null}
        <p className="m-0 text-center text-[0.8125rem] text-[var(--ink-muted)]">
          In an emergency, call 112. <Link href="/emergency">Emergency numbers</Link>
        </p>
      </div>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Step 2: make it yours
// ---------------------------------------------------------------------------
function PreferencesStep({ profile, settingsMode, onSaveSettings, applyTextSize, onNext, onClose }: OnboardingProps & { onNext: () => void }) {
  const [name, setName] = useState(profile.display_name ?? "");
  const [language, setLanguage] = useState<Language>(profile.language);
  const [size, setSize] = useState<TextSize>(profile.text_size);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function next() {
    setBusy(true);
    setError(null);
    const failure = await onSaveSettings({ display_name: name.replace(/\s+/g, " ").trim().slice(0, 80) || null, language, text_size: size });
    setBusy(false);
    if (failure) {
      setError(failure);
      return;
    }
    onNext();
  }

  return (
    <Frame step={2} title="Make it yours" intro="Change these any time. The text size applies straight away, so you can see it.">
      <div>
        <label className="field-label" htmlFor="onboarding-name">
          What should Nox call you? <span className="font-normal text-[var(--ink-muted)]">(optional)</span>
        </label>
        <input id="onboarding-name" className="field" value={name} maxLength={80} autoComplete="given-name" placeholder="Your first name" onChange={(event) => setName(event.target.value)} />
        <p className="mt-1.5 mb-0 text-[0.8125rem] text-[var(--ink-muted)]">Nox greets you by it. It never goes to the AI service.</p>
      </div>
      <ChoiceGroup<Language>
        label="Language"
        options={LANGUAGES.map((option) => ({ value: option.value, label: option.label }))}
        value={language}
        columns={2}
        onChange={(value) => value && setLanguage(value)}
        hint="I answer in the language you write in. If you mix Hindi and English, I'll use this one. The buttons and menus are in English for now."
      />
      <ChoiceGroup<TextSize>
        label="Text size"
        options={TEXT_SIZES}
        value={size}
        columns={2}
        wideColumns={4}
        onChange={(value) => {
          if (!value) return;
          setSize(value);
          applyTextSize(value);
        }}
      />
      <div className="grid gap-2" aria-label="Preview">
        <p className="m-0 font-bold">Preview</p>
        <div className="answer">
          <CareBand level="doctor" reason="An example of how I show how urgent something is." />
          <div className="answer-body">
            <p className="m-0 font-display text-[1.25rem] font-extrabold leading-snug">This is how an answer will read.</p>
            <p className="m-0">Short sentences, plain words, and the next step first.</p>
          </div>
        </div>
      </div>

      {errorBox(error)}
      <div className="sticky bottom-0 z-[1] -mx-5 -mb-5 flex flex-wrap items-center justify-between gap-3 rounded-b-[var(--r-md)] border-t border-[var(--hairline)] bg-[var(--card)] px-5 py-3 sm:-mx-7 sm:-mb-7 sm:px-7 sm:py-4">
        {settingsMode ? (
          <button type="button" className="btn" onClick={onClose}>
            Back to chat
          </button>
        ) : (
          <button type="button" className="btn" disabled>
            Back
          </button>
        )}
        <button type="button" className="btn btn-primary btn-lg" onClick={next} disabled={busy}>
          {busy ? "Saving…" : "Next"}
        </button>
      </div>
    </Frame>
  );
}

// ---------------------------------------------------------------------------
// Step 3: help me tailor answers (optional)
// ---------------------------------------------------------------------------
function HealthStep({ guest, settingsMode, profile, onLoadHealth, onSaveHealth, onSaveSettings, onFinish, onClose, onBack }: OnboardingProps & { onBack: () => void }) {
  const [draft, setDraft] = useState<HealthDraft>(emptyHealth());
  const [useInAnswers, setUseInAnswers] = useState(profile.use_profile_in_answers);
  const [existing, setExisting] = useState(false);
  // The saved details couldn't be read: saving would write this empty form over them (bug review 2026-10-20).
  const [unread, setUnread] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (guest) return;
    let cancelled = false;
    onLoadHealth()
      .then((row) => {
        if (cancelled || !row) return;
        setDraft({ ...emptyHealth(), ...row, conditions: row.conditions ?? [], allergies: row.allergies ?? [], medicines: row.medicines ?? [] });
        setExisting(true);
      })
      .catch(() => {
        if (!cancelled) setUnread(true);
      });
    return () => {
      cancelled = true;
    };
    // The loader is stable for the life of the page; load once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guest]);

  async function finish(save: boolean) {
    setBusy(true);
    setError(null);
    if (save && !guest) {
      if (unread) {
        setBusy(false);
        setError("We couldn't load your saved details, so saving now could erase them. Skip this step, or reload and try again.");
        return;
      }
      if (hasAnyHealthAnswer(draft) || existing) {
        const failure = await onSaveHealth(draft);
        if (failure) {
          setBusy(false);
          setError(failure);
          return;
        }
      }
      if (useInAnswers !== profile.use_profile_in_answers) {
        const failure = await onSaveSettings({ use_profile_in_answers: useInAnswers });
        if (failure) {
          setBusy(false);
          setError(failure);
          return;
        }
      }
    }
    const failure = await onFinish();
    setBusy(false);
    if (failure) setError(failure);
    else if (settingsMode) onClose();
  }

  const nav = (
    <div className="sticky bottom-0 z-[1] -mx-5 -mb-5 flex flex-wrap items-center justify-between gap-3 rounded-b-[var(--r-md)] border-t border-[var(--hairline)] bg-[var(--card)] px-5 py-3 sm:-mx-7 sm:-mb-7 sm:px-7 sm:py-4">
      <button type="button" className="btn" onClick={onBack} disabled={busy}>
        Back
      </button>
      <div className="flex flex-wrap gap-3">
        <button type="button" className="btn btn-lg" onClick={() => finish(false)} disabled={busy}>
          {settingsMode ? "Close without saving" : "Skip for now"}
        </button>
        {guest ? null : (
          <button type="button" className="btn btn-primary btn-lg" onClick={() => finish(true)} disabled={busy}>
            {busy ? "Saving…" : settingsMode ? "Save" : "Save and finish"}
          </button>
        )}
      </div>
    </div>
  );

  if (guest) {
    return (
      <Frame step={3} title="Help me tailor answers" intro="Optional. Your age, conditions, allergies and medicines help me point out when they matter.">
        <div className="banner grid gap-2">
          <p className="m-0 font-semibold">These are saved to an account, not to a guest session.</p>
          <p className="m-0">Log in with your email and your chats come with you. You can add your details then.</p>
          <Link href="/login?next=/app" className="btn btn-primary w-fit">
            Log in to add them
          </Link>
        </div>
        {errorBox(error)}
        {nav}
      </Frame>
    );
  }

  return (
    <Frame step={3} title="Help me tailor answers" intro="Optional. Skip anything you like.">
      <HealthFields draft={draft} onChange={setDraft} useInAnswers={useInAnswers} onUseInAnswers={setUseInAnswers} />
      {errorBox(error)}
      {nav}
    </Frame>
  );
}
