import { stepsToShow } from "@/lib/chat/reducer";
import type { StepName, StepState, Turn } from "@/lib/chat/types";

// Each step mirrors a real server event; nothing here is faked (DESIGN.md 7.6).
const LABEL: Record<StepName, string> = {
  read: "Reading your message",
  safety: "Checking safety rules",
  medlineplus: "Looking up NIH MedlinePlus",
  fda: "Checking FDA drug labels",
  write: "Writing your answer",
};
const SHORT: Record<StepName, string> = {
  read: "your message",
  safety: "safety rules",
  medlineplus: "NIH MedlinePlus",
  fda: "FDA labels",
  write: "answer",
};
const FAILED_NOTE: Partial<Record<StepName, string>> = {
  medlineplus: "Couldn't reach NIH MedlinePlus. This answer uses the other sources only.",
  fda: "Couldn't reach FDA labels. This answer uses MedlinePlus only.",
};

function Icon({ state }: { state: StepState }) {
  if (state === "active") return <span className="step-icon"><span className="spinner" /></span>;
  if (state === "done") return <span className="step-icon" aria-hidden="true">✓</span>;
  if (state === "failed") return <span className="step-icon" aria-hidden="true">!</span>;
  return <span className="step-icon" aria-hidden="true" />;
}

const WORD: Record<StepState, string> = { pending: "waiting", active: "in progress", done: "done", skipped: "skipped", failed: "failed" };

/** Live while the answer is being made. */
export function FetchStepper({ turn }: { turn: Turn }) {
  const steps = stepsToShow(turn);
  return (
    <ol className="stepper" aria-label="What I'm doing">
      {steps.map((step) => {
        const state = turn.steps[step];
        return (
          <li key={step} className={`step-${state}`}>
            <Icon state={state} />
            <span>
              {LABEL[step]}
              <span className="sr-only"> — {WORD[state]}</span>
              {state === "failed" && FAILED_NOTE[step] ? <span className="block text-[0.875rem] text-[var(--alert-text)]">{FAILED_NOTE[step]}</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * While the answer is being made: one quiet line with the step the server is really on (DESIGN.md 7.6, chat v3).
 * A step that failed still says so plainly, on its own line.
 */
export function LiveLine({ turn }: { turn: Turn }) {
  const steps = stepsToShow(turn);
  const current = steps.find((step) => turn.steps[step] === "active") ?? steps.find((step) => turn.steps[step] === "pending") ?? steps[steps.length - 1];
  const failed = steps.filter((step) => turn.steps[step] === "failed" && FAILED_NOTE[step]);
  return (
    <div className="grid gap-1">
      <p className="live-line m-0">
        <span className="spinner" aria-hidden="true" />
        {current ? LABEL[current] : "Working"}…
      </p>
      {failed.map((step) => (
        <p key={step} className="m-0 text-[0.875rem] text-[var(--alert-text)]">
          {FAILED_NOTE[step]}
        </p>
      ))}
    </div>
  );
}

/** One line once the answer is complete: what was checked. Tap to see the steps. */
export function CheckedSummary({ turn }: { turn: Turn }) {
  const checked = (["safety", "medlineplus", "fda"] as StepName[]).filter((step) => turn.steps[step] !== "skipped");
  return (
    <details className="checked text-[0.8125rem] text-[var(--ink-muted)]">
      <summary className="cursor-pointer select-none py-1">
        Checked{" "}
        {checked.map((step) => (
          <span key={step} className="mr-2 whitespace-nowrap">
            {SHORT[step]} {turn.steps[step] === "failed" ? "✗" : "✓"}
          </span>
        ))}
      </summary>
      <div className="pt-2">
        <FetchStepper turn={turn} />
      </div>
    </details>
  );
}
