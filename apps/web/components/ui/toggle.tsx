"use client";

/** An On/Off switch (DESIGN.md 7.10): a real checkbox, with the words On or Off beside it, never colour alone. */
export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-1">
      <label className="toggle" style={disabled ? { opacity: 0.55, cursor: "not-allowed" } : undefined}>
        <input type="checkbox" className="sr-only" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
        <span className="toggle-track" aria-hidden="true" />
        <span>
          {label}: {checked ? "On" : "Off"}
        </span>
      </label>
      {hint ? <p className="m-0 pl-[62px] text-[0.875rem] text-[var(--ink-muted)]">{hint}</p> : null}
    </div>
  );
}
