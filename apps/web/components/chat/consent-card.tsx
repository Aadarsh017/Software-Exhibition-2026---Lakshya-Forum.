"use client";

import { useState } from "react";
import Link from "next/link";

/**
 * Before the first answer: three plain statements, all unticked, and a button that stays off until all are
 * ticked (DESIGN.md 7.10). The server records each with the version of the text, and refuses to use the AI without them.
 */
export function ConsentCard({ onAccept, bare = false }: { onAccept: () => Promise<string | null>; bare?: boolean }) {
  const [age, setAge] = useState(false);
  const [terms, setTerms] = useState(false);
  const [ai, setAi] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const message = await onAccept();
    setBusy(false);
    if (message) setError(message);
  }

  const row = "flex items-start gap-3 min-h-[44px] cursor-pointer";
  const box = "mt-1 h-5 w-5 flex-none accent-[var(--ink)]";
  return (
    <section className={bare ? "grid gap-4" : "card grid gap-4 p-5"} aria-labelledby={bare ? undefined : "consent-title"}>
      {bare ? null : (
        <div>
          <h2 id="consent-title" className="text-[1.625rem] leading-tight">
            Before we start
          </h2>
          <p className="mt-1 mb-0 text-[var(--ink-muted)]">Three quick things, so you know how this works.</p>
        </div>
      )}
      <div className="grid gap-2">
        <label className={row}>
          <input type="checkbox" className={box} checked={age} onChange={(e) => setAge(e.target.checked)} />
          <span>I&apos;m 18 or older</span>
        </label>
        <label className={row}>
          <input type="checkbox" className={box} checked={terms} onChange={(e) => setTerms(e.target.checked)} />
          <span>
            I agree to the{" "}
            <Link href="/terms" target="_blank">
              Terms
            </Link>{" "}
            and{" "}
            <Link href="/privacy" target="_blank">
              Privacy Notice
            </Link>
          </span>
        </label>
        <label className={row}>
          <input type="checkbox" className={box} checked={ai} onChange={(e) => setAi(e.target.checked)} />
          <span>I understand my messages are sent to an AI service to write answers</span>
        </label>
      </div>
      <details className="text-[0.9375rem]">
        <summary className="cursor-pointer select-none font-semibold">What leaves your account?</summary>
        <ul className="mt-2 grid list-disc gap-1.5 pl-5">
          <li>Your message goes to an AI service to write the answer. We first hide phone numbers, emails, ID numbers and names we can find.</li>
          <li>Only plain topic and medicine names (like &ldquo;headache&rdquo;) go to the US government health databases, MedlinePlus and the FDA. Never your sentence.</li>
          <li>If you add health details later (optional), they go with your questions only while you keep &ldquo;Use this in my answers&rdquo; on.</li>
          <li>Your chats are saved in your private account, where only you can read them.</li>
          <li>There are no ads and no tracking.</li>
        </ul>
      </details>
      {error ? (
        <p role="alert" className="error-card m-0">
          {error}
        </p>
      ) : null}
      <div>
        <button type="button" className="btn btn-primary btn-lg" disabled={!(age && terms && ai) || busy} onClick={submit}>
          {busy ? "Saving…" : "Agree and continue"}
        </button>
      </div>
    </section>
  );
}
