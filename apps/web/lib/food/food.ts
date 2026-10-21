// Thali: what you ate (DESIGN.md 8.6g), as pure helpers so they can be tested without a browser. Erasable TypeScript only.
// A record for the person, Nox and their doctor: no calories, scores or "good" and "bad" food.
import { cleanList } from "../onboarding/settings.ts";

export type Meal = "breakfast" | "lunch" | "snacks" | "dinner";
export type Portion = "light" | "regular" | "heavy";

export const MEALS: { value: Meal; label: string; tone: "butter" | "mint" | "sky" | "lilac" }[] = [
  { value: "breakfast", label: "Breakfast", tone: "butter" },
  { value: "lunch", label: "Lunch", tone: "mint" },
  { value: "snacks", label: "Snacks", tone: "sky" },
  { value: "dinner", label: "Dinner", tone: "lilac" },
];
export const PORTIONS: { value: Portion; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "regular", label: "Regular" },
  { value: "heavy", label: "Heavy" },
];

// Tap-to-add suggestions: everyday Indian food for each meal. Anything else can be typed.
export const SUGGESTIONS: Record<Meal, string[]> = {
  breakfast: ["Poha", "Upma", "Idli", "Dosa", "Paratha", "Bread", "Eggs", "Chai", "Coffee", "Milk", "Fruit"],
  lunch: ["Roti", "Rice", "Dal", "Sabzi", "Curd", "Salad", "Chicken", "Fish", "Paneer", "Rajma"],
  snacks: ["Biscuits", "Namkeen", "Samosa", "Fruit", "Nuts", "Chai", "Juice", "Sweets"],
  dinner: ["Roti", "Rice", "Dal", "Sabzi", "Curd", "Salad", "Chicken", "Fish", "Paneer", "Khichdi"],
};

export const LIMITS = { items: 15, item: 60, note: 200, water: 30 } as const;

export type FoodRow = { id: string; day: string; meal: Meal; items: string[]; portion: Portion | null; outside: boolean; note: string | null };
export type FoodDraft = { items: string[]; portion: Portion | null; outside: boolean; note: string };

export const isMeal = (value: string | null | undefined): value is Meal => MEALS.some((meal) => meal.value === value);
export const mealLabel = (meal: Meal) => MEALS.find((item) => item.value === meal)!.label;

export const draftFrom = (row: FoodRow | null | undefined): FoodDraft => ({
  items: row?.items ?? [],
  portion: row?.portion ?? null,
  outside: row?.outside ?? false,
  note: row?.note ?? "",
});

/** The row to save, or an error to show. The limits match the database. */
export function toFoodRow(draft: FoodDraft, day: string, meal: Meal):
  | { ok: true; row: { day: string; meal: Meal; items: string[]; portion: Portion | null; outside: boolean; note: string | null } }
  | { ok: false; error: string } {
  const items = cleanList(draft.items, LIMITS.items, LIMITS.item);
  const note = draft.note.replace(/\s+/g, " ").trim().slice(0, LIMITS.note) || null;
  if (!items.length && !note) return { ok: false, error: "Add at least one thing you ate, or a note." };
  return { ok: true, row: { day, meal, items, portion: draft.portion, outside: draft.outside, note } };
}

// ---- Days, in the person's own time zone ------------------------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-10-19" for a date in the person's own time zone. */
export function localDay(date: Date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const parse = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
};

/** The day `delta` days before or after. */
export function shiftDay(day: string, delta: number): string {
  const date = parse(day);
  date.setDate(date.getDate() + delta);
  return localDay(date);
}

/** A day from the address, if it's a real date and not in the future; otherwise today. */
export function dayFrom(value: string | null | undefined, now: Date = new Date()): string {
  const today = localDay(now);
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return today;
  const date = parse(value);
  if (Number.isNaN(date.getTime()) || localDay(date) !== value) return today;
  return value > today || value < "2020-01-01" ? today : value;
}

/** "Today, 19 Oct", "Yesterday, 18 Oct", "Sat, 12 Oct". */
export function dayLabel(day: string, now: Date = new Date()): string {
  const date = parse(day);
  const short = `${date.getDate()} ${MONTHS[date.getMonth()]}`;
  const today = localDay(now);
  if (day === today) return `Today, ${short}`;
  if (day === shiftDay(today, -1)) return `Yesterday, ${short}`;
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][date.getDay()];
  return `${weekday}, ${short}${date.getFullYear() === now.getFullYear() ? "" : ` ${date.getFullYear()}`}`;
}

/** What a meal row says under its name: "Poha, Chai · light · outside food", or null when nothing is logged. */
export function mealSummary(row: FoodRow | null | undefined): string | null {
  if (!row) return null;
  const what = row.items.length ? (row.items.length > 3 ? `${row.items.slice(0, 3).join(", ")} +${row.items.length - 3}` : row.items.join(", ")) : row.note;
  const parts = [what, row.portion ? PORTIONS.find((item) => item.value === row.portion)?.label.toLowerCase() : null, row.outside ? "outside food" : null].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}
