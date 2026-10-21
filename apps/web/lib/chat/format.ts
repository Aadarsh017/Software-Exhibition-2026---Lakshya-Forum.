// Small pure helpers for showing an answer.
import type { Answer, Claim, Source } from "./types.ts";

/** "S3" -> 3. Sources are shown to people as [1], [2]… */
export function markerNumber(id: string): number {
  const n = Number(id.replace(/^S/i, ""));
  return Number.isFinite(n) ? n : 0;
}

// The personal-doctor voice (DESIGN.md 8.6b).
export const SECTION_TITLES = {
  likely_causes: "What I think is going on",
  try_tonight: "What to do now",
  see_doctor_if: "See a doctor if",
  emergency_if: "Get emergency help if",
  medicines: "Medicines",
} as const;
type SectionKey = keyof typeof SECTION_TITLES;

/** Which sections of the answer cite a source, in reading order. */
export function citedIn(fields: Partial<Answer>, id: string): string[] {
  const out: string[] = [];
  for (const key of Object.keys(SECTION_TITLES) as SectionKey[]) {
    const items = (fields[key] ?? []) as (Claim | { source_ids: string[] })[];
    if (items.some((item) => item.source_ids?.includes(id))) out.push(SECTION_TITLES[key]);
  }
  return out;
}

const bullets = (items: Claim[] | undefined) => (items ?? []).map((item) => `- ${item.text}`);

/** The answer as plain text, for "Copy". Always ends with the disclaimer, and lists the sources by number. */
export function answerToText(fields: Partial<Answer>, sources: Source[]): string {
  const lines: string[] = [];
  if (fields.headline) lines.push(fields.headline);
  if (fields.summary) lines.push("", fields.summary);
  for (const key of ["likely_causes", "try_tonight", "see_doctor_if", "emergency_if"] as const) {
    const list = bullets(fields[key]);
    if (list.length) lines.push("", `${SECTION_TITLES[key]}:`, ...list);
  }
  const medicines = (fields.medicines ?? []).map((m) => `- ${m.name}: ${m.note}`);
  if (medicines.length) lines.push("", `${SECTION_TITLES.medicines}:`, ...medicines);
  if (sources.length) lines.push("", "Sources:", ...sources.map((s) => `[${markerNumber(s.id)}] ${s.title} (${s.publisher}) ${s.url}`));
  lines.push("", "General guidance, not medical advice. In an emergency call 112.");
  return lines.join("\n");
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** What "Listen" reads aloud: the answer in order, without source numbers or web addresses (DESIGN.md 8.6c). */
export function answerToSpeech(fields: Partial<Answer>): string {
  const parts: string[] = [];
  if (fields.headline) parts.push(fields.headline);
  if (fields.summary) parts.push(fields.summary);
  for (const key of ["likely_causes", "try_tonight", "see_doctor_if", "emergency_if"] as const) {
    const items = (fields[key] ?? []).map((claim) => claim.text).filter(Boolean);
    if (items.length) parts.push(`${SECTION_TITLES[key]}: ${items.join(". ")}.`);
  }
  const medicines = (fields.medicines ?? []).map((medicine) => `${medicine.name}. ${medicine.note}`);
  if (medicines.length) parts.push(`${SECTION_TITLES.medicines}: ${medicines.join(" ")}`);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/** What "Share" sends (WhatsApp, SMS…): the copied text, signed, so whoever reads it knows where it came from. */
export function shareText(fields: Partial<Answer>, sources: Source[]): string {
  return `${answerToText(fields, sources)}\nFrom Hale.`;
}

export type NearbyCare = { label: string; query: string };

/**
 * "Find … near you" (DESIGN.md 8.6c): a maps search we only open, so the location never reaches us. A hospital at the
 * emergency levels, a clinic when a doctor visit is advised, a pharmacy when an everyday medicine was suggested.
 */
export function nearbyCare(level: string | undefined, suggestsMedicine: boolean): NearbyCare[] {
  const out: NearbyCare[] = [];
  if (level === "emergency" || level === "ambulance") out.push({ label: "Find the nearest hospital", query: "hospital emergency near me" });
  else if (level === "doctor" || level === "doctor24") out.push({ label: "Find a clinic near you", query: "clinic near me" });
  if (suggestsMedicine && level !== "emergency" && level !== "ambulance") out.push({ label: "Find a pharmacy near you", query: "pharmacy near me" });
  return out;
}

export const mapsSearch = (query: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;

/** "Nox used: your profile · 3 blood results · 5 diary entries · 2 earlier chats" (DESIGN.md 8.6f), or null. */
export function usedLine(used: { profile: boolean; labs: number; diary: number; past: number; food?: number } | null | undefined): string | null {
  if (!used) return null;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const parts = [
    used.profile ? "your profile" : null,
    used.labs ? plural(used.labs, "blood result", "blood results") : null,
    used.diary ? plural(used.diary, "diary entry", "diary entries") : null,
    used.past ? plural(used.past, "earlier chat", "earlier chats") : null,
    used.food ? plural(used.food, "meal", "meals") : null,
  ].filter(Boolean);
  return parts.length ? `Nox used: ${parts.join(" · ")}` : null;
}
