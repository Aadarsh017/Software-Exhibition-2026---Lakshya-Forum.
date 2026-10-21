// The health diary and check-ins (DESIGN.md 8.6c), as pure helpers so they can be tested without a browser.
// Erasable TypeScript only.

export type Feeling = "better" | "same" | "worse";
export const FEELINGS: { value: Feeling; label: string }[] = [
  { value: "better", label: "Better" },
  { value: "same", label: "Same" },
  { value: "worse", label: "Worse" },
];

export type DiaryRecord = {
  id: string;
  logged_at: string;
  symptom: string | null;
  severity: number | null;
  temperature_c: number | string | null;
  feeling: Feeling | null;
  note: string | null;
  conversation_id: string | null;
  // Home readings (DESIGN.md 8.6d). Optional so older rows and tests without them still fit.
  bp_systolic?: number | null;
  bp_diastolic?: number | null;
  pulse?: number | null;
  glucose_mgdl?: number | null;
  glucose_timing?: "fasting" | "after_meal" | "random" | null;
  weight_kg?: number | string | null;
};

/** Every diary column the screens read and write. */
export const DIARY_COLUMNS = "id, logged_at, symptom, severity, temperature_c, feeling, note, conversation_id, bp_systolic, bp_diastolic, pulse, glucose_mgdl, glucose_timing, weight_kg";

export type DiaryDraft = { symptom: string; severity: number | null; temperature: string; feeling: Feeling | null; note: string };
export const emptyDraft = (): DiaryDraft => ({ symptom: "", severity: null, temperature: "", feeling: null, note: "" });

export const COMMON_SYMPTOMS = ["Fever", "Headache", "Cough", "Sore throat", "Stomach ache", "Tiredness", "Back pain", "Low mood"];

const clean = (text: string, max: number) => text.replace(/\s+/g, " ").trim().slice(0, max);

/** The row to save, or an error to show. Temperatures are in °C between 34 and 43 (the database checks the same). */
export function toDiaryRow(draft: DiaryDraft, conversationId: string | null = null):
  | { ok: true; row: { symptom: string | null; severity: number | null; temperature_c: number | null; feeling: Feeling | null; note: string | null; conversation_id: string | null } }
  | { ok: false; error: string } {
  const symptom = clean(draft.symptom, 60) || null;
  const note = clean(draft.note, 280) || null;
  const raw = draft.temperature.trim().replace(",", ".");
  let temperature: number | null = null;
  if (raw) {
    const value = Number(raw);
    if (!Number.isFinite(value)) return { ok: false, error: "The temperature should be a number, like 38.2." };
    // Someone may type Fahrenheit: say so rather than saving a wrong value.
    if (value >= 93 && value <= 110) return { ok: false, error: "That looks like °F. Please enter °C (for example 38.2)." };
    if (value < 34 || value > 43) return { ok: false, error: "The temperature should be between 34 and 43 °C." };
    temperature = Math.round(value * 10) / 10;
  }
  const severity = draft.severity !== null && draft.severity >= 0 && draft.severity <= 10 ? Math.round(draft.severity) : null;
  if (!symptom && severity === null && temperature === null && !draft.feeling && !note) return { ok: false, error: "Add at least one thing: how you feel, a symptom, or a temperature." };
  return { ok: true, row: { symptom, severity, temperature_c: temperature, feeling: draft.feeling, note, conversation_id: conversationId } };
}

const DAY = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayKey = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;

/** Entries by day, newest first: "Today", "Yesterday", then "12 Oct". In the person's own time zone. */
export function groupByDay<T extends { logged_at: string }>(entries: T[], now: Date = new Date()): { label: string; items: T[] }[] {
  const today = dayKey(now);
  const yesterday = dayKey(new Date(now.getTime() - DAY));
  const groups = new Map<string, { label: string; items: T[] }>();
  const sorted = [...entries].sort((a, b) => b.logged_at.localeCompare(a.logged_at));
  for (const entry of sorted) {
    const when = new Date(entry.logged_at);
    const key = dayKey(when);
    const label = key === today ? "Today" : key === yesterday ? "Yesterday" : `${when.getDate()} ${MONTHS[when.getMonth()]}${when.getFullYear() === now.getFullYear() ? "" : ` ${when.getFullYear()}`}`;
    const group = groups.get(key) ?? { label, items: [] };
    group.items.push(entry);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** Temperatures from the last `days` days, oldest first, for the little line chart. */
export function temperatureSeries(entries: DiaryRecord[], now: Date = new Date(), days = 14): { at: number; value: number }[] {
  const since = now.getTime() - days * DAY;
  return entries
    .map((entry) => ({ at: new Date(entry.logged_at).getTime(), value: Number(entry.temperature_c) }))
    .filter((point) => point.at >= since && Number.isFinite(point.value) && point.value >= 34 && point.value <= 43)
    .sort((a, b) => a.at - b.at);
}

export type Trend = "temperature" | "bp" | "sugar" | "weight";
// Short, so up to four sit in one row on a phone; `name` is for the chart's title and screen readers.
export const TRENDS: { value: Trend; label: string; name: string }[] = [
  { value: "temperature", label: "Temp", name: "Temperature" },
  { value: "bp", label: "BP", name: "Blood pressure" },
  { value: "sugar", label: "Sugar", name: "Blood sugar" },
  { value: "weight", label: "Weight", name: "Weight" },
];

/**
 * The points for one chart over the last `days` days, oldest first (DESIGN.md 8.6d). Blood pressure has two lines: the
 * top number in `value`, the bottom one in `low`.
 */
export function trendSeries(entries: DiaryRecord[], trend: Trend, now: Date = new Date(), days = 14): { at: number; value: number; low?: number }[] {
  if (trend === "temperature") return temperatureSeries(entries, now, days);
  const since = now.getTime() - days * DAY;
  const points: { at: number; value: number; low?: number }[] = [];
  for (const entry of entries) {
    const at = new Date(entry.logged_at).getTime();
    if (at < since) continue;
    if (trend === "bp" && entry.bp_systolic != null && entry.bp_diastolic != null) points.push({ at, value: entry.bp_systolic, low: entry.bp_diastolic });
    if (trend === "sugar" && entry.glucose_mgdl != null) points.push({ at, value: entry.glucose_mgdl });
    if (trend === "weight" && entry.weight_kg != null && entry.weight_kg !== "") points.push({ at, value: Number(entry.weight_kg) });
  }
  return points.sort((a, b) => a.at - b.at);
}

/** The charts worth drawing: at least two points in the window. */
export function availableTrends(entries: DiaryRecord[], now: Date = new Date()): Trend[] {
  return TRENDS.map((trend) => trend.value).filter((trend) => trendSeries(entries, trend, now).length >= 2);
}

export type CheckInChat = { id: string; title: string | null; max_care_level: string | null; updated_at: string };

/**
 * The chat to check in on: the newest one about a problem (it has a care level) that is between 8 hours and 4 days
 * old, with nothing logged for it since, and not waved away. One at a time.
 */
export function checkInFor(
  chats: CheckInChat[],
  logs: { logged_at: string; conversation_id: string | null }[],
  now: Date = new Date(),
  dismissed: ReadonlySet<string> = new Set(),
): CheckInChat | null {
  const nowMs = now.getTime();
  const candidates = chats
    .filter((chat) => chat.max_care_level !== null && !dismissed.has(chat.id))
    .filter((chat) => {
      const age = nowMs - new Date(chat.updated_at).getTime();
      return age >= 8 * 3_600_000 && age <= 4 * DAY;
    })
    .filter((chat) => !logs.some((log) => log.conversation_id === chat.id && log.logged_at >= chat.updated_at))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return candidates[0] ?? null;
}

/** What a check-in sends into the chat, so Nox answers it as a follow-up. */
export function checkInMessage(feeling: Feeling): string {
  return feeling === "better" ? "Update: it's better now." : feeling === "same" ? "Update: it's about the same." : "Update: it's worse now.";
}

/** "08:10" in the person's own time. */
/** When the person told Nox about a problem, by calendar day (bug review 2026-10-20: this morning's chat said "yesterday"). */
export function checkInWhen(iso: string, now: Date = new Date()): string {
  const day = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((day(now) - day(new Date(iso))) / 86_400_000);
  return days <= 0 ? "earlier today" : days === 1 ? "yesterday" : `${days} days ago`;
}

export function timeOf(iso: string): string {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
