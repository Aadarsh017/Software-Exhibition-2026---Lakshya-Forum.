import type { ReactNode } from "react";
import type { CareLevel } from "@/lib/chat/types";
import { CalendarIcon, ClockIcon, CrossIcon, HomeIcon, SirenIcon } from "./icons";

// Five signals together, so the level survives grayscale and colour blindness: surface, icon, words,
// dots and border weight (DESIGN.md 4.4). The numbers are internal; people see words and dots.
const LEVELS: Record<CareLevel, { label: string; dots: number; border: number; icon: ReactNode; bg: string; fg: string; edge: string }> = {
  ambulance: { label: "Call emergency services now", dots: 5, border: 3.5, icon: <SirenIcon />, bg: "var(--care-5-bg)", fg: "var(--care-5-fg)", edge: "var(--care-5-edge)" },
  emergency: { label: "Get emergency care now", dots: 4, border: 3.5, icon: <CrossIcon />, bg: "var(--care-4-bg)", fg: "var(--care-4-fg)", edge: "var(--care-4-edge)" },
  doctor24: { label: "See a doctor today", dots: 3, border: 2.5, icon: <ClockIcon />, bg: "var(--care-3-bg)", fg: "var(--care-3-fg)", edge: "var(--care-3-edge)" },
  doctor: { label: "See a doctor soon", dots: 2, border: 2, icon: <CalendarIcon />, bg: "var(--care-2-bg)", fg: "var(--care-2-fg)", edge: "var(--care-2-edge)" },
  selfcare: { label: "Care at home", dots: 1, border: 2, icon: <HomeIcon />, bg: "var(--care-1-bg)", fg: "var(--care-1-fg)", edge: "var(--care-1-edge)" },
};

export function careLabel(level: CareLevel): string {
  return LEVELS[level].label;
}

export function CareBand({ level, reason }: { level: CareLevel; reason?: string }) {
  const spec = LEVELS[level];
  return (
    <div
      className="care-band"
      role="group"
      aria-label={`How urgent: ${spec.label}`}
      style={{ background: spec.bg, color: spec.fg, border: `${spec.border}px solid ${spec.edge}` }}
    >
      <div className="care-band-row">
        {spec.icon}
        <span className="care-label">{spec.label}</span>
        <span className="care-dots" aria-hidden="true">
          {[1, 2, 3, 4, 5].map((n) => (
            <i key={n} className={n <= spec.dots ? "on" : ""} />
          ))}
        </span>
      </div>
      {reason ? <p className="care-note m-0">{reason}</p> : null}
      <p className="care-note m-0" style={{ opacity: 0.85 }}>
        General guidance, not a diagnosis.
      </p>
    </div>
  );
}

/** For a conversation about self-harm: calm lilac, no red, no dots, no "level" (DESIGN.md 7.7). */
export function SupportBand({ reason }: { reason?: string }) {
  return (
    <div className="care-band" role="group" aria-label="Support is available right now" style={{ background: "var(--block-lilac)", color: "var(--on-block)", border: "2px solid var(--line)" }}>
      <div className="care-band-row">
        <span className="care-label">Support is available right now</span>
      </div>
      {reason ? <p className="care-note m-0">{reason}</p> : null}
    </div>
  );
}
