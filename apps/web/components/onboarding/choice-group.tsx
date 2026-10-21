"use client";

import type { CSSProperties } from "react";

/**
 * A row of single-choice chips (DESIGN.md 7.4). Tapping the chosen one again clears it when `clearable`. `columns` lays
 * short options (0 to 10, blood groups) out as an even grid, so they take one or two lines instead of four (DESIGN.md 8.3).
 */
export function ChoiceGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  clearable = false,
  hint,
  columns,
  wideColumns,
  hideLabel = false,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T | null;
  onChange: (value: T | null) => void;
  clearable?: boolean;
  hint?: string;
  columns?: number;
  /** Columns from 640 px wide, when there is room for every option on one line. */
  wideColumns?: number;
  /** The label is still read out, but not shown, when the choices speak for themselves (a chart's switch). */
  hideLabel?: boolean;
}) {
  return (
    <div role="group" aria-label={label} className="grid gap-2">
      <p className={hideLabel ? "sr-only" : "m-0 font-bold"}>{label}</p>
      <div
        className={columns ? "chip-strip" : "flex flex-wrap gap-2"}
        data-wide={wideColumns ? "true" : undefined}
        style={columns ? ({ "--cols": columns, "--cols-wide": wideColumns ?? columns } as CSSProperties) : undefined}
      >
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className="chip"
            aria-pressed={value === option.value}
            onClick={() => onChange(clearable && value === option.value ? null : option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
      {hint ? <p className="m-0 text-[0.875rem] text-[var(--ink-muted)]">{hint}</p> : null}
    </div>
  );
}

/**
 * The same even chip grid, for answers that can be several at once (a medicine's times of day, DESIGN.md 8.6e). Each
 * chip toggles on its own; the chosen ones come back in the options' order.
 */
export function MultiChoiceGroup<T extends string>({
  label,
  options,
  values,
  onChange,
  columns,
  hideLabel = false,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  values: readonly T[];
  onChange: (values: T[]) => void;
  columns: number;
  hideLabel?: boolean;
}) {
  return (
    <div role="group" aria-label={label} className="grid gap-2">
      <p className={hideLabel ? "sr-only" : "m-0 font-bold"}>{label}</p>
      <div className="chip-strip" style={{ "--cols": columns, "--cols-wide": columns } as CSSProperties}>
        {options.map((option) => {
          const on = values.includes(option.value);
          return (
            <button
              key={option.value}
              type="button"
              className="chip"
              aria-pressed={on}
              onClick={() => onChange(options.map((item) => item.value).filter((value) => (value === option.value ? !on : values.includes(value))))}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
