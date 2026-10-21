import type { Metadata } from "next";
import Link from "next/link";
import { CareBand } from "@/components/chat/care-band";
import { LoginForm } from "@/components/login-form";
import { Nox } from "@/components/nox";
import { safeNext } from "@/lib/auth/safe-next";

export const metadata: Metadata = { title: "Log in" };


const PROMISES = [
  "Checked against NIH MedlinePlus and FDA drug labels",
  "Possible emergencies point you to 112 first",
  "Your chats are saved in your private account",
  "General information, never a diagnosis",
];

/**
 * Sign-in (DESIGN.md 8.3): a focused split screen. The form on the left, and on the right a coral block that says what
 * the product is, with an example answer. The example is labelled as one. There are no made-up quotes or customer logos.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;

  return (
    <main id="main" className="screen-h overflow-hidden lg:grid lg:grid-cols-2">
      {/* The page never scrolls. On a very short screen only this column does (m-auto keeps it centred otherwise). The
          emergency line sits at the foot of the screen, so the form itself is what's centred (founder, 2026-10-19). */}
      <section className="screen-h flex min-h-0 flex-col overflow-y-auto">
        <div className="m-auto grid w-full max-w-[400px] gap-4 px-5 py-4 [@media(min-height:720px)]:gap-5 [@media(min-height:720px)]:py-6">
          <LoginForm next={safeNext(next)} linkError={Boolean(error)} />
        </div>
        <p className="m-0 flex-none px-5 pt-1 pb-4 text-center text-[0.875rem] text-[var(--ink-muted)]">
          In an emergency, call 112. <Link href="/emergency">Emergency numbers</Link>
        </p>
      </section>

      <aside aria-label="About Hale" className="screen-h relative hidden overflow-hidden border-l-[2px] border-[var(--line)] bg-[var(--block-coral)] text-[var(--on-block)] lg:block">
        <div className="screen-h relative z-10 mx-auto flex max-w-[560px] flex-col justify-center gap-6 px-10 py-8">
          <p className="eyebrow m-0 text-[var(--on-block)]">Ask. Understand. Act.</p>
          <p className="m-0 font-display text-[clamp(2.25rem,1.5rem+1.7vw,3.25rem)] font-extrabold leading-[1.08] tracking-tight">
            Built for the 11&nbsp;PM moment, when fear needs facts, fast.
          </p>

          {/* An illustration of an answer, clearly labelled. Not real advice. */}
          <div className="relative max-w-[430px] [@media(max-height:600px)]:hidden" style={{ transform: "rotate(-1.5deg)" }}>
            <span className="absolute -top-3 right-3 z-10 rounded-[var(--r-pill)] border-[2px] border-[var(--line)] bg-[var(--card)] px-3 py-0.5 text-[0.7812rem] font-bold text-[var(--ink)]">
              Example only, not real advice
            </span>
            <div className="answer text-[var(--ink)]" style={{ boxShadow: "var(--shadow-float)" }}>
              <CareBand level="selfcare" />
              <div className="answer-body" style={{ gap: 8 }}>
                <p className="m-0 font-display text-[1.25rem] font-extrabold leading-snug">Most headaches like this are mild and settle with rest.</p>
                <p className="m-0 text-[0.9375rem]">
                  Often caused by tight muscles and stress.
                  <span className="marker" aria-hidden="true">1</span>
                </p>
                <span className="src-pill w-fit">
                  <span className="dot" aria-hidden="true" />
                  MedlinePlus: Headache
                </span>
              </div>
            </div>
          </div>

          <ul className="m-0 grid list-none gap-2.5 p-0 [@media(max-height:760px)]:hidden">
            {PROMISES.map((line) => (
              <li key={line} className="flex items-start gap-3 text-[1.0625rem]">
                <span className="box box-ok" aria-hidden="true">
                  ✓
                </span>
                {line}
              </li>
            ))}
          </ul>

          <p className="m-0 text-[0.8438rem] opacity-90">Not affiliated with or endorsed by the NIH or the FDA. In an emergency, call 112.</p>
        </div>
        <Nox className="pointer-events-none absolute -bottom-3 right-6 h-44 w-36 opacity-95" />
      </aside>
    </main>
  );
}
