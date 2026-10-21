"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { SECTION_TITLES, answerToSpeech, answerToText, mapsSearch, markerNumber, nearbyCare, shareText, usedLine } from "@/lib/chat/format";
import { friendlyError, degradedNotice } from "@/lib/chat/messages";
import type { CareLevel, Claim, ProfileUpdate, Source, Turn } from "@/lib/chat/types";
import { AlertIcon } from "@/components/nox";
import { CareBand, careLabel, SupportBand } from "./care-band";
import { CheckedSummary, LiveLine } from "./fetch-stepper";
import { ProfileProposal } from "./profile-proposal";
import { CheckIcon, CopyIcon, ExternalIcon, MapPinIcon, ShareIcon, SpeakerIcon, StopIcon, ThumbDownIcon, ThumbUpIcon } from "./icons";
import { useEmergencyNumbers } from "./use-emergency-numbers";

type Props = {
  turn: Turn;
  careBand: boolean;
  /** False when this answer's level adds nothing to the advice already shown above (lib/chat/care.ts). */
  showCare: boolean;
  /** The highest level already shown in this conversation: what still applies when this answer's strip is hidden. */
  standingLevel?: CareLevel;
  guest: boolean;
  busy: boolean;
  /** Nox asked the person something: start their answer in the message box (never sends it for them). */
  onAnswer: (question: string) => void;
  /** Accounts only: save one proposed profile addition (DESIGN.md 8.6f). Absent for guests. */
  onSaveToProfile?: (update: ProfileUpdate) => Promise<string | null>;
  onOpenSources: (sourceId: string | null) => void;
  onRetry: () => void;
  onFeedback: (messageId: string, rating: 1 | -1, reason?: string) => Promise<boolean>;
  onShowEmergency: () => void;
};

const knownIds = (ids: string[], sources: Source[]) => ids.filter((id) => sources.some((source) => source.id === id));

/**
 * Source marks like [1] open the drawer. A line with none says it is general guidance (DESIGN.md 7.4, rule 7): when the
 * whole section is uncited its heading says so once (`sectionLabelled`), otherwise the line ends with a quiet note.
 */
function Cites({ ids, sources, onOpen, quiet, sectionLabelled }: { ids: string[]; sources: Source[]; onOpen: (id: string) => void; quiet?: boolean; sectionLabelled?: boolean }) {
  const known = knownIds(ids, sources);
  if (!known.length) {
    if (quiet || sectionLabelled) return null; // supportive conversations stay quiet; a labelled section says it once
    return (
      <span className="general-note" title="This isn't from a specific source">
        general guidance
      </span>
    );
  }
  return (
    <>
      {known.map((id) => (
        <button key={id} type="button" className="marker" onClick={() => onOpen(id)} aria-label={`Source ${markerNumber(id)}: ${sources.find((s) => s.id === id)?.title ?? ""}`}>
          {markerNumber(id)}
        </button>
      ))}
    </>
  );
}

function SectionTitle({ title, allGeneral, icon }: { title: string; allGeneral: boolean; icon?: ReactNode }) {
  return (
    <h4>
      {icon}
      {title}
      {allGeneral ? <span className="general-tag">General guidance</span> : null}
    </h4>
  );
}

function ClaimList({ title, items, sources, onOpen, danger, calm }: { title: string; items: Claim[] | undefined; sources: Source[]; onOpen: (id: string) => void; danger?: boolean; calm?: boolean }) {
  if (!items?.length) return null;
  const allGeneral = !calm && items.every((item) => !knownIds(item.source_ids, sources).length);
  const list = (
    <>
      <SectionTitle title={title} allGeneral={allGeneral} icon={danger && !calm ? <AlertIcon size={18} /> : null} />
      <ul>
        {items.map((item) => (
          <li key={item.text}>
            {item.text}
            <Cites ids={item.source_ids} sources={sources} onOpen={onOpen} quiet={calm} sectionLabelled={allGeneral} />
          </li>
        ))}
      </ul>
    </>
  );
  return danger ? (
    <section className="alert-block" data-calm={calm ? "true" : "false"}>
      {list}
    </section>
  ) : (
    <section>{list}</section>
  );
}

export function AnswerCard({ turn, careBand, showCare, standingLevel, guest, busy, onAnswer, onSaveToProfile, onOpenSources, onRetry, onFeedback, onShowEmergency }: Props) {
  const { fields, sources } = turn;
  const live = turn.status === "sending" || turn.status === "streaming";
  const level = fields.care_level;
  const calm = turn.redFlag?.crisis === true; // self-harm: a supportive, calm presentation, never red
  const urgent = (level === "emergency" || level === "ambulance") && !calm;
  const numbers = useEmergencyNumbers();
  const [copied, setCopied] = useState(false);
  const [rating, setRating] = useState<1 | -1 | null>(null);
  const [reasonOpen, setReasonOpen] = useState(false);
  const [feedbackNote, setFeedbackNote] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const canSpeak = typeof window !== "undefined" && "speechSynthesis" in window;

  // Stop reading aloud when the answer goes away (a new chat, another page). Only then: when this answer simply
  // finished, cancelling would also stop another answer that just started reading (bug review 2026-10-20).
  const speakingRef = useRef(false);
  speakingRef.current = speaking;
  useEffect(
    () => () => {
      if (speakingRef.current) window.speechSynthesis?.cancel();
    },
    [],
  );

  /** Listen (DESIGN.md 8.6c): the phone's own voice; nothing is sent anywhere. Tap again to stop. */
  function listen() {
    const synth = window.speechSynthesis;
    if (speaking) {
      synth.cancel();
      setSpeaking(false);
      return;
    }
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(answerToSpeech(fields));
    utterance.lang = fields.language === "hi" ? "hi-IN" : "en-IN";
    utterance.rate = 0.95;
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    synth.speak(utterance);
    setSpeaking(true);
  }

  /** Share (DESIGN.md 8.6c): the phone's share sheet (WhatsApp, SMS…), or WhatsApp on the web where there is none. */
  async function share() {
    const text = shareText(fields, sources);
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: fields.headline ?? "Hale", text });
      } catch {
        // the person closed the sheet
      }
      return;
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  }

  const hasAnswer = Boolean(fields.headline || fields.summary);
  const refusal = turn.status === "error" && !hasAnswer;
  const notice = turn.done ? degradedNotice(turn.done.degraded_reason) : null;
  const friendly = turn.error ? friendlyError(turn.error, guest) : null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(answerToText(fields, sources));
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setFeedbackNote("Couldn't copy. Select the text instead.");
    }
  }

  async function rate(value: 1 | -1, reason?: string) {
    if (!turn.messageId) return;
    setRating(value);
    setReasonOpen(value === -1 && !reason);
    const ok = await onFeedback(turn.messageId, value, reason);
    setFeedbackNote(ok ? (value === 1 ? "Thanks, that helps." : reason ? "Thanks for telling us." : null) : "We couldn't save that just now.");
  }

  // A refusal before any answer: a calm card, not an answer card.
  if (refusal && friendly) {
    return (
      <div className={friendly.tone === "calm" ? "calm-card" : "error-card"} role="alert">
        <p className="m-0 font-bold">{friendly.title}</p>
        <p className="mt-1 mb-0">{friendly.body}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {friendly.canRetry ? (
            <button type="button" className="btn btn-primary" onClick={onRetry} disabled={busy}>
              Try again
            </button>
          ) : null}
          {turn.error?.code === "quota_exceeded" && guest ? (
            <Link className="btn" href="/login?next=/app">
              Log in with email
            </Link>
          ) : null}
          <Link className="btn" href="/emergency">
            Emergency numbers
          </Link>
        </div>
      </div>
    );
  }

  return (
    <article className="answer" aria-label="Answer" aria-busy={live}>
      {calm ? (
        <SupportBand reason={fields.care_reason} />
      ) : careBand && level ? (
        showCare ? (
          <CareBand level={level} reason={fields.care_reason} />
        ) : (
          // Nothing new to show; a screen reader still hears the advice that stands.
          <p className="sr-only">Care advice above still applies: {careLabel(standingLevel ?? level)}.</p>
        )
      ) : null}

      <div className="answer-body">
        {notice ? (
          <div className="banner" role="status">
            {notice}
          </div>
        ) : null}

        {live ? (
          <div role="status" aria-live="polite">
            <LiveLine turn={turn} />
          </div>
        ) : null}

        {live && !hasAnswer ? (
          <div className="grid gap-2.5" aria-hidden="true">
            <div className="skeleton h-5 w-4/5" />
            <div className="skeleton h-3.5 w-full" />
            <div className="skeleton h-3.5 w-11/12" />
          </div>
        ) : null}

        {fields.headline ? <h3 className="m-0">{fields.headline}</h3> : null}
        {fields.summary ? <p className="m-0">{fields.summary}</p> : null}

        {urgent && !live ? (
          <div className="flex flex-wrap gap-2">
            <a className="btn btn-primary" href={`tel:${numbers.primary.number}`}>
              {numbers.primary.label}
            </a>
            <button type="button" className="btn" onClick={onShowEmergency}>
              Emergency numbers
            </button>
            <a className="btn" href={mapsSearch("hospital emergency near me")} target="_blank" rel="noopener noreferrer">
              <MapPinIcon /> Nearest hospital
            </a>
          </div>
        ) : null}

        {calm && !live ? (
          <div className="flex flex-wrap gap-2">
            {numbers.region === "IN" ? (
              <a className="btn btn-primary" href="tel:14416">
                Call Tele-MANAS 14416
              </a>
            ) : null}
            <a className="btn" href={`tel:${numbers.primary.number}`}>
              {numbers.primary.label} if you&apos;re in danger
            </a>
          </div>
        ) : null}

        <ClaimList title={SECTION_TITLES.likely_causes} items={fields.likely_causes} sources={sources} onOpen={onOpenSources} calm={calm} />
        <ClaimList title={calm ? "Some gentle steps" : SECTION_TITLES.try_tonight} items={fields.try_tonight} sources={sources} onOpen={onOpenSources} calm={calm} />
        <ClaimList title={SECTION_TITLES.see_doctor_if} items={fields.see_doctor_if} sources={sources} onOpen={onOpenSources} calm={calm} />
        <ClaimList title={calm ? "If you're in immediate danger" : SECTION_TITLES.emergency_if} items={fields.emergency_if} sources={sources} onOpen={onOpenSources} danger calm={calm} />

        {fields.medicines?.length ? (
          <section>
            <SectionTitle
              title={fields.medicines.every((medicine) => medicine.kind === "otc") ? "Medicines you can buy" : SECTION_TITLES.medicines}
              allGeneral={fields.medicines.every((medicine) => !knownIds(medicine.source_ids, sources).length)}
            />
            <ul>
              {fields.medicines.map((medicine) => (
                <li key={medicine.name}>
                  <strong>{medicine.name}.</strong> {medicine.kind === "otc" ? <span className="otc-tag">No prescription needed</span> : null} {medicine.note}
                  <Cites ids={medicine.source_ids} sources={sources} onOpen={onOpenSources} sectionLabelled={fields.medicines!.every((m) => !knownIds(m.source_ids, sources).length)} />
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {!live && !urgent && !calm && level ? (
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {nearbyCare(level, (fields.medicines ?? []).some((medicine) => medicine.kind === "otc")).map((place) => (
              <a key={place.query} className="near-link" href={mapsSearch(place.query)} target="_blank" rel="noopener noreferrer">
                <MapPinIcon /> {place.label}
              </a>
            ))}
          </div>
        ) : null}

        {fields.questions_for_you?.length && !live ? (
          // Nox's questions for the person (founder, 2026-10-19: tapping one used to SEND it, as if they had asked it).
          // Now a tap only starts their answer in the message box; they type it and send it themselves.
          <section aria-labelledby={`ask-${turn.id}`}>
            <h4 id={`ask-${turn.id}`}>To help me, tell me</h4>
            <ol className="ask-list">
              {fields.questions_for_you.map((question) => (
                <li key={question}>
                  <button type="button" className="ask-row" disabled={busy} onClick={() => onAnswer(question)} aria-label={`Answer: ${question}`}>
                    <span className="min-w-0 flex-1">{question}</span>
                    <span className="ask-cta" aria-hidden="true">
                      Answer
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        {onSaveToProfile && fields.profile_updates?.length && !live && turn.done && !turn.done.replayed ? (
          // Only on an answer given just now: a reloaded chat doesn't ask again.
          <ProfileProposal updates={fields.profile_updates} onSave={onSaveToProfile} />
        ) : null}

        {fields.unknowns ? (
          <p className="m-0 text-[0.9062rem] text-[var(--ink-muted)]">
            <strong className="font-semibold">What I couldn&apos;t know: </strong>
            {fields.unknowns}
          </p>
        ) : null}

        {fields.questions_for_doctor?.length ? (
          <details>
            <summary className="cursor-pointer select-none font-semibold">Questions to ask your doctor</summary>
            <ul className="mt-2">
              {fields.questions_for_doctor.map((question) => (
                <li key={question}>{question}</li>
              ))}
            </ul>
          </details>
        ) : null}

        {turn.sourcesArrived && sources.length ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {sources.map((source) => (
              <a key={source.id} className="src-chip" href={source.url} target="_blank" rel="noopener noreferrer">
                <span className="src-num" aria-hidden="true">
                  {markerNumber(source.id)}
                </span>
                <span className="truncate">{source.title}</span>
                <ExternalIcon size={12} />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            ))}
            {!live ? (
              <button type="button" className="text-link" onClick={() => onOpenSources(null)}>
                Why this answer?
              </button>
            ) : null}
          </div>
        ) : null}

        {turn.status === "stopped" ? (
          <div className="calm-card" role="status">
            <p className="m-0 font-bold">Stopped</p>
            <p className="mt-1 mb-0">Your message is kept. You can ask again; if the answer was already written, it will appear straight away.</p>
            <button type="button" className="btn mt-3" onClick={onRetry} disabled={busy}>
              Ask again
            </button>
          </div>
        ) : null}

        {turn.status === "error" && friendly ? (
          <div className="error-card" role="alert">
            <p className="m-0 font-bold">{friendly.title}</p>
            <p className="mt-1 mb-0">{friendly.body}</p>
            {friendly.canRetry ? (
              <button type="button" className="btn btn-primary mt-3" onClick={onRetry} disabled={busy}>
                Try again
              </button>
            ) : null}
          </div>
        ) : null}

        {turn.status === "done" && !turn.messageId ? <CheckedSummary turn={turn} /> : null}

        {turn.status === "done" && turn.messageId ? (
          <div className="grid gap-2">
            {usedLine(turn.done?.used) ? <p className="used-line">{usedLine(turn.done?.used)}</p> : null}
            <div className="answer-actions">
              <button type="button" className="icon-ghost" onClick={copy} aria-label={copied ? "Copied" : "Copy the answer"} title={copied ? "Copied" : "Copy"}>
                {copied ? <CheckIcon /> : <CopyIcon size={18} />}
              </button>
              {canSpeak ? (
                <button type="button" className="icon-ghost" onClick={listen} aria-pressed={speaking} aria-label={speaking ? "Stop reading aloud" : "Listen"} title={speaking ? "Stop" : "Listen"}>
                  {speaking ? <StopIcon /> : <SpeakerIcon />}
                </button>
              ) : null}
              <button type="button" className="icon-ghost" onClick={share} aria-label="Share with family" title="Share">
                <ShareIcon />
              </button>
              {/* Feedback is kept with a saved answer; an unsaved one has nothing to attach it to (bug review 2026-10-20). */}
              {turn.done?.saved !== false ? (
                <>
                  <button type="button" className="icon-ghost" aria-pressed={rating === 1} onClick={() => rate(1)} aria-label="Helpful" title="Helpful">
                    <ThumbUpIcon size={18} />
                  </button>
                  <button type="button" className="icon-ghost" aria-pressed={rating === -1} onClick={() => rate(-1)} aria-label="Not helpful" title="Not helpful">
                    <ThumbDownIcon size={18} />
                  </button>
                </>
              ) : null}
              <CheckedSummary turn={turn} />
            </div>
            {reasonOpen ? (
              <div className="flex flex-wrap gap-2" role="group" aria-label="What went wrong?">
                {([["wrong", "It was wrong"], ["unclear", "Unclear"], ["too_scary", "Too scary"], ["too_vague", "Too vague"], ["other", "Something else"]] as const).map(([value, label]) => (
                  <button key={value} type="button" className="chip" onClick={() => rate(-1, value)}>
                    {label}
                  </button>
                ))}
              </div>
            ) : null}
            {feedbackNote ? (
              <p className="m-0 text-[0.8125rem] text-[var(--ink-muted)]" role="status">
                {feedbackNote}
              </p>
            ) : (
              <p className="sr-only" role="status" />
            )}
          </div>
        ) : null}
      </div>
    </article>
  );
}
