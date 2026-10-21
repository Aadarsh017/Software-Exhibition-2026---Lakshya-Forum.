// Personalization (DESIGN.md 8.6b): what a personal doctor needs to know, as pure helpers so they can be tested
// without a browser. Erasable TypeScript only.
import { cleanList, LIMITS, toHealthRow, type HealthDraft } from "../onboarding/settings.ts";

export type Smoking = "never" | "former" | "current";
export type Alcohol = "none" | "occasional" | "regular";
export type Activity = "low" | "moderate" | "high";

export type PersonalDraft = HealthDraft & {
  height_cm: number | null;
  weight_kg: number | null;
  smoking: Smoking | null;
  alcohol: Alcohol | null;
  activity: Activity | null;
  family_history: string[];
  // The emergency card (DESIGN.md 8.6c). The contact never goes to the AI: the server doesn't read these columns.
  blood_group: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
};

export const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", "unknown"] as const;
const PHONE = /^\+?[0-9][0-9 ()-]{5,19}$/;
/** A phone number the database accepts, or null. */
export const cleanPhone = (value: string | null | undefined): string | null => {
  const phone = (value ?? "").trim();
  return PHONE.test(phone) ? phone : null;
};

export const SMOKING: { value: Smoking; label: string }[] = [
  { value: "never", label: "Never" },
  { value: "former", label: "I used to" },
  { value: "current", label: "Yes, I smoke" },
];
export const ALCOHOL: { value: Alcohol; label: string }[] = [
  { value: "none", label: "None" },
  { value: "occasional", label: "Sometimes" },
  { value: "regular", label: "Most weeks" },
];
export const ACTIVITY: { value: Activity; label: string }[] = [
  // Short, so the three answers sit side by side on a phone (DESIGN.md 8.3). Saved values are unchanged.
  { value: "low", label: "Not much" },
  { value: "moderate", label: "Some" },
  { value: "high", label: "A lot" },
];
// Suggestions only: tap to add. Wording needs clinician review (PLAN.md 6.12).
export const FAMILY_SUGGESTIONS = ["Diabetes", "Heart disease", "High blood pressure", "Stroke", "Cancer", "Thyroid problem", "Asthma", "Mental health conditions"];
export const MEDICINE_SUGGESTIONS = ["Metformin", "Thyroxine", "Amlodipine", "Vitamin D", "Iron tablets", "Birth control pill"];

export const emptyPersonal = (): PersonalDraft => ({
  age_range: null, sex_at_birth: null, pregnancy: null, conditions: [], allergies: [], medicines: [],
  height_cm: null, weight_kg: null, smoking: null, alcohol: null, activity: null, family_history: [],
  blood_group: null, emergency_contact_name: null, emergency_contact_phone: null,
});

const oneOf = <T extends string>(options: { value: T }[], value: unknown): T | null =>
  options.some((option) => option.value === value) ? (value as T) : null;

/** A number from the database (which sends numeric columns as text) or a form field ("72,5" works too). */
export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(String(value).trim().replace(",", "."));
  return Number.isFinite(number) ? number : null;
}

const within = (value: number | null, low: number, high: number) => (value !== null && value >= low && value <= high ? Math.round(value * 10) / 10 : null);

/**
 * What's wrong with a typed height or weight, or null. The database only takes 40–250 cm and 2–350 kg; anything else
 * used to be saved as empty without a word, wiping the old value (bug review 2026-10-20).
 */
export function measureProblem(height: string, weight: string): string | null {
  if (height.trim() && within(toNumber(height), 40, 250) === null) return "Height is in centimetres, between 40 and 250 (for example 165).";
  if (weight.trim() && within(toNumber(weight), 2, 350) === null) return "Weight is in kilograms, between 2 and 350 (for example 62).";
  return null;
}

/** A health_profile row (any columns) as a draft. */
export function fromRow(row: Record<string, unknown> | null): PersonalDraft {
  const base = emptyPersonal();
  if (!row) return base;
  const list = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
  return {
    age_range: typeof row.age_range === "string" ? row.age_range : null,
    sex_at_birth: typeof row.sex_at_birth === "string" ? row.sex_at_birth : null,
    pregnancy: typeof row.pregnancy === "string" ? row.pregnancy : null,
    conditions: list(row.conditions),
    allergies: list(row.allergies),
    medicines: list(row.medicines),
    height_cm: toNumber(row.height_cm),
    weight_kg: toNumber(row.weight_kg),
    smoking: oneOf(SMOKING, row.smoking),
    alcohol: oneOf(ALCOHOL, row.alcohol),
    activity: oneOf(ACTIVITY, row.activity),
    family_history: list(row.family_history),
    blood_group: typeof row.blood_group === "string" && (BLOOD_GROUPS as readonly string[]).includes(row.blood_group) ? row.blood_group : null,
    emergency_contact_name: typeof row.emergency_contact_name === "string" ? row.emergency_contact_name : null,
    emergency_contact_phone: typeof row.emergency_contact_phone === "string" ? row.emergency_contact_phone : null,
  };
}

/** The row to save: everything checked against the database limits (heights 40–250 cm, weights 2–350 kg). */
export function toPersonalRow(draft: PersonalDraft) {
  return {
    ...toHealthRow(draft),
    height_cm: within(draft.height_cm, 40, 250),
    weight_kg: within(draft.weight_kg, 2, 350),
    smoking: oneOf(SMOKING, draft.smoking),
    alcohol: oneOf(ALCOHOL, draft.alcohol),
    activity: oneOf(ACTIVITY, draft.activity),
    family_history: cleanList(draft.family_history, 20, LIMITS.item),
    blood_group: (BLOOD_GROUPS as readonly string[]).includes(draft.blood_group ?? "") ? draft.blood_group : null,
    emergency_contact_name: (draft.emergency_contact_name ?? "").replace(/\s+/g, " ").trim().slice(0, 60) || null,
    emergency_contact_phone: cleanPhone(draft.emergency_contact_phone),
  };
}

export function cardSummary(draft: PersonalDraft): string {
  const parts = [draft.blood_group && draft.blood_group !== "unknown" ? draft.blood_group : null, draft.emergency_contact_name].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Add your blood group and a contact";
}

export function bmi(height: number | null, weight: number | null): number | null {
  if (!height || !weight || height < 40 || weight < 2) return null;
  return Math.round((weight / (height / 100) ** 2) * 10) / 10;
}

/** What a row says under its title. */
export function listSummary(items: string[], empty = "None added"): string {
  if (!items.length) return empty;
  const shown = items.slice(0, 2).join(", ");
  return items.length > 2 ? `${shown} and ${items.length - 2} more` : shown;
}

export function aboutSummary(draft: PersonalDraft): string {
  const sex = draft.sex_at_birth && draft.sex_at_birth !== "prefer_not_to_say" ? draft.sex_at_birth.charAt(0).toUpperCase() + draft.sex_at_birth.slice(1) : null;
  const parts = [draft.age_range, sex, draft.pregnancy === "yes" ? "Pregnant" : null].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Not added";
}

export function bodySummary(draft: PersonalDraft): string {
  const parts = [draft.height_cm ? `${draft.height_cm} cm` : null, draft.weight_kg ? `${draft.weight_kg} kg` : null].filter(Boolean);
  const index = bmi(draft.height_cm, draft.weight_kg);
  if (index) parts.push(`BMI ${index}`);
  return parts.length ? parts.join(" · ") : "Not added";
}

/** The About you row: the name Nox uses, age, sex, height and weight. Empty, it says what's inside. */
export function aboutYouSummary(name: string | null, draft: PersonalDraft): string {
  const about = aboutSummary(draft);
  const body = [draft.height_cm ? `${draft.height_cm} cm` : null, draft.weight_kg ? `${draft.weight_kg} kg` : null].filter(Boolean).join(" · ");
  const parts = [firstName(name), about === "Not added" ? null : about, body || null].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Name, age, sex, height and weight";
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The Health history row: conditions by name, then how many allergies and medicines, and family history. */
export function healthSummary(draft: PersonalDraft): string {
  const conditions = draft.conditions.length ? draft.conditions.slice(0, 2).join(", ") + (draft.conditions.length > 2 ? ` +${draft.conditions.length - 2}` : "") : null;
  const parts = [
    conditions,
    draft.allergies.length ? count(draft.allergies.length, "allergy", "allergies") : null,
    draft.medicines.length ? count(draft.medicines.length, "medicine", "medicines") : null,
    draft.family_history.length ? "family history" : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Conditions, allergies, medicines, family";
}

export function lifestyleSummary(draft: PersonalDraft, empty = "Not added"): string {
  const label = <T extends string>(options: { value: T; label: string }[], value: T | null) => options.find((option) => option.value === value)?.label;
  const parts = [
    draft.smoking ? `Smoking: ${label(SMOKING, draft.smoking)?.toLowerCase()}` : null,
    draft.alcohol ? `Alcohol: ${label(ALCOHOL, draft.alcohol)?.toLowerCase()}` : null,
    draft.activity ? `Activity: ${label(ACTIVITY, draft.activity)?.toLowerCase()}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : empty;
}

/**
 * "2 of 5 done" on the top card, one per row (DESIGN.md 8.6b): About you (name, age and sex; height and weight are
 * optional), Health history (anything in the four lists), Lifestyle, Blood report, Emergency card.
 */
export function completeness(name: string | null, draft: PersonalDraft, labCount: number): { done: number; total: number } {
  const items = [
    Boolean(name?.trim() && draft.age_range && draft.sex_at_birth),
    draft.conditions.length + draft.allergies.length + draft.medicines.length + draft.family_history.length > 0,
    Boolean(draft.smoking || draft.alcohol || draft.activity),
    labCount > 0,
    Boolean(draft.emergency_contact_phone || (draft.blood_group && draft.blood_group !== "unknown")),
  ];
  return { done: items.filter(Boolean).length, total: items.length };
}

/** A name as people expect to see it: as saved, but one saved all in lower case gets capitals ("raunak jain" → "Raunak Jain"). */
export function displayName(name: string | null | undefined): string | null {
  const clean = (name ?? "").trim().replace(/\s+/g, " ");
  if (!clean) return null;
  return clean === clean.toLowerCase() ? clean.replace(/(^|\s)(\p{Ll})/gu, (_match, space: string, letter: string) => space + letter.toUpperCase()) : clean;
}

/** What Nox calls the person: the first word of their name, or null. */
export function firstName(name: string | null | undefined): string | null {
  const first = displayName(name)?.split(" ")[0];
  return first ? first.slice(0, 40) : null;
}
