// Medicines today (DESIGN.md 8.6e): when each regular medicine is taken, what's due now, pills left, and how the ticks
// read for a doctor, as pure helpers so they can be tested without a browser. Erasable TypeScript only.
//
// Never dosing advice: every sentence here is fixed wording, and none says how much to take, to take more, or to leave
// one out. A missed dose only ever gets MISSED_DOSE_LINE.

export type Slot = "morning" | "afternoon" | "evening" | "night";

/** The four times of day, and the hour each one is due from, in the person's own time. */
export const SLOTS: { value: Slot; label: string; from: number }[] = [
  { value: "morning", label: "Morning", from: 5 },
  { value: "afternoon", label: "Afternoon", from: 12 },
  { value: "evening", label: "Evening", from: 17 },
  { value: "night", label: "Night", from: 21 },
];
/** The medicine day changes at 5 AM, so a Night tick at 1 AM counts for the night before. */
export const DAY_STARTS_AT = 5;

export const MISSED_DOSE_LINE = "Missed a dose? Check the label or ask a pharmacist what to do.";
export const PILLS_HINT = "Each tick counts one pill.";
export const SUMMARY_NOTE = "A missing tick can also mean a forgotten tick.";

export const isSlot = (value: unknown): value is Slot => SLOTS.some((slot) => slot.value === value);
const ORDER = SLOTS.map((slot) => slot.value);

/** Known times only, each once, in the order of the day. */
export function cleanSlots(values: unknown): Slot[] {
  if (!Array.isArray(values)) return [];
  return ORDER.filter((slot) => values.includes(slot));
}

export type Schedule = {
  id: string;
  medicine: string;
  slots: Slot[];
  pills_left: number | null;
  /** When the times last changed (set by the database). */
  times_set_at: string;
};
export type Dose = { schedule_id: string; slot: Slot; taken_on: string };

/** What the screens read. */
export const SCHEDULE_COLUMNS = "id, medicine, slots, pills_left, times_set_at";
export const DOSE_COLUMNS = "schedule_id, slot, taken_on";

/** A medicine_schedule row from the database as a Schedule, or null when it makes no sense. */
export function toSchedule(row: Record<string, unknown>): Schedule | null {
  const slots = cleanSlots(row.slots);
  if (typeof row.id !== "string" || typeof row.medicine !== "string" || !slots.length) return null;
  const pills = typeof row.pills_left === "number" ? row.pills_left : null;
  return { id: row.id, medicine: row.medicine, slots, pills_left: pills, times_set_at: typeof row.times_set_at === "string" ? row.times_set_at : new Date(0).toISOString() };
}

// ---- Days and times of day ---------------------------------------------------------------------------------------------

const stamp = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

/** "2026-10-19": the person's medicine day, in their own time zone. Before 5 AM it is still the day before. */
export function doseDay(now: Date = new Date()): string {
  return stamp(new Date(now.getFullYear(), now.getMonth(), now.getDate() - (now.getHours() < DAY_STARTS_AT ? 1 : 0), 12));
}

/** The day `days` after (or before) a "2026-10-19" stamp. */
export function addDays(day: string, days: number): string {
  const [year, month, date] = day.split("-").map(Number) as [number, number, number];
  return stamp(new Date(year, month - 1, date + days, 12));
}

/** The time of day it is now: after 9 PM, and until 5 AM, it is Night. */
export function currentSlot(now: Date = new Date()): Slot {
  const hour = now.getHours();
  if (hour < DAY_STARTS_AT) return "night";
  let current: Slot = "morning";
  for (const slot of SLOTS) if (hour >= slot.from) current = slot.value;
  return current;
}

/** What "Not now" remembers: the medicines stay away until the next time of day starts. */
export function quietStamp(now: Date = new Date()): string {
  return `${doseDay(now)}:${currentSlot(now)}`;
}

const label = (slot: Slot) => SLOTS.find((item) => item.value === slot)?.label ?? slot;
/** "morning, night". */
export const slotsText = (slots: Slot[]) => cleanSlots(slots).map((slot) => label(slot).toLowerCase()).join(", ");

// ---- What's due ----------------------------------------------------------------------------------------------------------

/** A medicine's name as the database matches it: one row per medicine, ignoring case. */
export const medicineKey = (name: string) => name.replace(/\s+/g, " ").trim().toLowerCase();

/** The schedules whose medicine is still on the profile's list (ignoring case), in the list's order. */
export function activeSchedules(schedules: Schedule[], medicines: string[]): Schedule[] {
  const byKey = new Map(schedules.map((schedule) => [medicineKey(schedule.medicine), schedule]));
  return medicines.map((name) => byKey.get(medicineKey(name))).filter((schedule): schedule is Schedule => schedule !== undefined);
}

export type DueDose = { key: string; scheduleId: string; medicine: string; slot: Slot; taken: boolean; earlier: boolean };
export const doseKey = (scheduleId: string, slot: Slot) => `${scheduleId}:${slot}`;

/**
 * Today's doses that are due now or were due earlier today, by time of day and then in the list's order, each with
 * whether it is ticked. Later times of day are not listed yet.
 */
export function dueDoses(schedules: Schedule[], medicines: string[], doses: Dose[], now: Date = new Date()): DueDose[] {
  const today = doseDay(now);
  const current = currentSlot(now);
  const upTo = ORDER.slice(0, ORDER.indexOf(current) + 1);
  const ticked = new Set(doses.filter((dose) => dose.taken_on === today).map((dose) => doseKey(dose.schedule_id, dose.slot)));
  const active = activeSchedules(schedules, medicines);
  const out: DueDose[] = [];
  for (const slot of upTo) {
    for (const schedule of active) {
      if (!schedule.slots.includes(slot)) continue;
      const key = doseKey(schedule.id, slot);
      out.push({ key, scheduleId: schedule.id, medicine: schedule.medicine, slot, taken: ticked.has(key), earlier: slot !== current });
    }
  }
  return out;
}

/** The ticks "Log all as taken" sends for the open doses. */
export function logAllRows(due: DueDose[], now: Date = new Date()): { schedule_id: string; slot: Slot; taken_on: string }[] {
  const today = doseDay(now);
  return due.filter((dose) => !dose.taken).map((dose) => ({ schedule_id: dose.scheduleId, slot: dose.slot, taken_on: today }));
}

// ---- Pills left ----------------------------------------------------------------------------------------------------------

export const PILLS_MAX = 2000;
export const RUNNING_LOW_DAYS = 7;

/** Whole days the pills last at one pill each time, or null without a count. */
export function daysLeft(schedule: Pick<Schedule, "pills_left" | "slots">): number | null {
  if (schedule.pills_left === null || !schedule.slots.length) return null;
  return Math.floor(schedule.pills_left / schedule.slots.length);
}

function lastsFor(schedule: Pick<Schedule, "pills_left" | "slots">): string | null {
  const days = daysLeft(schedule);
  if (days === null) return null;
  if (schedule.pills_left === 0) return "none left by your count";
  if (days === 0) return "less than a day left";
  return `about ${days} ${days === 1 ? "day" : "days"} left`;
}

/** Beside the editor's field: "About 5 days left", or null. */
export function pillsNote(pills: number | null, slots: Slot[]): string | null {
  const text = lastsFor({ pills_left: pills, slots });
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : null;
}

/** The card's "running low" line for medicines with 7 days or fewer left, or null. */
export function runningLow(schedules: Schedule[], threshold: number = RUNNING_LOW_DAYS): string | null {
  const low = schedules.filter((schedule) => {
    const days = daysLeft(schedule);
    return days !== null && days <= threshold;
  });
  if (!low.length) return null;
  if (low.length === 1) return `Running low: ${low[0]!.medicine}, ${lastsFor(low[0]!)}.`;
  return `Running low: ${low.map((schedule) => `${schedule.medicine} (${lastsFor(schedule)})`).join(", ")}.`;
}

/** A typed pill count: empty is no count; otherwise a whole number from 0 to 2000. */
export function parsePills(value: string): { ok: true; pills: number | null } | { ok: false } {
  const text = value.trim();
  if (!text) return { ok: true, pills: null };
  if (!/^\d{1,4}$/.test(text)) return { ok: false };
  const pills = Number(text);
  return pills <= PILLS_MAX ? { ok: true, pills } : { ok: false };
}

// ---- The editor ----------------------------------------------------------------------------------------------------------

/** What the Medicines line holds for each name, by its lower-case key. */
export type TimesDraft = Record<string, { slots: Slot[]; pills: string }>;

export function timesDraft(schedules: Schedule[]): TimesDraft {
  const draft: TimesDraft = {};
  for (const schedule of schedules) draft[medicineKey(schedule.medicine)] = { slots: schedule.slots, pills: schedule.pills_left === null ? "" : String(schedule.pills_left) };
  return draft;
}

export const timesFor = (draft: TimesDraft, medicine: string) => draft[medicineKey(medicine)] ?? { slots: [] as Slot[], pills: "" };

/** The closed Medicines line: "Amlodipine (morning), Metformin (morning, night), Vitamin D". */
export function medicinesLine(medicines: string[], draft: TimesDraft): string {
  if (!medicines.length) return "None added";
  return medicines.map((name) => {
    const slots = timesFor(draft, name).slots;
    return slots.length ? `${name} (${slotsText(slots)})` : name;
  }).join(", ");
}

export type ScheduleRow = { medicine: string; slots: Slot[]; pills_left?: number | null };

/**
 * What one Save writes: a row per medicine with times (the pill count only when it is new or changed, so a tick made
 * meanwhile isn't undone), and the schedules to remove (medicines gone from the list, or left with no time).
 */
export function planSave(medicines: string[], draft: TimesDraft, existing: Schedule[]): { ok: true; rows: ScheduleRow[]; remove: string[] } | { ok: false; error: string } {
  const byKey = new Map(existing.map((schedule) => [medicineKey(schedule.medicine), schedule]));
  const rows: ScheduleRow[] = [];
  const keep = new Set<string>();
  for (const medicine of medicines) {
    const key = medicineKey(medicine);
    const { slots, pills } = timesFor(draft, medicine);
    const clean = cleanSlots(slots);
    if (!clean.length) continue;
    const parsed = parsePills(pills);
    if (!parsed.ok) return { ok: false, error: `Pills left for ${medicine}: a whole number from 0 to ${PILLS_MAX}, or leave it empty.` };
    const before = byKey.get(key);
    const row: ScheduleRow = { medicine, slots: clean };
    if (!before || before.pills_left !== parsed.pills) row.pills_left = parsed.pills;
    rows.push(row);
    keep.add(key);
  }
  const remove = existing.filter((schedule) => !keep.has(medicineKey(schedule.medicine))).map((schedule) => schedule.id);
  return { ok: true, rows, remove };
}

// ---- For the doctor ------------------------------------------------------------------------------------------------------

const PLURAL: Record<Slot, [string, string]> = { morning: ["morning", "mornings"], afternoon: ["afternoon", "afternoons"], evening: ["evening", "evenings"], night: ["night", "nights"] };

/**
 * "Amlodipine: taken 12 of 14 mornings" for each medicine with times, over the last `days` full days (today isn't
 * over), counted only from the day after its times were last set, so a new medicine doesn't read as missed.
 */
export function adherenceLines(schedules: Schedule[], medicines: string[] | null, doses: Dose[], now: Date = new Date(), days = 14): string[] {
  const today = doseDay(now);
  const first = addDays(today, -days);
  const list = medicines ? activeSchedules(schedules, medicines) : schedules;
  const lines: string[] = [];
  for (const schedule of list) {
    const from = [first, addDays(doseDay(new Date(schedule.times_set_at)), 1)].sort().at(-1)!;
    if (from >= today) continue;
    let expected = 0;
    for (let day = from; day < today; day = addDays(day, 1)) expected += 1;
    const parts = schedule.slots.map((slot) => {
      const taken = doses.filter((dose) => dose.schedule_id === schedule.id && dose.slot === slot && dose.taken_on >= from && dose.taken_on < today).length;
      return `${taken} of ${expected} ${PLURAL[slot][expected === 1 ? 0 : 1]}`;
    });
    lines.push(`${schedule.medicine}: taken ${parts.join(", ")}`);
  }
  return lines;
}
