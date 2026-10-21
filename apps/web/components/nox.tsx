/** Nox, the sleepy moon mascot (DESIGN.md 3.3). Decorative only; never shown on emergency or crisis screens. */
export function Nox({ className }: { className?: string }) {
  return (
    // overflow visible: the waving hand reaches past the 120-wide frame and used to be cut off (founder, 2026-10-20).
    <svg className={className} viewBox="0 0 120 150" overflow="visible" aria-hidden="true" focusable="false">
      <g fill="none" stroke="var(--ink)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" filter="url(#rough)">
        <path d="M48 116 L44 140 M72 116 L76 140 M37 142h13 M70 142h13" />
        <circle cx="60" cy="74" r="42" fill="var(--card)" />
        <circle cx="38" cy="86" r="7" fill="var(--accent-butter)" stroke="none" />
        <path d="M45 72q4-5 8 0M69 72q4-5 8 0M53 88q7 5 14 0" />
        <path d="M24 50Q36 8 74 18Q98 26 100 52Q68 38 24 50Z" fill="var(--accent-lilac)" />
        <circle cx="102" cy="56" r="7" fill="var(--card)" />
        <path d="M20 86q-12 6-10 20M100 86q14-8 20-26" />
        <path d="M116 56l8-8M120 64l10-2" />
      </g>
    </svg>
  );
}

export function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 30 30" aria-hidden="true" focusable="false">
      <path
        d="M4 5h22a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H13l-6 5v-5H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"
        fill="var(--accent-coral)"
        stroke="var(--ink)"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M18.5 9.5a5 5 0 1 0 2.6 8.8A6 6 0 0 1 18.5 9.5z" fill="var(--ink)" />
    </svg>
  );
}

export function AlertIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2.4" />
      <path d="M12 7v6M12 16.5v.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

export function PhoneIcon({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}
