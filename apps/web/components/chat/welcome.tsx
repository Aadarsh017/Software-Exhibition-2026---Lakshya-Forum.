"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { Nox } from "@/components/nox";
import { firstName } from "@/lib/personalization/profile";
import { FEELINGS, type Feeling } from "@/lib/diary/diary";
import { BookmarkIcon, ChevronRightIcon, ChildIcon, CloseIcon, DocIcon, HeartIcon, MoonIcon, PillIcon, ThermometerIcon } from "./icons";
import { TodayCard, todayRows, type TodayCardProps } from "./today-card";

type Tone = "coral" | "lilac" | "mint" | "butter" | "sky" | "grape";

// Each topic keeps its colour, so people find it by colour before they read (DESIGN.md 8.3, "What we learned from Tuckii").
const TOPICS: { tone: Tone; icon: ReactNode; title: string; text: string }[] = [
  { tone: "coral", icon: <ThermometerIcon />, title: "Fever or headache", text: "I have a fever and a headache" },
  { tone: "sky", icon: <ChildIcon />, title: "My child isn't well", text: "My child isn't well: " },
  { tone: "mint", icon: <PillIcon size={22} />, title: "A medicine", text: "I have a question about a medicine: " },
  { tone: "lilac", icon: <MoonIcon />, title: "Can't sleep", text: "I'm having trouble sleeping" },
  { tone: "grape", icon: <HeartIcon />, title: "Stress or low mood", text: "I've been feeling stressed and low" },
];

const NUDGE_KEY = "hch-nudge-save";
const NUDGE_QUIET_DAYS = 7;

/**
 * The home screen: a calm question (one phrase on a pill), the big message box, then ONE nudge when something needs
 * the person (a guest is asked to keep their chats, and can wave it away for a week), then the topic cards. On short
 * screens the lower cards and the nudge step aside, so the screen never needs scrolling.
 */
export type CheckIn = { title: string; when: string; onFeel: (feeling: Feeling) => void; onDismiss: () => void };

export function Welcome({
  composer,
  onPick,
  guest,
  name,
  checkIn,
  today,
}: {
  composer: ReactNode;
  onPick: (text: string) => void;
  guest: boolean;
  name?: string | null;
  checkIn?: CheckIn | null;
  /** Today's medicines and reading, as one card (DESIGN.md 8.6e). */
  today?: TodayCardProps | null;
}) {
  const called = firstName(name);
  const [quiet, setQuiet] = useState(false);

  useEffect(() => {
    try {
      const at = Number(localStorage.getItem(NUDGE_KEY));
      if (at && Date.now() - at < NUDGE_QUIET_DAYS * 86_400_000) setQuiet(true);
    } catch {
      // ignore: the nudge simply shows
    }
  }, []);

  function dismiss() {
    setQuiet(true);
    try {
      localStorage.setItem(NUDGE_KEY, String(Date.now()));
    } catch {
      // ignore
    }
  }

  return (
    <div className="welcome" data-today={today && !checkIn ? (todayRows(today) >= 4 ? "tall" : "short") : undefined}>
      <Nox className="welcome-nox h-20 w-16" />
      <h1 className="welcome-title">
        {called ? (
          <>
            What&apos;s on your mind, <span className="hl">{called}</span>?
          </>
        ) : (
          <>
            What&apos;s on your mind <span className="hl">tonight?</span>
          </>
        )}
      </h1>
      <div className="w-full max-w-[var(--w-chat)]">{composer}</div>

      {checkIn ? (
        // A check-in (DESIGN.md 8.6c): the day after a chat about a problem, ask how it is now. It wins over any other nudge.
        <section className="checkin w-full max-w-[var(--w-chat)]" aria-labelledby="checkin-title">
          <div className="flex items-start gap-3">
            <span className="tile" data-tone="sky" aria-hidden="true">
              <ThermometerIcon />
            </span>
            <div className="min-w-0 flex-1">
              <p id="checkin-title" className="row-title m-0">
                How is your {checkIn.title.toLowerCase()} now{called ? `, ${called}` : ""}?
              </p>
              <p className="row-sub m-0">You told me about it {checkIn.when}.</p>
            </div>
            <button type="button" className="icon-ghost -mt-1 -mr-1" onClick={checkIn.onDismiss} aria-label="Not now">
              <CloseIcon size={16} />
            </button>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {FEELINGS.map((feeling) => (
              <button key={feeling.value} type="button" className="btn feel-btn btn-compact" data-tone={feeling.value === "better" ? "mint" : feeling.value === "same" ? "butter" : "coral"} onClick={() => checkIn.onFeel(feeling.value)}>
                {feeling.label}
              </button>
            ))}
          </div>
        </section>
      ) : today ? (
        // One nudge at a time: a check-in wins, then the Today card (medicines and today's reading), then "Save your chats".
        <TodayCard called={called} today={today} />
      ) : guest && !quiet ? (
        <div className="nudge relative w-full max-w-[var(--w-chat)]">
          <Link href="/login?next=/app" className="row-card">
            <span className="tile" data-tone="mint" aria-hidden="true">
              <BookmarkIcon />
            </span>
            <span className="min-w-0 flex-1 pr-10">
              <span className="row-title block">Save your chats</span>
              <span className="row-sub block">Add your email. No password.</span>
            </span>
            <ChevronRightIcon />
          </Link>
          <button type="button" className="absolute top-1/2 right-[44px] grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-[var(--ink-muted)] hover:bg-[var(--paper-sunk)]" onClick={dismiss} aria-label="Not now. Hide this for a week">
            <CloseIcon size={16} />
          </button>
        </div>
      ) : null}

      <section className="w-full max-w-[var(--w-chat)]" aria-labelledby="topics-label">
        <p id="topics-label" className="section-label mb-1">
          Start with
        </p>
        <ul className="topic-grid" aria-label="Starting points">
          {TOPICS.map((topic) => (
            <li key={topic.title}>
              <button type="button" className="topic" data-tone={topic.tone} onClick={() => onPick(topic.text)}>
                <span className="tile" aria-hidden="true">
                  {topic.icon}
                </span>
                <span className="topic-title">{topic.title}</span>
              </button>
            </li>
          ))}
          <li>
            <Link href="/app/summaries" className="topic" data-tone="butter">
              <span className="tile" aria-hidden="true">
                <DocIcon />
              </span>
              <span className="topic-title">Summary for my doctor</span>
            </Link>
          </li>
        </ul>
      </section>
    </div>
  );
}
