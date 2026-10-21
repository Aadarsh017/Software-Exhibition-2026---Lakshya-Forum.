"use client";

import { useRef, useState } from "react";

/**
 * Six boxes for the sign-in code (DESIGN.md 7.10). It is ONE real input stretched over six drawn boxes, so
 * paste, autofill from the email app ("one-time-code") and screen readers all work like a normal field.
 */
export function OtpInput({
  value,
  onChange,
  length = 6,
  describedBy,
}: {
  value: string;
  onChange: (value: string) => void;
  length?: number;
  describedBy?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const active = Math.min(value.length, length - 1);

  return (
    <div className="relative mx-auto w-fit">
      <div className="flex gap-2" aria-hidden="true">
        {Array.from({ length }, (_, index) => (
          <div
            key={index}
            className="grid h-14 w-[46px] place-items-center rounded-[var(--r-sm)] border-[2px] border-[var(--line)] bg-[var(--card)] font-display text-[1.75rem] font-semibold sm:w-[52px]"
            style={focused && index === active ? { outline: "3px solid var(--ink)", outlineOffset: 2 } : undefined}
          >
            {value[index] ?? ""}
          </div>
        ))}
      </div>
      <label htmlFor="code" className="sr-only">
        6-digit code
      </label>
      <input
        ref={ref}
        id="code"
        name="code"
        className="absolute inset-0 h-full w-full cursor-text opacity-0"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={length}
        value={value}
        autoFocus
        onChange={(event) => onChange(event.target.value.replace(/\D/g, "").slice(0, length))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        aria-describedby={describedBy}
      />
    </div>
  );
}
