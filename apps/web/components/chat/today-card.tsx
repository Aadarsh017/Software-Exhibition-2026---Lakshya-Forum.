"use client";

import Link from "next/link";
import { useState } from "react";
import { MISSED_DOSE_LINE, SLOTS, type DueDose } from "@/lib/medicines/today";
import { CheckIcon, ChevronRightIcon, CloseIcon, DropIcon, HeartIcon, PillIcon } from "./icons";

/** What the home screen's one "Today" card holds (DESIGN.md 8.6e): the medicines due now and today's reading. */
export type TodayCardProps = {
  /** The due doses to list: the open ones, and those ticked while this page was open. */
  doses: DueDose[];
  /** Open doses, the hidden ones included, for "Log all N as taken". */
  open: number;
  reading: "bp" | "sugar" | null;
  /** Someone with regular medicines and no times yet. */
  setup: boolean;
  low: string | null;
  missed: boolean;
  error: string | null;
  onToggle: (dose: DueDose) => void;
  onLogAll: () => void;
  onDismiss: () => void;
};

const SHOWN = 4;
/** How many rows the card shows, so the home screen can make room on a phone. */
export const todayRows = (today: TodayCardProps) => Math.min(today.doses.length, SHOWN) + (today.reading ? 1 : 0) + (today.setup ? 1 : 0);
const slotWord = (slot: string) => SLOTS.find((item) => item.value === slot)?.label.toLowerCase() ?? slot;

/**
 * One card for today, so the reading reminder never hides the medicines from the people who need both (DESIGN.md 8.6e).
 * Fixed wording only, never dosing advice: a tick is a record of what the person took.
 */
export function TodayCard({ called, today }: { called: string | null; today: TodayCardProps }) {
  const [all, setAll] = useState(false);
  const shown = all ? today.doses : today.doses.slice(0, SHOWN);
  const hidden = today.doses.length - shown.length;
  const done = today.doses.length > 0 && today.open === 0;
  return (
    <section className="today w-full max-w-[var(--w-chat)]" aria-labelledby="today-title">
      <div className="flex items-center gap-3">
        <span className="tile" data-tone="mint" aria-hidden="true">
          <PillIcon size={22} />
        </span>
        <p id="today-title" className="row-title m-0 min-w-0 flex-1">
          Today{called ? `, ${called}` : ""}
        </p>
        <button type="button" className="icon-ghost -mr-1" onClick={today.onDismiss} aria-label="Not now">
          <CloseIcon size={16} />
        </button>
      </div>

      {shown.length ? (
        <ul className="today-list" aria-label="Medicines due">
          {shown.map((dose) => (
            <li key={dose.key} className="today-row">
              <span className="min-w-0 flex-1 truncate">
                <strong>{dose.medicine}</strong>
                <span className="text-[var(--ink-muted)]"> · {slotWord(dose.slot)}</span>
              </span>
              <button
                type="button"
                className="btn btn-compact taken-btn"
                aria-pressed={dose.taken}
                aria-label={dose.taken ? `${dose.medicine}, ${slotWord(dose.slot)}: taken. Tap to undo` : `${dose.medicine}, ${slotWord(dose.slot)}: mark as taken`}
                onClick={() => today.onToggle(dose)}
              >
                Taken
                {dose.taken ? <CheckIcon size={16} /> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {hidden > 0 ? (
        <button type="button" className="today-more" onClick={() => setAll(true)}>
          Show {hidden} more
        </button>
      ) : null}

      {today.reading ? (
        <Link href={`/app/diary?add=reading&kind=${today.reading}`} className="today-row today-link">
          <span className="tile tile-sm" data-tone={today.reading === "bp" ? "coral" : "sky"} aria-hidden="true">
            {today.reading === "bp" ? <HeartIcon size={16} /> : <DropIcon />}
          </span>
          <span className="min-w-0 flex-1 truncate">
            <strong>{today.reading === "bp" ? "Blood pressure" : "Sugar reading"}</strong>
            <span className="text-[var(--ink-muted)]"> · not yet</span>
          </span>
          <span className="today-go">
            Add <ChevronRightIcon />
          </span>
        </Link>
      ) : null}
      {today.setup ? (
        <Link href="/app/personalization?section=health&open=medicines" className="today-row today-link">
          <span className="min-w-0 flex-1">
            <strong>When do you take your medicines?</strong>
            <span className="block text-[0.875rem] text-[var(--ink-muted)]">Set the times, then tick them here each day.</span>
          </span>
          <span className="today-go">
            Set <ChevronRightIcon />
          </span>
        </Link>
      ) : null}

      {today.open >= 2 ? (
        <button type="button" className="btn btn-mint w-full" onClick={today.onLogAll}>
          Log all {today.open} as taken
        </button>
      ) : null}
      {done ? (
        <p className="today-note m-0 font-semibold text-[var(--ink)]" role="status">
          All taken for now ✓
        </p>
      ) : null}
      {today.error ? (
        <p className="today-note m-0 text-[var(--alert-text)]" role="alert">
          {today.error}
        </p>
      ) : null}
      {today.low ? <p className="today-note m-0">{today.low}</p> : null}
      {today.missed ? <p className="today-note m-0">{MISSED_DOSE_LINE}</p> : null}
    </section>
  );
}
