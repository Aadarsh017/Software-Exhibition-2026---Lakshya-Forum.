// Home readings in the diary (DESIGN.md 8.6d): blood pressure, blood sugar and weight, as pure helpers so they can be
// tested without a browser. Erasable TypeScript only.
//
// The bands are for ONE home reading and say what to do next; they never diagnose. Sources (PLAN.md §12, "Research
// round 2"): blood pressure, the Indian Guidelines on Hypertension (IGH-IV) and the NHS for home readings (135/85 or more
// is high), the AHA/ACC 2025 bands below that, NHS for low (under 90/60), the AHA's hypertensive-crisis advice, and the
// AHA's pregnancy chart; blood sugar, the ADA Standards of Care and the CDC (under 70 low, under 54 very low, the 15-15
// rule, 300 or more that stays), with the ADA's targets for people with diabetes (80-130 before meals, under 180 after).
// Wording needs clinician review before launch (PLAN 6.12).

export type Band = "low" | "normal" | "raised" | "high" | "urgent";
export type Assessment = { band: Band; label: string; advice: string; callNow: boolean };
/** What changes the bands: pregnancy (blood pressure) and diabetes (sugar targets), from the person's profile. */
export type ReadingContext = { pregnant?: boolean; diabetes?: boolean };

export const BAND_LABEL: Record<Band, string> = { low: "Low", normal: "Normal", raised: "A bit high", high: "High", urgent: "Very high" };

const TRACKS_BP = /blood pressure|hypertension|\bb\.?p\b/i;
const TRACKS_SUGAR = /diabet|blood sugar|\bsugar\b/i;

/** The context from what the person saved: conditions (free text) and the pregnancy answer. */
export function readingContext(conditions: string[], pregnancy: string | null | undefined): ReadingContext {
  return { pregnant: pregnancy === "yes", diabetes: conditions.some((item) => TRACKS_SUGAR.test(item)) };
}

/** One blood pressure reading, top (systolic) and bottom (diastolic) numbers in mmHg, measured at home. */
export function assessBloodPressure(systolic: number, diastolic: number, context: ReadingContext = {}): Assessment {
  if (context.pregnant) {
    // Pregnancy has its own lines (AHA): 160/110 needs care now, 140/90 a call to the care team today.
    if (systolic >= 160 || diastolic >= 110) {
      return {
        band: "urgent",
        label: "Very high",
        advice: "In pregnancy this needs care now: call your doctor or go to hospital now. Call 112 if you also have a bad headache, changes in your vision, or pain in your upper belly.",
        callNow: true,
      };
    }
    if (systolic >= 140 || diastolic >= 90) {
      return { band: "high", label: "High", advice: "In pregnancy, call your care team today about this reading. Get help at once if you have a bad headache, vision changes or belly pain.", callNow: false };
    }
  } else if (systolic >= 180 || diastolic >= 120) {
    return {
      band: "urgent",
      label: "Very high",
      advice:
        "Sit quietly for 5 minutes and measure again. If it's still this high, call your doctor today. Call 112 now if you also have chest pain, shortness of breath, back pain, weakness or numbness, trouble speaking or seeing.",
      callNow: true,
    };
  }
  if (systolic < 90 || diastolic < 60) {
    return {
      band: "low",
      label: "Low",
      advice: "Low numbers are often fine if you feel well. If you feel dizzy or faint, sit or lie down and drink some water, and tell a doctor if it keeps happening.",
      callNow: false,
    };
  }
  if (systolic >= 135 || diastolic >= 85) {
    return {
      band: "high",
      label: "High",
      advice: context.pregnant
        ? "Above the usual range. Tell your care team at your next visit, sooner if it keeps rising."
        : "For home readings, 135/85 or more counts as high. One reading isn't a diagnosis: measure at the same times for a few days, and see a doctor if most are this high.",
      callNow: false,
    };
  }
  if (systolic >= 120 || diastolic >= 80) {
    return { band: "raised", label: "A bit high", advice: "Above the ideal of under 120/80. Less salt, regular walks and keeping an eye on it help.", callNow: false };
  }
  return { band: "normal", label: "Normal", advice: "In the healthy range.", callNow: false };
}

export type SugarTiming = "fasting" | "after_meal" | "random";
export const SUGAR_TIMINGS: { value: SugarTiming; label: string }[] = [
  { value: "fasting", label: "Fasting" },
  { value: "after_meal", label: "After a meal" },
  { value: "random", label: "Other time" },
];

/**
 * One blood sugar reading in mg/dL. "After a meal" means 1 to 2 hours after starting it. For people with diabetes the
 * bands follow the usual ADA targets (80 to 130 before meals, under 180 after); for others, the normal ranges.
 */
export function assessSugar(mgdl: number, timing: SugarTiming | null, context: ReadingContext = {}): Assessment {
  const lowAdvice =
    "Have 15 g of fast sugar now (half a glass of fruit juice, or 3 teaspoons of sugar in water), then check again in 15 minutes. Repeat if it's still under 70.";
  if (mgdl < 54) {
    return { band: "urgent", label: "Very low", advice: `${lowAdvice} Call 112 if the person is drowsy, confused or can't swallow safely: don't give them food or drink.`, callNow: true };
  }
  if (mgdl < 70) return { band: "low", label: "Low", advice: lowAdvice, callNow: false };
  if (mgdl >= 300) {
    return {
      band: "urgent",
      label: "Very high",
      advice: "Drink water and check again. If it stays at 300 or more, call your doctor today. Get emergency help now if you're vomiting, breathing fast or with difficulty, have fruity-smelling breath, or feel very drowsy.",
      callNow: true,
    };
  }
  if (context.diabetes) {
    const before = timing === "fasting";
    const top = before ? 130 : 180;
    if (mgdl > top) {
      return {
        band: mgdl >= 250 ? "high" : "raised",
        label: mgdl >= 250 ? "High" : "Above target",
        advice: `Above the usual target ${before ? "before meals (80 to 130)" : "after meals (under 180)"}. Your doctor may have set your own target; tell them if most readings are above it.${mgdl >= 250 ? " If you use insulin, check for ketones." : ""}`,
        callNow: false,
      };
    }
    return { band: "normal", label: "In target", advice: before ? "In the usual target before meals (80 to 130)." : "In the usual target after meals (under 180).", callNow: false };
  }
  if (timing === "fasting") {
    if (mgdl >= 126) return { band: "high", label: "High", advice: "Above the normal fasting range (70 to 99). A home meter can't diagnose diabetes: ask a doctor about a blood test.", callNow: false };
    if (mgdl >= 100) return { band: "raised", label: "A bit high", advice: "Above the normal fasting range (70 to 99). Worth checking again, and mentioning to your doctor.", callNow: false };
    return { band: "normal", label: "Normal", advice: "In the normal fasting range (70 to 99).", callNow: false };
  }
  if (mgdl >= 200) return { band: "high", label: "High", advice: "High for any time of day. A home meter can't diagnose diabetes: see a doctor soon for a blood test.", callNow: false };
  if (mgdl >= 140) return { band: "raised", label: "A bit high", advice: "Above the usual range after a meal (under 140). Worth checking again another day.", callNow: false };
  return { band: "normal", label: "Normal", advice: timing === "after_meal" ? "In the usual range after a meal (under 140)." : "In the usual range.", callNow: false };
}

/** A pulse at rest: usual is 50 to 100 for most adults; only flag what's well outside it. */
export function pulseNote(pulse: number | null): string | null {
  if (pulse === null) return null;
  if (pulse < 50) return "Your pulse is slow. That can be normal if you're very fit; tell a doctor if you feel dizzy or faint.";
  if (pulse > 120) return "Your pulse is fast for resting. Sit quietly and check again; get help now if you have chest pain or feel faint.";
  return null;
}

// ---- The form -------------------------------------------------------------------------------------------------------

export type ReadingKind = "bp" | "sugar" | "weight";
export const READING_KINDS: { value: ReadingKind; label: string }[] = [
  { value: "bp", label: "Blood pressure" },
  { value: "sugar", label: "Sugar" },
  { value: "weight", label: "Weight" },
];

export type ReadingDraft = { kind: ReadingKind; systolic: string; diastolic: string; pulse: string; sugar: string; timing: SugarTiming | null; weight: string; note: string };
export const emptyReading = (kind: ReadingKind = "bp"): ReadingDraft => ({ kind, systolic: "", diastolic: "", pulse: "", sugar: "", timing: null, weight: "", note: "" });

export type ReadingRow = {
  bp_systolic: number | null;
  bp_diastolic: number | null;
  pulse: number | null;
  glucose_mgdl: number | null;
  glucose_timing: SugarTiming | null;
  weight_kg: number | null;
  note: string | null;
};

const num = (text: string): number | null => {
  const raw = text.trim().replace(",", ".");
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : NaN;
};

/** The row to save, or an error to show. The limits match the database. */
export function toReadingRow(draft: ReadingDraft): { ok: true; row: ReadingRow } | { ok: false; error: string } {
  const note = draft.note.replace(/\s+/g, " ").trim().slice(0, 280) || null;
  const empty: ReadingRow = { bp_systolic: null, bp_diastolic: null, pulse: null, glucose_mgdl: null, glucose_timing: null, weight_kg: null, note };
  if (draft.kind === "bp") {
    const top = num(draft.systolic);
    const bottom = num(draft.diastolic);
    const pulse = num(draft.pulse);
    if (top === null || bottom === null) return { ok: false, error: "Add both numbers from the machine, for example 128 and 82." };
    if (Number.isNaN(top) || Number.isNaN(bottom) || (pulse !== null && Number.isNaN(pulse))) return { ok: false, error: "Use numbers only, for example 128." };
    if (top <= bottom) return { ok: false, error: "The top number is the bigger one, for example 128 over 82." };
    if (top < 50 || top > 260 || bottom < 30 || bottom > 160) return { ok: false, error: "Those numbers look unlikely. Please check the machine's screen." };
    if (pulse !== null && (pulse < 25 || pulse > 250)) return { ok: false, error: "That pulse looks unlikely. Please check the machine's screen." };
    return { ok: true, row: { ...empty, bp_systolic: Math.round(top), bp_diastolic: Math.round(bottom), pulse: pulse === null ? null : Math.round(pulse) } };
  }
  if (draft.kind === "sugar") {
    const value = num(draft.sugar);
    if (value === null || Number.isNaN(value)) return { ok: false, error: "Add the number from your meter, for example 104." };
    // Someone may type mmol/L: say so rather than saving a wrong value.
    if (value > 1.5 && value < 30) return { ok: false, error: "That looks like mmol/L. Please enter mg/dL (mmol/L × 18; 6.0 mmol/L is 108 mg/dL)." };
    if (value < 20 || value > 700) return { ok: false, error: "That number looks unlikely. Please check your meter." };
    return { ok: true, row: { ...empty, glucose_mgdl: Math.round(value), glucose_timing: draft.timing } };
  }
  const value = num(draft.weight);
  if (value === null || Number.isNaN(value)) return { ok: false, error: "Add your weight in kg, for example 68.5." };
  if (value < 2 || value > 350) return { ok: false, error: "That weight looks unlikely. Please check it's in kg." };
  return { ok: true, row: { ...empty, weight_kg: Math.round(value * 10) / 10 } };
}

/** The assessment for what's typed so far, shown live under the fields. */
export function assessDraft(draft: ReadingDraft, context: ReadingContext = {}): Assessment | null {
  if (draft.kind === "bp") {
    const top = num(draft.systolic);
    const bottom = num(draft.diastolic);
    if (top === null || bottom === null || Number.isNaN(top) || Number.isNaN(bottom) || top <= bottom || top < 50 || bottom < 30) return null;
    return assessBloodPressure(top, bottom, context);
  }
  if (draft.kind === "sugar") {
    const value = num(draft.sugar);
    if (value === null || Number.isNaN(value) || value < 20 || value > 700 || (value > 1.5 && value < 30)) return null;
    return assessSugar(value, draft.timing, context);
  }
  return null;
}

// ---- Showing saved readings --------------------------------------------------------------------------------------------

type Saved = { bp_systolic?: number | null; bp_diastolic?: number | null; pulse?: number | null; glucose_mgdl?: number | null; glucose_timing?: string | null; weight_kg?: number | string | null };

const TIMING_TEXT: Record<string, string> = { fasting: "fasting", after_meal: "after a meal", random: "" };

/** "BP 138/88 · pulse 76", "Sugar 112 mg/dL, fasting", "Weight 72.4 kg"; null when the entry has no reading. */
export function readingText(entry: Saved): string | null {
  const parts: string[] = [];
  if (entry.bp_systolic != null && entry.bp_diastolic != null) parts.push(`BP ${entry.bp_systolic}/${entry.bp_diastolic}`);
  if (entry.pulse != null) parts.push(`pulse ${entry.pulse}`);
  if (entry.glucose_mgdl != null) {
    const when = entry.glucose_timing ? TIMING_TEXT[entry.glucose_timing] : "";
    parts.push(`Sugar ${entry.glucose_mgdl} mg/dL${when ? `, ${when}` : ""}`);
  }
  if (entry.weight_kg != null && entry.weight_kg !== "") parts.push(`Weight ${Number(entry.weight_kg)} kg`);
  if (!parts.length) return null;
  const text = parts.join(" · ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The band of a saved reading, for the little flag on the diary row. */
export function readingBand(entry: Saved, context: ReadingContext = {}): Assessment | null {
  if (entry.bp_systolic != null && entry.bp_diastolic != null) return assessBloodPressure(entry.bp_systolic, entry.bp_diastolic, context);
  if (entry.glucose_mgdl != null) return assessSugar(entry.glucose_mgdl, (entry.glucose_timing as SugarTiming | null) ?? null, context);
  return null;
}

// ---- The daily reminder on the home screen -------------------------------------------------------------------------------

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/**
 * Which reading to ask for today (DESIGN.md 8.6d), or null: blood pressure for people who saved a blood pressure
 * condition, sugar for people with diabetes, only when nothing of that kind was logged today (in their own time zone),
 * and not after "Not today".
 */
export function readingReminder(
  conditions: string[],
  logs: { logged_at: string; bp_systolic?: number | null; glucose_mgdl?: number | null }[],
  now: Date = new Date(),
  quietDay: string | null = null,
): "bp" | "sugar" | null {
  if (quietDay === dayStamp(now)) return null;
  const today = logs.filter((log) => sameDay(new Date(log.logged_at), now));
  if (conditions.some((item) => TRACKS_BP.test(item)) && !today.some((log) => log.bp_systolic != null)) return "bp";
  if (conditions.some((item) => TRACKS_SUGAR.test(item)) && !today.some((log) => log.glucose_mgdl != null)) return "sugar";
  return null;
}

/** "2026-10-19" in the person's own time zone, for "Not today". */
export function dayStamp(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export const isReadingKind = (value: string | null): value is ReadingKind => value === "bp" || value === "sugar" || value === "weight";

// ---- For the doctor: averages over a period ------------------------------------------------------------------------------

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDay = (iso: string) => {
  const date = new Date(iso);
  return `${date.getDate()} ${MONTH[date.getMonth()]}`;
};
const average = (values: number[]) => Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
const count = (n: number) => `${n} home ${n === 1 ? "reading" : "readings"}`;

/**
 * Home readings over the last `days` days, summed up the way a doctor reads them (DESIGN.md 8.6d): blood pressure as an
 * average with the lowest and highest, sugar by when it was taken, weight from first to last. Oldest data first.
 */
export function readingLines(entries: (Saved & { logged_at: string })[], now: Date = new Date(), days = 14): string[] {
  const since = now.getTime() - days * 86_400_000;
  const inWindow = entries.filter((entry) => new Date(entry.logged_at).getTime() >= since).sort((a, b) => a.logged_at.localeCompare(b.logged_at));
  const lines: string[] = [];

  const bp = inWindow.filter((entry) => entry.bp_systolic != null && entry.bp_diastolic != null) as (Saved & { logged_at: string; bp_systolic: number; bp_diastolic: number })[];
  if (bp.length) {
    const pulses = bp.map((entry) => entry.pulse).filter((value): value is number => value != null);
    const tops = bp.map((entry) => entry.bp_systolic);
    const bottoms = bp.map((entry) => entry.bp_diastolic);
    const lowest = bp.reduce((low, entry) => (entry.bp_systolic < low.bp_systolic ? entry : low));
    const highest = bp.reduce((high, entry) => (entry.bp_systolic > high.bp_systolic ? entry : high));
    lines.push(
      bp.length === 1
        ? `Blood pressure: ${count(1)}, ${tops[0]}/${bottoms[0]} mmHg${pulses.length ? `, pulse ${pulses[0]}` : ""}`
        : `Blood pressure: ${count(bp.length)}, average ${average(tops)}/${average(bottoms)} mmHg (lowest ${lowest.bp_systolic}/${lowest.bp_diastolic}, highest ${highest.bp_systolic}/${highest.bp_diastolic})${pulses.length ? `, pulse average ${average(pulses)}` : ""}`,
    );
  }

  const sugar = inWindow.filter((entry) => entry.glucose_mgdl != null) as (Saved & { logged_at: string; glucose_mgdl: number })[];
  for (const [timing, label] of [["fasting", "fasting"], ["after_meal", "after meals"], [null, "other times"]] as const) {
    const values = sugar.filter((entry) => (timing === null ? entry.glucose_timing !== "fasting" && entry.glucose_timing !== "after_meal" : entry.glucose_timing === timing)).map((entry) => entry.glucose_mgdl);
    if (!values.length) continue;
    lines.push(
      values.length === 1
        ? `Blood sugar, ${label}: ${count(1)}, ${values[0]} mg/dL`
        : `Blood sugar, ${label}: ${count(values.length)}, average ${average(values)} mg/dL (from ${Math.min(...values)} to ${Math.max(...values)})`,
    );
  }

  const weights = inWindow.filter((entry) => entry.weight_kg != null && entry.weight_kg !== "");
  if (weights.length === 1) lines.push(`Weight: ${Number(weights[0]!.weight_kg)} kg (${shortDay(weights[0]!.logged_at)})`);
  if (weights.length > 1) {
    const first = weights[0]!;
    const last = weights[weights.length - 1]!;
    lines.push(`Weight: ${Number(first.weight_kg)} kg on ${shortDay(first.logged_at)}, ${Number(last.weight_kg)} kg on ${shortDay(last.logged_at)}`);
  }
  return lines;
}

/** Blood pressure over the last 7 days: the average and how many readings it comes from, or null with none. */
export function weekAverage(entries: (Saved & { logged_at: string })[], now: Date = new Date()): { systolic: number; diastolic: number; count: number } | null {
  const since = now.getTime() - 7 * 86_400_000;
  const bp = entries.filter((entry) => entry.bp_systolic != null && entry.bp_diastolic != null && new Date(entry.logged_at).getTime() >= since);
  if (!bp.length) return null;
  return { systolic: average(bp.map((entry) => entry.bp_systolic as number)), diastolic: average(bp.map((entry) => entry.bp_diastolic as number)), count: bp.length };
}
