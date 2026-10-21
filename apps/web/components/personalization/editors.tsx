"use client";

import { useEffect, useState, type ReactNode } from "react";
import { AGE_RANGES, ALLERGY_SUGGESTIONS, asksAboutPregnancy, CONDITION_SUGGESTIONS, LIMITS, PREGNANCY, SEX_AT_BIRTH } from "@/lib/onboarding/settings";
import {
  ACTIVITY,
  ALCOHOL,
  BLOOD_GROUPS,
  bmi,
  cleanPhone,
  FAMILY_SUGGESTIONS,
  MEDICINE_SUGGESTIONS,
  SMOKING,
  measureProblem,
  toNumber,
  type Activity,
  type Alcohol,
  type PersonalDraft,
  type Smoking,
} from "@/lib/personalization/profile";
import { medicineKey, medicinesLine, parsePills, pillsNote, PILLS_HINT, SLOTS, timesDraft, timesFor, type Schedule, type Slot, type TimesDraft } from "@/lib/medicines/today";
import { ChoiceGroup, MultiChoiceGroup } from "@/components/onboarding/choice-group";
import { TagInput } from "@/components/onboarding/tag-input";
import { MarginNote } from "@/components/ui/margin-note";

/**
 * One topic per screen (DESIGN.md 8.6b): the page's note at the top, under the page name; the fields in the middle of the
 * space below it (8.3); and a Save button pinned to the bottom.
 */
export function EditorScreen({ intro, children, onSave, saveLabel = "Save" }: { intro: string; children: ReactNode; onSave: () => Promise<string | null>; saveLabel?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="flex flex-1 flex-col"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError(null);
        const failure = await onSave();
        setBusy(false);
        if (failure) setError(failure);
      }}
    >
      <div className="mx-auto w-full max-w-[640px] px-4 pt-3 sm:px-6">
        <MarginNote>{intro}</MarginNote>
      </div>
      <div className="m-auto grid w-full max-w-[640px] grid-cols-1 gap-4 px-4 pt-4 pb-6 sm:px-6">{children}</div>
      <div className="save-bar">
        <div className="mx-auto grid w-full max-w-[640px] grid-cols-1 gap-2 px-4 sm:px-6">
          {error ? (
            <p role="alert" className="m-0 text-[0.875rem] text-[var(--alert-text)]">
              {error}
            </p>
          ) : null}
          <button type="submit" className="btn btn-primary btn-lg w-full" disabled={busy}>
            {busy ? "Saving…" : saveLabel}
          </button>
        </div>
      </div>
    </form>
  );
}

type SaveDraft = (patch: Partial<PersonalDraft>) => Promise<string | null>;

/**
 * About you (DESIGN.md 8.6b, one row per topic): the name Nox uses, then, for accounts, age, sex, pregnancy, height and
 * weight, all on one screen with one Save. A guest gets the name only: health details need an account.
 */
export function AboutYouEditor({
  name,
  draft,
  member,
  onSave,
}: {
  name: string | null;
  draft: PersonalDraft;
  member: boolean;
  onSave: (name: string | null, patch: Partial<PersonalDraft> | null) => Promise<string | null>;
}) {
  const [value, setValue] = useState(name ?? "");
  const [age, setAge] = useState(draft.age_range);
  const [sex, setSex] = useState(draft.sex_at_birth);
  const [pregnancy, setPregnancy] = useState(draft.pregnancy === "not_applicable" ? null : draft.pregnancy);
  const [height, setHeight] = useState(draft.height_cm ? String(draft.height_cm) : "");
  const [weight, setWeight] = useState(draft.weight_kg ? String(draft.weight_kg) : "");
  const index = bmi(toNumber(height), toNumber(weight));
  return (
    <EditorScreen
      intro={
        member
          ? "The basics a doctor asks first."
          : "Nox greets you by this name. Age, sex, height and weight need an account."
      }
      onSave={async () => {
        const problem = member ? measureProblem(height, weight) : null;
        if (problem) return problem;
        return onSave(value.replace(/\s+/g, " ").trim().slice(0, 80) || null, member ? { age_range: age, sex_at_birth: sex, pregnancy, height_cm: toNumber(height), weight_kg: toNumber(weight) } : null);
      }}
    >
      <div>
        <label className="field-label" htmlFor="display-name">
          What should Nox call you?
        </label>
        <input id="display-name" className="field" value={value} maxLength={80} autoComplete="given-name" placeholder="Your first name" onChange={(event) => setValue(event.target.value)} />
        <p className="mt-1.5 mb-0 text-[0.875rem] text-[var(--ink-muted)]">Never sent to the AI service.</p>
      </div>
      {member ? (
        <>
          <ChoiceGroup<string> label="Age range" options={AGE_RANGES.map((range) => ({ value: range, label: range }))} value={age} onChange={setAge} clearable columns={4} wideColumns={7} />
          <ChoiceGroup<string> label="Sex at birth" options={SEX_AT_BIRTH} value={sex} onChange={setSex} clearable columns={2} wideColumns={4} />
          {asksAboutPregnancy(sex) ? <ChoiceGroup<string> label="Are you pregnant?" options={PREGNANCY} value={pregnancy} onChange={setPregnancy} clearable columns={3} /> : null}
          <div className="grid grid-cols-1 gap-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="field-label" htmlFor="height">
                  Height (cm)
                </label>
                <input id="height" className="field" inputMode="decimal" placeholder="170" value={height} onChange={(event) => setHeight(event.target.value)} />
              </div>
              <div>
                <label className="field-label" htmlFor="weight">
                  Weight (kg)
                </label>
                <input id="weight" className="field" inputMode="decimal" placeholder="65" value={weight} onChange={(event) => setWeight(event.target.value)} />
              </div>
            </div>
            <p className="m-0 text-[0.875rem] text-[var(--ink-muted)]" role="status">
              {index ? (
                <>
                  Your BMI is <strong className="text-[var(--ink)]">{index}</strong>, a rough guide only.
                </>
              ) : (
                "Optional. Add both to see your BMI."
              )}
            </p>
          </div>
        </>
      ) : null}
    </EditorScreen>
  );
}

const LISTS = {
  conditions: { label: "Long-term conditions", hint: "Such as diabetes or asthma. Nox mentions them when they matter.", suggestions: CONDITION_SUGGESTIONS, max: LIMITS.conditions, placeholder: "Type one and press Enter" },
  allergies: { label: "Allergies", hint: "Medicines, foods or anything else. Nox never suggests a medicine you're allergic to.", suggestions: ALLERGY_SUGGESTIONS, max: LIMITS.allergies, placeholder: "Type one and press Enter" },
  medicines: { label: "Medicines you take regularly", hint: "So Nox can warn you when an everyday medicine doesn't mix with yours.", suggestions: MEDICINE_SUGGESTIONS, max: LIMITS.medicines, placeholder: "Type a medicine and press Enter" },
  family_history: { label: "In your close family", hint: "What your parents, brothers or sisters have had. Some conditions run in families.", suggestions: FAMILY_SUGGESTIONS, max: 20, placeholder: "Type one and press Enter" },
} as const;
export type ListField = keyof typeof LISTS;
const LIST_FIELDS = Object.keys(LISTS) as ListField[];
export const isListField = (value: string | null): value is ListField => value !== null && value in LISTS;

const SLOT_CHIPS = SLOTS.map((slot) => ({ value: slot.value, label: slot.label }));

/** One medicine's times of day as an even row of four chips, and an optional pill count (DESIGN.md 8.6e). */
function MedicineTimes({ name, slots, pills, onChange }: { name: string; slots: Slot[]; pills: string; onChange: (next: { slots: Slot[]; pills: string }) => void }) {
  const count = parsePills(pills);
  const note = slots.length && count.ok ? pillsNote(count.pills, slots) : null;
  return (
    <div className="med-times">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <p className="m-0 min-w-0 truncate font-bold">{name}</p>
        <label className="flex flex-none items-center gap-2 text-[0.875rem] text-[var(--ink-muted)]">
          Pills left
          <input className="field pills-field" inputMode="numeric" maxLength={4} placeholder="—" value={pills} aria-label={`Pills left of ${name} (optional)`} onChange={(event) => onChange({ slots, pills: event.target.value })} />
        </label>
      </div>
      <MultiChoiceGroup<Slot> label={`When you take ${name}`} hideLabel options={SLOT_CHIPS} values={slots} onChange={(next) => onChange({ slots: next, pills })} columns={4} />
      {note ? (
        <p className="m-0 text-[0.875rem] text-[var(--ink-muted)]" role="status">
          {note}. {PILLS_HINT}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Health history (DESIGN.md 8.6b, one row per topic): the four lists on one screen with one Save. Each list is one line,
 * like a line in a notebook; only the open one shows its suggestions and input, so the page fits its frame (8.3). The
 * Medicines line also holds when each one is taken (8.6e), saved with the same Save.
 */
export function HealthHistoryEditor({
  draft,
  schedules,
  initialOpen = null,
  onSave,
}: {
  draft: PersonalDraft;
  schedules: Schedule[];
  initialOpen?: ListField | null;
  onSave: (patch: Partial<PersonalDraft>, times: TimesDraft) => Promise<string | null>;
}) {
  const [lists, setLists] = useState<Record<ListField, string[]>>({
    conditions: draft.conditions,
    allergies: draft.allergies,
    medicines: draft.medicines,
    family_history: draft.family_history,
  });
  const [times, setTimes] = useState<TimesDraft>(() => timesDraft(schedules));
  // The line asked for opens (a link from the home screen), else the first empty list; when all have something, none does.
  const [open, setOpen] = useState<ListField | null>(initialOpen ?? LIST_FIELDS.find((field) => draft[field].length === 0) ?? null);
  // From the home card's "Set times": the times are what the person came for, so they start in view.
  useEffect(() => {
    if (initialOpen === "medicines") document.getElementById("med-times-title")?.scrollIntoView({ block: "start" });
  }, [initialOpen]);
  return (
    <EditorScreen intro="What you live with, react to and take. Nox checks these before it suggests any medicine." onSave={() => onSave(lists, times)}>
      <div className="grid grid-cols-1">
        {LIST_FIELDS.map((field) => {
          const spec = LISTS[field];
          const values = lists[field];
          return (
            <div key={field} className="list-line">
              {open === field ? (
                <>
                  <TagInput
                    label={spec.label}
                    hint={spec.hint}
                    values={values}
                    onChange={(next) => setLists((current) => ({ ...current, [field]: next }))}
                    suggestions={[...spec.suggestions]}
                    max={spec.max}
                    placeholder={spec.placeholder}
                  />
                  {field === "medicines" && values.length ? (
                    <div className="grid gap-3 pt-1" role="group" aria-labelledby="med-times-title">
                      <div>
                        <p id="med-times-title" className="m-0 font-bold">
                          When you take them
                        </p>
                        <p className="m-0 text-[0.875rem] text-[var(--ink-muted)]">Optional. You tick them on your home screen.</p>
                      </div>
                      {values.map((name) => {
                        const current = timesFor(times, name);
                        return <MedicineTimes key={name} name={name} slots={current.slots} pills={current.pills} onChange={(next) => setTimes((all) => ({ ...all, [medicineKey(name)]: next }))} />;
                      })}
                    </div>
                  ) : null}
                  <button type="button" className="btn btn-compact justify-self-start" onClick={() => setOpen(null)}>
                    Done
                  </button>
                </>
              ) : (
                <>
                  <div className="flex items-center justify-between gap-3">
                    <p className="m-0 font-bold">{spec.label}</p>
                    <button type="button" className="btn btn-compact flex-none" aria-expanded="false" aria-label={`${values.length ? "Change" : "Add"} ${spec.label.toLowerCase()}`} onClick={() => setOpen(field)}>
                      {values.length ? "Change" : "Add"}
                    </button>
                  </div>
                  <p className="m-0 text-[0.9375rem] text-[var(--ink-muted)]">{field === "medicines" ? medicinesLine(values, times) : values.length ? values.join(", ") : "None added"}</p>
                </>
              )}
            </div>
          );
        })}
      </div>
    </EditorScreen>
  );
}

export function LifestyleEditor({ draft, onSave }: { draft: PersonalDraft; onSave: SaveDraft }) {
  const [smoking, setSmoking] = useState<Smoking | null>(draft.smoking);
  const [alcohol, setAlcohol] = useState<Alcohol | null>(draft.alcohol);
  const [activity, setActivity] = useState<Activity | null>(draft.activity);
  return (
    <EditorScreen intro="Honest answers help Nox give advice that fits your life. Nobody else sees them." onSave={() => onSave({ smoking, alcohol, activity })}>
      {/* One card per question, its three answers side by side in one even row (founder, 2026-10-19). */}
      <div className="card p-4">
        <ChoiceGroup<Smoking> label="Do you smoke?" options={SMOKING} value={smoking} onChange={setSmoking} clearable columns={3} />
      </div>
      <div className="card p-4">
        <ChoiceGroup<Alcohol> label="Alcohol" options={ALCOHOL} value={alcohol} onChange={setAlcohol} clearable columns={3} />
      </div>
      <div className="card p-4">
        <ChoiceGroup<Activity> label="How active are you?" options={ACTIVITY} value={activity} onChange={setActivity} clearable columns={3} />
      </div>
    </EditorScreen>
  );
}

const telOf = (phone: string) => `tel:${phone.replace(/[^+0-9]/g, "")}`;

/**
 * The emergency card (DESIGN.md 8.6c): what a doctor or paramedic needs if you can't speak for yourself, on one
 * high-contrast card, with an emergency contact. The contact stays in the account: the server never reads it.
 */
export function EmergencyCardEditor({ draft, name, onSave }: { draft: PersonalDraft; name: string | null; onSave: SaveDraft }) {
  const [blood, setBlood] = useState<string | null>(draft.blood_group);
  const [contact, setContact] = useState(draft.emergency_contact_name ?? "");
  const [phone, setPhone] = useState(draft.emergency_contact_phone ?? "");
  const list = (items: string[]) => (items.length ? items.join(", ") : "None saved");
  return (
    <EditorScreen
      intro="Show this to a doctor or paramedic if you can't speak. The number never goes to the AI."
      saveLabel="Save my card"
      onSave={async () => {
        if (phone.trim() && !cleanPhone(phone)) return "That phone number doesn't look right. Use digits, for example +91 98765 43210.";
        return onSave({ blood_group: blood, emergency_contact_name: contact.trim() || null, emergency_contact_phone: phone.trim() || null });
      }}
    >
      <section className="ice-card" aria-label="Your emergency card">
        <p className="ice-label">Emergency card</p>
        <p className="ice-name">{name?.trim() || "Your name"}</p>
        <dl className="ice-list">
          <dt>Blood group</dt>
          <dd>{blood && blood !== "unknown" ? blood : "Not known"}</dd>
          <dt>Allergies</dt>
          <dd>{list(draft.allergies)}</dd>
          <dt>Conditions</dt>
          <dd>{list(draft.conditions)}</dd>
          <dt>Regular medicines</dt>
          <dd>{list(draft.medicines)}</dd>
          <dt>Emergency contact</dt>
          <dd>{contact.trim() ? (cleanPhone(phone) ? <a href={telOf(phone)}>{`${contact.trim()}, ${phone.trim()}`}</a> : contact.trim()) : "None saved"}</dd>
        </dl>
      </section>
      <ChoiceGroup<string> label="Blood group" options={BLOOD_GROUPS.map((group) => ({ value: group, label: group === "unknown" ? "Not sure" : group }))} value={blood} onChange={setBlood} clearable columns={5} />
      <div className="grid grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)] gap-3">
        <div>
          <label className="field-label" htmlFor="ice-name">
            Emergency contact
          </label>
          <input id="ice-name" className="field" value={contact} maxLength={60} placeholder="For example, Mum" onChange={(event) => setContact(event.target.value)} />
        </div>
        <div>
          <label className="field-label" htmlFor="ice-phone">
            Their phone
          </label>
          <input id="ice-phone" className="field" type="tel" inputMode="tel" autoComplete="tel" value={phone} placeholder="+91 98765…" onChange={(event) => setPhone(event.target.value)} />
        </div>
      </div>
    </EditorScreen>
  );
}
