"use client";

import Link from "next/link";
import { useState } from "react";
import { availableTrends, TRENDS, trendSeries, type DiaryRecord, type Trend } from "@/lib/diary/diary";
import { assessBloodPressure, assessDraft, assessSugar, emptyReading, pulseNote, READING_KINDS, SUGAR_TIMINGS, toReadingRow, weekAverage, type ReadingContext, type ReadingDraft, type ReadingKind, type ReadingRow, type SugarTiming } from "@/lib/diary/readings";
import { ChoiceGroup } from "@/components/onboarding/choice-group";
import { EditorScreen } from "@/components/personalization/editors";
import { PhoneIcon } from "@/components/nox";

// What each chart draws (DESIGN.md 8.6d): the unit, the guide lines (135/85 is "high" for home readings), and when a
// dot is coloured as a warning (the reading's band is high, very high or low).
const flagged = (assessment: { band: string }) => assessment.band === "high" || assessment.band === "urgent" || assessment.band === "low";
const CHART: Record<Trend, { unit: string; lines: { at: number; label: string }[]; warn: (value: number, low: number | undefined, context: ReadingContext) => boolean }> = {
  temperature: { unit: "°C", lines: [{ at: 38, label: "38°" }], warn: (value) => value >= 38 },
  bp: { unit: "", lines: [{ at: 135, label: "135" }, { at: 85, label: "85" }], warn: (value, low, context) => flagged(assessBloodPressure(value, low ?? 0, context)) },
  sugar: { unit: "mg/dL", lines: [{ at: 180, label: "180" }, { at: 70, label: "70" }], warn: (value, _low, context) => flagged(assessSugar(value, null, context)) },
  weight: { unit: "kg", lines: [], warn: () => false },
};

/**
 * The trend card (DESIGN.md 8.6d): one even row of chips for what has at least two readings in the last two weeks, and
 * a small line chart with its guide lines. Decorative: the list below says the same, so the chart is one image with a
 * description for screen readers.
 */
export function TrendCard({ entries, context = {} }: { entries: DiaryRecord[]; context?: ReadingContext }) {
  const trends = availableTrends(entries);
  const [picked, setPicked] = useState<Trend | null>(null);
  const trend = picked && trends.includes(picked) ? picked : (trends[0] ?? null);
  if (!trend) return null;
  const points = trendSeries(entries, trend);
  const spec = CHART[trend];
  const width = 320;
  const height = 92;
  const pad = 12;
  // The plot stops short of the right edge, so the guide labels have their own margin and never sit on a dot.
  const right = spec.lines.length ? 30 : pad;
  const values = [...points.map((p) => p.value), ...points.map((p) => p.low ?? p.value), ...spec.lines.map((line) => line.at)];
  const span = Math.max(...values) - Math.min(...values) || 1;
  const low = Math.min(...values) - span * 0.08;
  const high = Math.max(...values) + span * 0.08;
  const first = points[0]!.at;
  const time = Math.max(points[points.length - 1]!.at - first, 1);
  const x = (at: number) => pad + ((at - first) / time) * (width - pad - right);
  const y = (value: number) => height - pad - ((value - low) / (high - low)) * (height - pad * 2);
  const line = (pick: (p: (typeof points)[number]) => number) => points.map((p, i) => `${i ? "L" : "M"}${x(p.at).toFixed(1)},${y(pick(p)).toFixed(1)}`).join(" ");
  const latest = points[points.length - 1]!;
  const latestText = trend === "bp" ? `${latest.value}/${latest.low}` : `${latest.value} ${spec.unit}`;
  const name = TRENDS.find((item) => item.value === trend)!.name;
  return (
    <figure className="card m-0 grid gap-2.5 p-4">
      {trends.length > 1 ? (
        <ChoiceGroup<Trend> label="Which chart" hideLabel options={TRENDS.filter((item) => trends.includes(item.value)).map(({ value, label }) => ({ value, label }))} value={trend} onChange={(value) => value && setPicked(value)} columns={trends.length} />
      ) : null}
      {trend === "bp" ? <WeekAverage entries={entries} /> : null}
      <figcaption className="flex items-baseline justify-between gap-2">
        <span className="font-semibold">{trends.length > 1 ? "Last 2 weeks" : `${name}, last 2 weeks`}</span>
        <span className="text-[0.875rem] whitespace-nowrap text-[var(--ink-muted)]">Latest {latestText}</span>
      </figcaption>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto max-h-[104px] w-full" role="img" aria-label={`${name} over the last two weeks, ${points.length} readings, latest ${latestText}`}>
        {spec.lines.map((guide) => (
          <g key={guide.at}>
            <line x1={pad} x2={width - right + 4} y1={y(guide.at)} y2={y(guide.at)} stroke="var(--alert-text)" strokeDasharray="4 4" strokeWidth="1.25" />
            <text x={width - 2} y={y(guide.at) + 3} textAnchor="end" fontSize="9" fill="var(--alert-text)">
              {guide.label}
            </text>
          </g>
        ))}
        {trend === "bp" ? <path d={line((p) => p.low ?? p.value)} fill="none" stroke="var(--ink-muted)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" /> : null}
        <path d={line((p) => p.value)} fill="none" stroke="var(--ink)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p) => (
          <g key={p.at}>
            {trend === "bp" ? <circle cx={x(p.at)} cy={y(p.low ?? p.value)} r="3" fill="var(--card)" stroke="var(--ink-muted)" strokeWidth="1.5" /> : null}
            <circle cx={x(p.at)} cy={y(p.value)} r="4" fill={spec.warn(p.value, p.low, context) ? "var(--accent-coral)" : "var(--accent-mint)"} stroke="var(--ink)" strokeWidth="1.5" />
          </g>
        ))}
      </svg>
      {trend === "bp" || trend === "sugar" ? (
        <Link href="/app?ask=readings" className="near-link w-fit">
          Ask Nox about these readings
        </Link>
      ) : null}
    </figure>
  );
}

/**
 * The number doctors ask about, bigger than the latest reading (DESIGN.md 8.6d): this week's average blood pressure.
 * Diagnosis uses averages of home readings, never one reading.
 */
function WeekAverage({ entries }: { entries: DiaryRecord[] }) {
  const week = weekAverage(entries);
  if (!week || week.count < 2) return null;
  return (
    <p className="m-0 flex items-baseline gap-2">
      <span className="font-display text-[1.625rem] leading-none font-extrabold">
        {week.systolic}/{week.diastolic}
      </span>
      <span className="text-[0.9375rem] text-[var(--ink-muted)]">average of {week.count} readings this week</span>
    </p>
  );
}

/**
 * Add a reading (DESIGN.md 8.6d): blood pressure, sugar or weight on one screen. What the reading means shows as soon as
 * the numbers are in, in fixed wording, with "Call 112" when it's very high or very low.
 */
export function ReadingForm({
  lastWeight,
  initialKind = "bp",
  context = {},
  onSave,
}: {
  lastWeight: number | null;
  initialKind?: ReadingKind;
  context?: ReadingContext;
  onSave: (row: ReadingRow) => Promise<string | null>;
}) {
  const [draft, setDraft] = useState<ReadingDraft>(emptyReading(initialKind));
  const update = (patch: Partial<ReadingDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const result = assessDraft(draft, context);
  const pulse = draft.kind === "bp" && draft.pulse.trim() ? pulseNote(Number(draft.pulse)) : null;
  const weight = Number(draft.weight.replace(",", "."));
  const change = draft.kind === "weight" && lastWeight !== null && Number.isFinite(weight) && weight >= 2 && weight <= 350 ? Math.round((weight - lastWeight) * 10) / 10 : null;

  return (
    <EditorScreen
      intro={draft.kind === "bp" ? "Use an upper-arm cuff, not a watch. Sit quietly for 5 minutes first, feet flat, arm at heart level." : "Write what your meter or scale shows."}
      saveLabel="Save reading"
      onSave={async () => {
        const checked = toReadingRow(draft);
        if (!checked.ok) return checked.error;
        return onSave(checked.row);
      }}
    >
      <ChoiceGroup<ReadingKind> label="What are you logging?" options={READING_KINDS} value={draft.kind} onChange={(kind) => kind && update({ kind })} columns={3} />

      {draft.kind === "bp" ? (
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="field-label" htmlFor="systolic">
              Top
            </label>
            <input id="systolic" className="field" inputMode="numeric" placeholder="128" aria-describedby="bp-hint" value={draft.systolic} onChange={(event) => update({ systolic: event.target.value })} />
          </div>
          <div>
            <label className="field-label" htmlFor="diastolic">
              Bottom
            </label>
            <input id="diastolic" className="field" inputMode="numeric" placeholder="82" aria-describedby="bp-hint" value={draft.diastolic} onChange={(event) => update({ diastolic: event.target.value })} />
          </div>
          <div>
            <label className="field-label" htmlFor="pulse">
              Pulse
            </label>
            <input id="pulse" className="field" inputMode="numeric" placeholder="72" value={draft.pulse} onChange={(event) => update({ pulse: event.target.value })} />
          </div>
          <p id="bp-hint" className="col-span-3 m-0 -mt-1 text-[0.875rem] text-[var(--ink-muted)]">
            In mmHg, the way the machine shows it: 128 over 82. Pulse is optional.
          </p>
        </div>
      ) : null}

      {draft.kind === "sugar" ? (
        <>
          <div className="flex items-center justify-between gap-3">
            <label className="field-label !mb-0" htmlFor="sugar">
              Blood sugar (mg/dL)
            </label>
            <input id="sugar" className="field !w-32 flex-none" inputMode="decimal" placeholder="104" value={draft.sugar} onChange={(event) => update({ sugar: event.target.value })} />
          </div>
          <ChoiceGroup<SugarTiming> label="When?" options={SUGAR_TIMINGS} value={draft.timing} onChange={(timing) => update({ timing })} clearable columns={3} hint={draft.timing === "after_meal" ? "About 2 hours after you started eating." : undefined} />
        </>
      ) : null}

      {draft.kind === "weight" ? (
        <div className="grid gap-2">
          <div className="flex items-center justify-between gap-3">
            <label className="field-label !mb-0" htmlFor="weight-now">
              Weight (kg)
            </label>
            <input id="weight-now" className="field !w-32 flex-none" inputMode="decimal" placeholder={lastWeight ? String(lastWeight) : "68.5"} value={draft.weight} onChange={(event) => update({ weight: event.target.value })} />
          </div>
          <p className="m-0 text-[0.875rem] text-[var(--ink-muted)]" role="status">
            {change === null ? (lastWeight !== null ? `Last time: ${lastWeight} kg.` : "Same scale, same time of day, is best.") : change === 0 ? `Same as last time (${lastWeight} kg).` : `${change > 0 ? "Up" : "Down"} ${Math.abs(change)} kg since last time.`}
          </p>
        </div>
      ) : null}

      {result ? (
        <section className="reading-result" data-band={result.band} aria-live="polite" aria-label="What this reading means">
          <p className="m-0 flex items-center gap-2 font-bold">
            <span className="flag-chip" data-flag={result.band}>
              {result.label}
            </span>
            {draft.kind === "bp" ? "for one reading" : "for this reading"}
          </p>
          <p className="m-0 text-[0.9375rem]">{result.advice}</p>
          {pulse ? <p className="m-0 text-[0.9375rem]">{pulse}</p> : null}
          {result.callNow ? (
            <a className="btn btn-alert btn-compact w-fit" href="tel:112">
              <PhoneIcon /> Call 112
            </a>
          ) : null}
        </section>
      ) : null}

      <div>
        <label className="field-label" htmlFor="reading-note">
          A note <span className="font-normal text-[var(--ink-muted)]">(optional)</span>
        </label>
        <input id="reading-note" className="field" maxLength={280} placeholder={draft.kind === "sugar" ? "For example, before breakfast" : "For example, after a walk"} value={draft.note} onChange={(event) => update({ note: event.target.value })} />
      </div>
    </EditorScreen>
  );
}
