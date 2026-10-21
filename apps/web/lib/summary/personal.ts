// What the doctor summary adds from the person's own records (DESIGN.md 8.6c): about me, recent blood results, the
// diary and, since 8.6e, how often each regular medicine was ticked. Research note (PLAN.md §12): a diary helps mostly
// when it reaches the consultation, so it goes on the page. Straight from what the person saved, no AI. Erasable
// TypeScript only.
import { findMarker, labFlag, latestPerMarker } from "@hch/shared/labs";
import { FLAG_LABEL, formatDay, type LabRecord } from "../personalization/labs.ts";

/** "2026-10-20" for a timestamp, in the device's own time zone. */
export function localDayOf(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
import { timeOf, type DiaryRecord } from "../diary/diary.ts";
import { readingLines, readingText } from "../diary/readings.ts";
import { aboutSummary, bodySummary, type PersonalDraft } from "../personalization/profile.ts";
import { adherenceLines, SUMMARY_NOTE, type Dose, type Schedule } from "../medicines/today.ts";

export type PersonalSections = { about: string[]; blood: string[]; readings: string[]; medicines: string[]; diary: string[] };
/** Medicines with times and their ticks (DESIGN.md 8.6e). */
export type MedicineRecords = { schedules: Schedule[]; doses: Dose[] };

const FEELING: Record<string, string> = { better: "better", same: "about the same", worse: "worse" };

export function aboutLines(profile: PersonalDraft | null): string[] {
  if (!profile) return [];
  const lines: string[] = [];
  const about = aboutSummary(profile);
  if (about !== "Not added") lines.push(`Age and sex: ${about}`);
  const body = bodySummary(profile);
  if (body !== "Not added") lines.push(`Height and weight: ${body}`);
  if (profile.blood_group && profile.blood_group !== "unknown") lines.push(`Blood group: ${profile.blood_group}`);
  if (profile.conditions.length) lines.push(`Long-term conditions: ${profile.conditions.join(", ")}`);
  if (profile.allergies.length) lines.push(`Allergies: ${profile.allergies.join(", ")}`);
  if (profile.medicines.length) lines.push(`Regular medicines: ${profile.medicines.join(", ")}`);
  if (profile.family_history.length) lines.push(`In my family: ${profile.family_history.join(", ")}`);
  return lines;
}

export function bloodLines(labs: LabRecord[], sex: string | null): string[] {
  return latestPerMarker(labs).slice(0, 16).map((row) => {
    const marker = findMarker(row.marker);
    const flag = labFlag(row, sex);
    return `${marker?.label ?? row.label}: ${Number(row.value)} ${row.unit} (${formatDay(row.test_date)})${flag ? `, ${FLAG_LABEL[flag].toLowerCase()}` : ""}`;
  });
}

/** The last two weeks of the diary, newest first, at most 14 lines. */
export function diaryLines(entries: DiaryRecord[], now: Date = new Date(), days = 14): string[] {
  const since = now.getTime() - days * 86_400_000;
  return [...entries]
    .filter((entry) => new Date(entry.logged_at).getTime() >= since)
    .sort((a, b) => b.logged_at.localeCompare(a.logged_at))
    .slice(0, 14)
    .map((entry) => {
      const parts = [
        entry.symptom,
        entry.severity !== null ? `${entry.severity}/10` : null,
        entry.temperature_c !== null ? `${Number(entry.temperature_c)} °C` : null,
        readingText(entry),
        entry.feeling ? FEELING[entry.feeling] : null,
        entry.note,
      ].filter(Boolean);
      // The person's own calendar day for a moment in time (bug review 2026-10-20): slicing the stored UTC text put
      // anything logged between midnight and 05:30 in India on the day before.
      return `${formatDay(localDayOf(entry.logged_at))} ${timeOf(entry.logged_at)}: ${parts.join(", ")}`;
    });
}

export function personalSections(profile: PersonalDraft | null, labs: LabRecord[], diary: DiaryRecord[], now: Date = new Date(), medicines: MedicineRecords | null = null): PersonalSections {
  return {
    about: aboutLines(profile),
    blood: bloodLines(labs, profile?.sex_at_birth ?? null),
    readings: readingLines(diary, now),
    // Only medicines still on the profile's list; a missing tick may be a forgotten tick (said under the lines).
    medicines: medicines ? adherenceLines(medicines.schedules, profile?.medicines ?? [], medicines.doses, now) : [],
    diary: diaryLines(diary, now),
  };
}

export const MEDICINES_HEADING = "My medicines, last 2 weeks (ticked in Hale)";
export { SUMMARY_NOTE as MEDICINES_NOTE };

/** The same, for "Copy as text". */
export function personalToText(sections: PersonalSections): string {
  const out: string[] = [];
  if (sections.about.length) out.push("About me:", ...sections.about.map((line) => `- ${line}`));
  if (sections.blood.length) out.push("", "My recent blood results (typed from my reports):", ...sections.blood.map((line) => `- ${line}`));
  if (sections.readings.length) out.push("", "My home readings, last 2 weeks:", ...sections.readings.map((line) => `- ${line}`));
  if (sections.medicines.length) out.push("", `${MEDICINES_HEADING}:`, ...sections.medicines.map((line) => `- ${line}`), SUMMARY_NOTE);
  if (sections.diary.length) out.push("", "My health diary, last 2 weeks:", ...sections.diary.map((line) => `- ${line}`));
  return out.join("\n");
}
