"use client";

import { useState } from "react";
import { checkRedFlags } from "@hch/shared/redflags";
import { PhoneIcon } from "@/components/nox";

const EXAMPLES = [
  "I have a headache",
  "chest pain and my left arm hurts",
  "my baby has a fever",
  "my 2 month old has a fever",
  "I can't breathe",
  "I don't want to live anymore",
];

/**
 * The landing-page demo of the on-device emergency check (DESIGN.md 8.2.2).
 * It runs the real shared red-flag rules in the browser and sends nothing anywhere.
 * A result with no warning sign must never sound reassuring.
 */
export function SafetyDemo() {
  const [text, setText] = useState("");
  const result = text.trim() ? checkRedFlags(text) : null;
  const followUp = result?.followUps[0];

  return (
    <div>
      <div className="mt-7 flex flex-wrap justify-center gap-2.5" role="group" aria-label="Examples">
        {EXAMPLES.map((example) => (
          <button key={example} type="button" className="chip" onClick={() => setText(example)}>
            {example}
          </button>
        ))}
      </div>

      <div className="card mx-auto mt-7 max-w-[760px] p-5">
        <label className="eyebrow block" htmlFor="demo-input">
          How are you feeling?
        </label>
        <input
          id="demo-input"
          className="field mt-2"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Describe what's happening, in your own words"
          autoComplete="off"
          maxLength={500}
        />

        <div className="mt-4 min-h-5" aria-live="polite">
          {result?.crisis ? (
            <div className="res res-crisis">
              <h3 className="text-[1.5rem]">You&apos;re not alone, and you don&apos;t have to work this out tonight.</h3>
              <p className="mt-2">
                Tele-MANAS (free, 24×7): <b>14416</b>. If you&apos;re in immediate danger, call <b>112</b>.
              </p>
            </div>
          ) : result?.level ? (
            <div className="res res-flag" role="alert">
              <h3>This could be an emergency</h3>
              <p className="mt-1.5 text-[1.125rem]">You mentioned: {result.matches[0]?.sign}</p>
              <a className="btn btn-emergency" href="tel:112">
                <PhoneIcon />
                Call 112 now
              </a>
            </div>
          ) : result ? (
            <div className="res res-calm">
              <p>
                We didn&apos;t spot an emergency warning sign in that. That doesn&apos;t mean nothing is wrong. Ask in chat
                to talk it through.
              </p>
              {followUp ? (
                <p className="mt-2">
                  <b>One question first:</b> {followUp.ask}
                </p>
              ) : null}
              <a className="btn" href="/app">
                Ask in chat
              </a>
            </div>
          ) : null}
        </div>
      </div>
      <p className="mt-4 text-center text-[0.875rem]">Demo only. It runs in your browser and sends nothing. Not a diagnosis.</p>
    </div>
  );
}
