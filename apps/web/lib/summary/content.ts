// The visit summary a person shows their doctor (DESIGN.md 8.7). The summary function returns `VisitSummary`; the
// browser stores it, with the person's own notes, in the `summaries` table where they can edit it.
// Pure helpers, tested under Node. Erasable TypeScript only.

/** What a saved summary keeps. The editor uses the same numbers, so nothing typed is cut off silently on save (bug
 * review 2026-10-20). */
export const LIMITS = {
  timeline: { rows: 20, first: 40, second: 300 },
  details: { rows: 15, first: 60, second: 200 },
  medicines: { rows: 20, length: 160 },
  signs: { rows: 15, length: 120 },
  questions: { rows: 12, length: 200 },
} as const;

export type VisitSummary = {
  title: string;
  reason_for_visit: string;
  timeline: { when: string; what: string }[];
  details: { label: string; value: string }[];
  medicines_and_allergies: string[];
  warning_signs: { present: string[]; not_present: string[] };
  questions: string[];
};

export type SummaryContent = {
  version: 1;
  summary: VisitSummary;
  /** Optional: only if the person types a name to print on it. Never filled in for them. */
  for_name: string;
  notes: string;
  conversation_ids: string[];
  prepared_at: string;
  degraded: boolean;
};

const text = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");
const list = (value: unknown, max: number, itemMax: number) =>
  (Array.isArray(value) ? value : []).map((item) => text(item, itemMax)).filter(Boolean).slice(0, max);
const pairs = <K extends string, V extends string>(value: unknown, keys: [K, V], max: number, maxA: number, maxB: number) =>
  (Array.isArray(value) ? value : [])
    .map((item) => {
      const row = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
      return { [keys[0]]: text(row[keys[0]], maxA), [keys[1]]: text(row[keys[1]], maxB) } as Record<K | V, string>;
    })
    .filter((row) => row[keys[0]] || row[keys[1]])
    .slice(0, max);

/** Reads whatever is stored (or returned) into a safe, complete shape. Unknown or oversized parts are dropped. */
export function normalizeSummary(raw: unknown): VisitSummary {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const signs = (value.warning_signs && typeof value.warning_signs === "object" ? value.warning_signs : {}) as Record<string, unknown>;
  return {
    title: text(value.title, 120) || "Visit summary",
    reason_for_visit: text(value.reason_for_visit, 600),
    timeline: pairs(value.timeline, ["when", "what"], LIMITS.timeline.rows, LIMITS.timeline.first, LIMITS.timeline.second) as { when: string; what: string }[],
    details: pairs(value.details, ["label", "value"], LIMITS.details.rows, LIMITS.details.first, LIMITS.details.second) as { label: string; value: string }[],
    medicines_and_allergies: list(value.medicines_and_allergies, LIMITS.medicines.rows, LIMITS.medicines.length),
    warning_signs: { present: list(signs.present, LIMITS.signs.rows, LIMITS.signs.length), not_present: list(signs.not_present, LIMITS.signs.rows, LIMITS.signs.length) },
    questions: list(value.questions, LIMITS.questions.rows, LIMITS.questions.length),
  };
}

export function normalizeContent(raw: unknown): SummaryContent {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    version: 1,
    summary: normalizeSummary(value.summary),
    for_name: text(value.for_name, 80),
    notes: typeof value.notes === "string" ? value.notes.slice(0, 2000) : "",
    conversation_ids: list(value.conversation_ids, 5, 40),
    prepared_at: typeof value.prepared_at === "string" && !Number.isNaN(Date.parse(value.prepared_at)) ? value.prepared_at : new Date(0).toISOString(),
    degraded: value.degraded === true,
  };
}

export function newContent(summary: unknown, conversationIds: string[], preparedAt: string, degraded: boolean): SummaryContent {
  return normalizeContent({ summary, for_name: "", notes: "", conversation_ids: conversationIds, prepared_at: preparedAt, degraded });
}

export function formatPrepared(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}, ${date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

/** The summary as plain text, for "Copy as text". Same order as the printed page. */
export function summaryToText(content: SummaryContent): string {
  const s = content.summary;
  const lines = [`${s.title}`, `Prepared ${formatPrepared(content.prepared_at)}${content.for_name ? ` · For: ${content.for_name}` : ""}`];
  if (s.reason_for_visit) lines.push("", "Why I'm seeing you", s.reason_for_visit);
  if (s.timeline.length) lines.push("", "What's been happening", ...s.timeline.map((row) => `- ${row.when}: ${row.what}`));
  if (s.details.length) lines.push("", "Details", ...s.details.map((row) => `- ${row.label}: ${row.value}`));
  if (s.medicines_and_allergies.length) lines.push("", "Medicines and allergies I mentioned", ...s.medicines_and_allergies.map((item) => `- ${item}`));
  if (s.warning_signs.present.length || s.warning_signs.not_present.length) {
    lines.push("", "Warning signs I checked");
    if (s.warning_signs.present.length) lines.push(`Present: ${s.warning_signs.present.join(", ")}`);
    if (s.warning_signs.not_present.length) lines.push(`Not present: ${s.warning_signs.not_present.join(", ")}`);
  }
  if (s.questions.length) lines.push("", "Questions I want to ask", ...s.questions.map((item) => `[ ] ${item}`));
  if (content.notes.trim()) lines.push("", "My notes", content.notes.trim());
  lines.push("", "Prepared from my own words with Hale. Not a medical record or a diagnosis.");
  return lines.join("\n");
}
