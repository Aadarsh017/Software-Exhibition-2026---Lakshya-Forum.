import type { CSSProperties } from "react";

type Line = { text: string; lock?: boolean };

// About 1.5 s for a usual note, never more than 2.5 s however long it is (DESIGN.md 8.3).
const PER_CHAR_MS = 26;
const MAX_MS = 2200;

/** When each word starts and how long it takes, so the note writes in one pass, word after word. */
export function writingPlan(lines: Line[]): { words: { word: string; delay: number; duration: number }[][]; total: number } {
  const split = lines.map((line) => line.text.split(/\s+/).filter(Boolean));
  const chars = split.flat().reduce((sum, word) => sum + word.length + 1, 0);
  const perChar = Math.min(PER_CHAR_MS, MAX_MS / Math.max(chars, 1));
  let at = 120;
  const words = split.map((line, index) => {
    if (index > 0) at += perChar * 6; // the pen moves to the next line
    return line.map((word) => {
      const duration = Math.max(60, Math.round(word.length * perChar));
      const step = { word, delay: Math.round(at), duration };
      at += duration + perChar;
      return step;
    });
  });
  return { words, total: Math.round(at) };
}

function Lock() {
  return (
    <svg className="mn-lock" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <rect x="3" y="7" width="10" height="7.5" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </svg>
  );
}

function Pen() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13.5 3.5l3 3L7 16H4v-3z" />
      <path d="M11.5 5.5l3 3" />
    </svg>
  );
}

/**
 * A margin note (DESIGN.md 8.3): a quiet sentence that explains the page, handwritten beside a coral margin line, that
 * writes itself in once when the page opens. `lock` adds the page's privacy line as the note's last, quieter line.
 * Screen readers get the plain sentence once; the written-in copy is hidden from them.
 */
export function MarginNote({ children, lock, align = "start", className = "" }: { children?: string; lock?: string; align?: "start" | "center"; className?: string }) {
  const lines: Line[] = [...(children ? [{ text: children }] : []), ...(lock ? [{ text: lock, lock: true }] : [])];
  const plan = writingPlan(lines);
  return (
    <p className={`margin-note ${className}`} data-align={align}>
      <span className="sr-only">{lines.map((line) => line.text).join(" ")}</span>
      <span aria-hidden="true">
        {plan.words.map((words, index) => (
          <span key={index} className={`mn-line${lines[index]?.lock ? " mn-quiet" : ""}`}>
            {lines[index]?.lock ? <Lock /> : null}
            {words.map((step, at) => (
              <span key={at}>
                <span className="mn-w" style={{ "--d": `${step.delay}ms`, "--t": `${step.duration}ms` } as CSSProperties}>
                  {step.word}
                </span>
                {at < words.length - 1 ? " " : null}
              </span>
            ))}
            {index === plan.words.length - 1 ? (
              <span className="mn-pen" style={{ "--d": `${Math.max(0, plan.total - 500)}ms` } as CSSProperties}>
                <Pen />
              </span>
            ) : null}
          </span>
        ))}
      </span>
    </p>
  );
}
