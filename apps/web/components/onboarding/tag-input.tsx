"use client";

import { useId, useState } from "react";
import { cleanList, LIMITS } from "@/lib/onboarding/settings";

/**
 * A list the person builds: tap a suggestion, or type your own and press Enter or Add. Each item has a Remove button.
 * Limits match the database (items and length), and repeats are ignored.
 */
export function TagInput({
  label,
  values,
  onChange,
  suggestions = [],
  max,
  placeholder,
  hint,
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  suggestions?: string[];
  max: number;
  placeholder: string;
  hint?: string;
}) {
  const id = useId();
  const [text, setText] = useState("");
  const taken = new Set(values.map((value) => value.toLowerCase()));
  const open = suggestions.filter((suggestion) => !taken.has(suggestion.toLowerCase()));
  const full = values.length >= max;

  function add(raw: string) {
    const next = cleanList([...values, ...raw.split(",")], max);
    onChange(next);
    setText("");
  }

  return (
    <div className="grid gap-2">
      <label htmlFor={id} className="font-bold">
        {label}
      </label>
      {values.length ? (
        <ul className="m-0 flex list-none flex-wrap gap-2 p-0" aria-label={`${label}, added`}>
          {values.map((value) => (
            <li key={value}>
              <span className="chip" style={{ cursor: "default" }}>
                {value}
                <button type="button" className="chip-remove" aria-label={`Remove ${value}`} onClick={() => onChange(values.filter((item) => item !== value))}>
                  ×
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {open.length && !full ? (
        <div className="flex flex-wrap gap-2" role="group" aria-label={`Suggestions for ${label}`}>
          {open.map((suggestion) => (
            <button key={suggestion} type="button" className="chip" onClick={() => add(suggestion)}>
              + {suggestion}
            </button>
          ))}
        </div>
      ) : null}
      <div className="flex gap-2">
        <input
          id={id}
          className="field"
          value={text}
          placeholder={full ? `That's the most we can keep (${max})` : placeholder}
          maxLength={LIMITS.item}
          disabled={full}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              if (text.trim()) add(text);
            }
          }}
          autoComplete="off"
        />
        <button type="button" className="btn" disabled={full || !text.trim()} onClick={() => add(text)}>
          Add
        </button>
      </div>
      {hint ? <p className="m-0 text-[0.875rem] text-[var(--ink-muted)]">{hint}</p> : null}
    </div>
  );
}
