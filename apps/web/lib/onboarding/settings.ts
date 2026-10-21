// Settings and the optional health profile (DESIGN.md 8.3, onboarding steps 2 and 3).
// Pure helpers, so they can be tested without a browser. Erasable TypeScript only.

export type TextSize = "s" | "m" | "l" | "xl";
export type Language = "en" | "hi";

// Words, not S/M/L/XL: plainer to read, and they still fit four across on a phone (DESIGN.md 8.3).
export const TEXT_SIZES: { value: TextSize; label: string }[] = [
  { value: "s", label: "Small" },
  { value: "m", label: "Medium" },
  { value: "l", label: "Large" },
  { value: "xl", label: "Largest" },
];
export const LANGUAGES: { value: Language; label: string; note: string }[] = [
  { value: "en", label: "English", note: "English" },
  { value: "hi", label: "हिंदी", note: "Hindi" },
];

export const isTextSize = (value: unknown): value is TextSize => value === "s" || value === "m" || value === "l" || value === "xl";
export const isLanguage = (value: unknown): value is Language => value === "en" || value === "hi";

// ---------------------------------------------------------------------------
// Health profile
// ---------------------------------------------------------------------------

export const AGE_RANGES = ["18-24", "25-34", "35-44", "45-54", "55-64", "65-74", "75+"] as const;
export const SEX_AT_BIRTH: { value: string; label: string }[] = [
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "intersex", label: "Intersex" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
];
export const PREGNANCY: { value: string; label: string }[] = [
  { value: "no", label: "No" },
  { value: "yes", label: "Yes" },
  { value: "not_sure", label: "Not sure" },
];

// Suggestions only: tap to add. Wording needs clinician review (PLAN.md 6.12).
export const CONDITION_SUGGESTIONS = ["Diabetes", "High blood pressure", "Asthma", "Thyroid problem", "Heart disease", "Kidney disease", "Epilepsy", "Anxiety or depression"];
export const ALLERGY_SUGGESTIONS = ["Penicillin", "Sulfa drugs", "Aspirin or ibuprofen", "Peanuts", "Shellfish", "Eggs", "Dust", "Latex"];

/** The limits the database enforces (see the health_profile table). */
export const LIMITS = { conditions: 30, allergies: 30, medicines: 50, item: 60 } as const;

/** Trim, drop empties, remove repeats (ignoring case), cap the length of each item and the number of items. */
export function cleanList(items: readonly string[], max: number, itemMax: number = LIMITS.item): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const item = raw.replace(/\s+/g, " ").trim().slice(0, itemMax);
    const key = item.toLowerCase();
    if (!item || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= max) break;
  }
  return out;
}

export type HealthDraft = {
  age_range: string | null;
  sex_at_birth: string | null;
  pregnancy: string | null;
  conditions: string[];
  allergies: string[];
  medicines: string[];
};

export const emptyHealth = (): HealthDraft => ({ age_range: null, sex_at_birth: null, pregnancy: null, conditions: [], allergies: [], medicines: [] });

/** Whether pregnancy is worth asking: not for people who said male. */
export const asksAboutPregnancy = (sex: string | null): boolean => sex !== "male";

/** The row to save. Pregnancy becomes "not_applicable" when it was not asked. Lists are cleaned to the database limits. */
export function toHealthRow(draft: HealthDraft): HealthDraft {
  return {
    age_range: (AGE_RANGES as readonly string[]).includes(draft.age_range ?? "") ? draft.age_range : null,
    sex_at_birth: SEX_AT_BIRTH.some((option) => option.value === draft.sex_at_birth) ? draft.sex_at_birth : null,
    pregnancy: !asksAboutPregnancy(draft.sex_at_birth) ? "not_applicable" : PREGNANCY.some((option) => option.value === draft.pregnancy) ? draft.pregnancy : null,
    conditions: cleanList(draft.conditions, LIMITS.conditions),
    allergies: cleanList(draft.allergies, LIMITS.allergies),
    medicines: cleanList(draft.medicines, LIMITS.medicines),
  };
}

export const hasAnyHealthAnswer = (draft: HealthDraft): boolean =>
  Boolean(draft.age_range || draft.sex_at_birth || draft.pregnancy || draft.conditions.length || draft.allergies.length || draft.medicines.length);
