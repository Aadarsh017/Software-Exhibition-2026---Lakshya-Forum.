"use client";

import {
  AGE_RANGES,
  ALLERGY_SUGGESTIONS,
  asksAboutPregnancy,
  CONDITION_SUGGESTIONS,
  LIMITS,
  PREGNANCY,
  SEX_AT_BIRTH,
  type HealthDraft,
} from "@/lib/onboarding/settings";
import { Toggle } from "@/components/ui/toggle";
import { ChoiceGroup } from "./choice-group";
import { TagInput } from "./tag-input";

/** The optional health details (onboarding step 3, and Settings). Fields only: the caller saves. */
export function HealthFields({
  draft,
  onChange,
  useInAnswers,
  onUseInAnswers,
}: {
  draft: HealthDraft;
  onChange: (draft: HealthDraft) => void;
  useInAnswers: boolean;
  onUseInAnswers: (value: boolean) => void;
}) {
  const update = (patch: Partial<HealthDraft>) => onChange({ ...draft, ...patch });
  return (
    <div className="grid gap-5">
      <details className="text-[0.9375rem]">
        <summary className="cursor-pointer select-none font-semibold">Why we ask</summary>
        <ul className="mt-2 grid list-disc gap-1.5 pl-5">
          <li>Age and pregnancy change how careful I should be, for example with children and older adults.</li>
          <li>Conditions, allergies and medicines let me say when one of them matters for your question.</li>
          <li>They are saved in your private account and sent to the AI service with your questions only while &ldquo;Use this in my answers&rdquo; is on.</li>
        </ul>
      </details>

      <ChoiceGroup<string> label="Age range" options={AGE_RANGES.map((range) => ({ value: range, label: range }))} value={draft.age_range} onChange={(value) => update({ age_range: value })} clearable />
      <ChoiceGroup<string>
        label="Sex at birth"
        options={SEX_AT_BIRTH}
        value={draft.sex_at_birth}
        onChange={(value) => update({ sex_at_birth: value, pregnancy: value === "male" ? "not_applicable" : draft.pregnancy === "not_applicable" ? null : draft.pregnancy })}
        clearable
      />
      {asksAboutPregnancy(draft.sex_at_birth) ? (
        <ChoiceGroup<string> label="Are you pregnant?" options={PREGNANCY} value={draft.pregnancy === "not_applicable" ? null : draft.pregnancy} onChange={(value) => update({ pregnancy: value })} clearable />
      ) : null}

      <TagInput label="Long-term conditions" values={draft.conditions} onChange={(conditions) => update({ conditions })} suggestions={CONDITION_SUGGESTIONS} max={LIMITS.conditions} placeholder="Type one and press Enter" />
      <TagInput label="Allergies" values={draft.allergies} onChange={(allergies) => update({ allergies })} suggestions={ALLERGY_SUGGESTIONS} max={LIMITS.allergies} placeholder="Type one and press Enter" />
      <TagInput
        label="Medicines you take regularly"
        values={draft.medicines}
        onChange={(medicines) => update({ medicines })}
        max={LIMITS.medicines}
        placeholder="Type a medicine and press Enter"
        hint="Names only. I will never tell you how much to take."
      />

      <Toggle label="Use this in my answers" checked={useInAnswers} onChange={onUseInAnswers} />
    </div>
  );
}
