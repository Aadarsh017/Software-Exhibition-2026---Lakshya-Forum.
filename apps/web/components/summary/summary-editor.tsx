"use client";

import { useState } from "react";
import { LIMITS, normalizeContent, type SummaryContent } from "@/lib/summary/content";

function Rows({ label, values, onChange, placeholder, max, length }: { label: string; values: string[]; onChange: (values: string[]) => void; placeholder: string; max: number; length: number }) {
  return (
    <fieldset className="grid gap-2 border-0 p-0">
      <legend className="mb-1 font-bold">{label}</legend>
      {values.map((value, index) => (
        <div key={index} className="flex gap-2">
          <input
            className="field"
            aria-label={`${label}, item ${index + 1}`}
            value={value}
            maxLength={length}
            onChange={(event) => onChange(values.map((item, i) => (i === index ? event.target.value : item)))}
          />
          <button type="button" className="btn" aria-label={`Remove ${label} item ${index + 1}`} onClick={() => onChange(values.filter((_, i) => i !== index))}>
            ×
          </button>
        </div>
      ))}
      {values.length < max ? (
        <button type="button" className="btn w-fit" onClick={() => onChange([...values, ""])}>
          + Add {placeholder}
        </button>
      ) : null}
    </fieldset>
  );
}

function PairRows({
  label,
  rows,
  keys,
  names,
  onChange,
  limits,
}: {
  label: string;
  rows: Record<string, string>[];
  keys: [string, string];
  names: [string, string];
  onChange: (rows: Record<string, string>[]) => void;
  limits: { rows: number; first: number; second: number };
}) {
  return (
    <fieldset className="grid gap-2 border-0 p-0">
      <legend className="mb-1 font-bold">{label}</legend>
      {rows.map((row, index) => (
        <div key={index} className="grid gap-2 sm:grid-cols-[10em_1fr_auto]">
          <input className="field" aria-label={`${names[0]}, row ${index + 1}`} placeholder={names[0]} value={row[keys[0]] ?? ""} maxLength={limits.first} onChange={(event) => onChange(rows.map((r, i) => (i === index ? { ...r, [keys[0]]: event.target.value } : r)))} />
          <input className="field" aria-label={`${names[1]}, row ${index + 1}`} placeholder={names[1]} value={row[keys[1]] ?? ""} maxLength={limits.second} onChange={(event) => onChange(rows.map((r, i) => (i === index ? { ...r, [keys[1]]: event.target.value } : r)))} />
          <button type="button" className="btn" aria-label={`Remove row ${index + 1}`} onClick={() => onChange(rows.filter((_, i) => i !== index))}>
            ×
          </button>
        </div>
      ))}
      {rows.length < limits.rows ? (
        <button type="button" className="btn w-fit" onClick={() => onChange([...rows, { [keys[0]]: "", [keys[1]]: "" }])}>
          + Add a row
        </button>
      ) : null}
    </fieldset>
  );
}

/** Edit the summary before printing (DESIGN.md 8.7). Everything is the person's to change. */
export function SummaryEditor({ initial, onSave, onCancel }: { initial: SummaryContent; onSave: (content: SummaryContent) => Promise<string | null>; onCancel: () => void }) {
  const [content, setContent] = useState<SummaryContent>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const s = content.summary;
  const set = (patch: Partial<SummaryContent["summary"]>) => setContent((current) => ({ ...current, summary: { ...current.summary, ...patch } }));

  async function save() {
    setBusy(true);
    setError(null);
    const failure = await onSave(normalizeContent(content));
    setBusy(false);
    if (failure) setError(failure);
  }

  return (
    <form
      className="card grid gap-5 p-5 sm:p-7"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <h2 className="text-[1.5rem]">Edit before printing</h2>
      <div>
        <label className="field-label" htmlFor="sum-title">
          Title
        </label>
        <input id="sum-title" className="field" value={s.title} maxLength={120} onChange={(event) => set({ title: event.target.value })} />
      </div>
      <div>
        <label className="field-label" htmlFor="sum-name">
          Name to print (optional)
        </label>
        <input id="sum-name" className="field" value={content.for_name} maxLength={80} onChange={(event) => setContent({ ...content, for_name: event.target.value })} />
      </div>
      <div>
        <label className="field-label" htmlFor="sum-reason">
          Why I&apos;m seeing you
        </label>
        <textarea id="sum-reason" className="field py-3" rows={3} value={s.reason_for_visit} maxLength={600} onChange={(event) => set({ reason_for_visit: event.target.value })} />
      </div>
      <PairRows label="What's been happening" rows={s.timeline} keys={["when", "what"]} names={["When", "What happened"]} limits={LIMITS.timeline} onChange={(rows) => set({ timeline: rows as { when: string; what: string }[] })} />
      <PairRows label="Details" rows={s.details} keys={["label", "value"]} names={["For example, Severity", "For example, 6 of 10"]} limits={LIMITS.details} onChange={(rows) => set({ details: rows as { label: string; value: string }[] })} />
      <Rows label="Medicines and allergies I mentioned" values={s.medicines_and_allergies} onChange={(values) => set({ medicines_and_allergies: values })} placeholder="a medicine or allergy" max={LIMITS.medicines.rows} length={LIMITS.medicines.length} />
      <Rows label="Warning signs present" values={s.warning_signs.present} onChange={(values) => set({ warning_signs: { ...s.warning_signs, present: values } })} placeholder="a sign that is present" max={LIMITS.signs.rows} length={LIMITS.signs.length} />
      <Rows label="Warning signs not present" values={s.warning_signs.not_present} onChange={(values) => set({ warning_signs: { ...s.warning_signs, not_present: values } })} placeholder="a sign that is not present" max={LIMITS.signs.rows} length={LIMITS.signs.length} />
      <Rows label="Questions I want to ask" values={s.questions} onChange={(values) => set({ questions: values })} placeholder="a question" max={LIMITS.questions.rows} length={LIMITS.questions.length} />
      <div>
        <label className="field-label" htmlFor="sum-notes">
          My notes
        </label>
        <textarea id="sum-notes" className="field py-3" rows={4} value={content.notes} maxLength={2000} onChange={(event) => setContent({ ...content, notes: event.target.value })} />
      </div>
      {error ? (
        <p role="alert" className="error-card m-0">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-3">
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}
