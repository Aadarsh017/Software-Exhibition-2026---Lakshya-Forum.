// "Export everything": the person's own data, read through row-level security, as one JSON file (PLAN.md 7.4).
// Erasable TypeScript; the assembling part is pure and tested.

export type ExportParts = {
  user: { id: string; email: string | null; guest: boolean };
  profile: unknown;
  health_profile: unknown;
  /** Blood results the person typed (accounts only). */
  lab_results?: unknown[];
  /** The health diary (accounts only). */
  health_log?: unknown[];
  /** When each regular medicine is taken, and the ticks (accounts only). */
  medicine_schedule?: unknown[];
  dose_log?: unknown[];
  /** Thali: meals and water (accounts only, DESIGN.md 8.6g). */
  food_log?: unknown[];
  water_log?: unknown[];
  consents: unknown[];
  conversations: unknown[];
  messages: unknown[];
  summaries: unknown[];
  feedback: unknown[];
};

export function buildExport(parts: ExportParts, now: Date): Record<string, unknown> {
  return {
    format: "health-chat-helper-export",
    version: 1,
    exported_at: now.toISOString(),
    note: "Everything stored in your account. Rule ids, usage counts and server logs are not linked to your words and are not included.",
    ...parts,
    counts: {
      conversations: parts.conversations.length,
      messages: parts.messages.length,
      summaries: parts.summaries.length,
      feedback: parts.feedback.length,
      ...(parts.lab_results ? { lab_results: parts.lab_results.length } : {}),
      ...(parts.health_log ? { health_log: parts.health_log.length } : {}),
      ...(parts.medicine_schedule ? { medicine_schedule: parts.medicine_schedule.length } : {}),
      ...(parts.dose_log ? { dose_log: parts.dose_log.length } : {}),
      ...(parts.food_log ? { food_log: parts.food_log.length } : {}),
      ...(parts.water_log ? { water_log: parts.water_log.length } : {}),
    },
  };
}

export function exportFileName(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `hale-export-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
}

type Page = { data: unknown[] | null; error: { message: string } | null };

/** Reads every row of a list, a page at a time (the server returns at most 1,000 rows per request). */
export async function readAll(fetchPage: (from: number, to: number) => PromiseLike<Page>, pageSize = 1000, maxRows = 50_000): Promise<unknown[]> {
  const rows: unknown[] = [];
  for (let from = 0; from < maxRows; from += pageSize) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}
