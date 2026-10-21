// The Blood report screen (DESIGN.md 8.6b): turning what the person typed into rows, and saying how the latest
// values look. The markers, units and ranges come from @hch/shared/labs, the same list the server uses.
// Erasable TypeScript only.
import { LAB_MARKERS, labFlag, latestPerMarker, type LabFlag } from "@hch/shared/labs";
import { toNumber } from "./profile.ts";

export type LabRecord = { id: string; marker: string; label: string | null; value: number | string; unit: string; test_date: string };
export type LabEntry = { marker: string; label: string; value: string; unit: string };

export const FLAG_LABEL: Record<LabFlag, string> = { low: "Low", high: "High", in_range: "In range" };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-09-12" → "12 Sep 2026", without time zones moving the day. */
export function formatDay(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return iso;
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

/** Today in the person's own time zone, as the date input wants it. */
export function today(now: Date = new Date()): string {
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

/** The empty form: one line per known marker, in its main unit. */
export function blankEntries(): LabEntry[] {
  return LAB_MARKERS.map((marker) => ({ marker: marker.key, label: "", value: "", unit: marker.units[0]?.unit ?? "" }));
}

/** The rows to save from the form: only lines with a number, "other" lines only with a name and a unit. */
export function toLabRows(entries: LabEntry[], testDate: string): { marker: string; label: string | null; value: number; unit: string; test_date: string }[] {
  const rows = [];
  for (const entry of entries) {
    const value = toNumber(entry.value);
    if (value === null || value < 0 || value >= 1_000_000) continue;
    const unit = entry.unit.trim().slice(0, 20);
    if (entry.marker === "other") {
      const label = entry.label.replace(/\s+/g, " ").trim().slice(0, 60);
      if (!label || !unit) continue;
      rows.push({ marker: "other", label, value, unit, test_date: testDate });
    } else if (unit) {
      rows.push({ marker: entry.marker, label: null, value, unit, test_date: testDate });
    }
  }
  return rows;
}

/** What the Blood report row says: "2 to look at · 12 Sep 2026", "All in range · …", or an invitation. */
export function bloodSummary(rows: LabRecord[], sex: string | null): string {
  if (!rows.length) return "Add your latest report";
  const latest = latestPerMarker(rows);
  const newest = rows.reduce((best, row) => (row.test_date > best ? row.test_date : best), rows[0]?.test_date ?? "");
  const flagged = latest.filter((row) => {
    const flag = labFlag(row, sex);
    return flag === "low" || flag === "high";
  }).length;
  const state = flagged ? `${flagged} to look at` : latest.some((row) => labFlag(row, sex)) ? "All in range" : `${latest.length} saved`;
  return `${state} · ${formatDay(newest)}`;
}
