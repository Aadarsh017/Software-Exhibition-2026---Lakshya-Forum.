"use client";

import { useState } from "react";
import { findMarker, formatRange, LAB_MARKERS, LAB_RANGES_NOTE, labFlag, latestPerMarker } from "@hch/shared/labs";
import { blankEntries, FLAG_LABEL, formatDay, today, toLabRows, type LabEntry, type LabRecord } from "@/lib/personalization/labs";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EditorScreen } from "./editors";
import { CloseIcon, PlusIcon } from "@/components/chat/icons";
import { MarginNote } from "@/components/ui/margin-note";

type NewRow = ReturnType<typeof toLabRows>[number];

/**
 * The blood report (DESIGN.md 8.6b): the newest value of each marker with Low / In range / High, and a form to add a
 * report. Values are what the person typed; the ranges are typical adult ones and the screen says the lab's own wins.
 */
export function BloodReport({
  labs,
  sex,
  onAdd,
  onDelete,
}: {
  labs: LabRecord[];
  sex: string | null;
  onAdd: (rows: NewRow[]) => Promise<string | null>;
  onDelete: (id: string) => Promise<string | null>;
}) {
  const [adding, setAdding] = useState(labs.length === 0);
  const [removing, setRemoving] = useState<LabRecord | null>(null);

  if (adding) return <AddReport onCancel={labs.length ? () => setAdding(false) : undefined} onSave={async (rows) => {
    const failure = await onAdd(rows);
    if (!failure) setAdding(false);
    return failure;
  }} />;

  const latest = latestPerMarker(labs);
  return (
    <div className="flex w-full flex-1 flex-col">
      <div className="mx-auto w-full max-w-[640px] px-4 pt-3 sm:px-6">
        <MarginNote>{`The newest value of each test. Nox uses these when you ask about your health. ${LAB_RANGES_NOTE}`}</MarginNote>
      </div>
      <div className="m-auto grid w-full max-w-[640px] grid-cols-1 gap-4 px-4 pt-4 pb-8 sm:px-6">
      <button type="button" className="btn btn-primary w-full" onClick={() => setAdding(true)}>
        <PlusIcon /> Add a new report
      </button>
      <ul className="m-0 grid list-none grid-cols-1 gap-2.5 p-0">
        {latest.map((row) => {
          const marker = findMarker(row.marker);
          const flag = labFlag(row, sex);
          return (
            <li key={row.id} className="row-card" style={{ cursor: "default" }}>
              <span className="min-w-0 flex-1">
                <span className="row-title block">{marker?.label ?? row.label}</span>
                <span className="row-sub block">
                  {formatDay(row.test_date)}
                  {marker ? ` · usual ${formatRange(marker, sex)}` : ""}
                </span>
              </span>
              <span className="grid justify-items-end gap-1 text-right">
                <span className="font-semibold whitespace-nowrap">
                  {Number(row.value)} {row.unit}
                </span>
                {flag ? (
                  <span className="flag-chip" data-flag={flag}>
                    {FLAG_LABEL[flag]}
                  </span>
                ) : null}
              </span>
              <button type="button" className="icon-ghost -mr-1" onClick={() => setRemoving(row)} aria-label={`Remove ${marker?.label ?? row.label} from ${formatDay(row.test_date)}`}>
                <CloseIcon size={16} />
              </button>
            </li>
          );
        })}
      </ul>
      <ConfirmDialog
        open={removing !== null}
        title="Remove this value?"
        confirmLabel="Remove"
        onCancel={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return null;
          const failure = await onDelete(removing.id);
          if (!failure) setRemoving(null);
          return failure;
        }}
      >
        <p className="m-0">
          {removing ? `${findMarker(removing.marker)?.label ?? removing.label}: ${Number(removing.value)} ${removing.unit}, ${formatDay(removing.test_date)}.` : ""} Older values of this test stay.
        </p>
      </ConfirmDialog>
      </div>
    </div>
  );
}

function AddReport({ onSave, onCancel }: { onSave: (rows: NewRow[]) => Promise<string | null>; onCancel?: () => void }) {
  const [date, setDate] = useState(today());
  const [entries, setEntries] = useState<LabEntry[]>(blankEntries);
  const update = (index: number, patch: Partial<LabEntry>) => setEntries((current) => current.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)));

  return (
    <EditorScreen
      intro="Type the values you have from your report. Leave the rest empty. Only you can see them."
      saveLabel="Save this report"
      onSave={async () => {
        const rows = toLabRows(entries, date);
        if (!rows.length) return "Add at least one value with a number.";
        return onSave(rows);
      }}
    >
      <div>
        <label className="field-label" htmlFor="report-date">
          Date of the report
        </label>
        <input id="report-date" className="field" type="date" value={date} max={today()} onChange={(event) => setDate(event.target.value || today())} />
      </div>
      <ul className="m-0 grid list-none grid-cols-1 gap-2.5 p-0">
        {entries.map((entry, index) => {
          const marker = entry.marker === "other" ? null : LAB_MARKERS.find((item) => item.key === entry.marker);
          const id = `lab-${index}`;
          return (
            <li key={id} className="lab-line">
              {marker ? (
                <label htmlFor={id} className="min-w-0 font-semibold">
                  {marker.label}
                </label>
              ) : (
                <input className="field min-w-0" aria-label="Test name" placeholder="Test name" value={entry.label} onChange={(event) => update(index, { label: event.target.value })} />
              )}
              <input id={id} className="field lab-value" inputMode="decimal" placeholder="Value" value={entry.value} onChange={(event) => update(index, { value: event.target.value })} />
              {marker && marker.units.length > 1 ? (
                <select className="field lab-unit" aria-label={`${marker.label} unit`} value={entry.unit} onChange={(event) => update(index, { unit: event.target.value })}>
                  {marker.units.map((unit) => (
                    <option key={unit.unit} value={unit.unit}>
                      {unit.unit}
                    </option>
                  ))}
                </select>
              ) : marker ? (
                <span className="lab-unit text-[0.9375rem] text-[var(--ink-muted)]">{entry.unit}</span>
              ) : (
                <input className="field lab-unit" aria-label="Unit" placeholder="Unit" value={entry.unit} maxLength={20} onChange={(event) => update(index, { unit: event.target.value })} />
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn" onClick={() => setEntries((current) => [...current, { marker: "other", label: "", value: "", unit: "" }])}>
          <PlusIcon /> Another test
        </button>
        {onCancel ? (
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
      </div>
    </EditorScreen>
  );
}
