import type { Metadata } from "next";
import Link from "next/link";
import { PhoneIcon } from "@/components/nox";
import { FIRST_AID } from "@/lib/emergency/first-aid";

export const metadata: Metadata = {
  title: "Emergency numbers",
  description: "If this is an emergency, call now. Numbers for India, what to do while you wait, and first aid that works without signal.",
};

// Plain on purpose: no mascot, no pastels, no wit (DESIGN.md 7.7). Static, so it opens with no signal.
// The numbers and the "while you wait" lines must be verified, and the lines clinically reviewed,
// before launch (PLAN.md Appendix C and 6.12).
export default function EmergencyPage() {
  return (
    <main id="main" className="min-screen-h flex flex-col bg-[var(--alert)] px-4 py-10 text-white">
      {/* Centred when it fits; from the top when it doesn't (DESIGN.md 8.3). */}
      <div className="m-auto grid w-full max-w-[560px] gap-4">
        <h1 className="text-[clamp(2rem,1.4rem+2.6vw,2.75rem)] leading-[1.08] text-white">If this is an emergency, call now</h1>
        <a className="btn btn-emergency" href="tel:112">
          <PhoneIcon />
          Call 112
        </a>
        <a className="btn btn-emergency" href="tel:108" style={{ minHeight: 56, fontSize: "1.0625rem" }}>
          Call 108, ambulance
        </a>

        <div className="mt-2">
          <h2 className="text-[1.375rem] text-white">While you wait</h2>
          <ul className="mt-2 grid list-disc gap-1.5 pl-5">
            <li>Stay with the person</li>
            <li>Don&apos;t drive yourself</li>
            <li>Unlock the door and switch on a light so help can find you</li>
            <li>Follow what the person on the phone tells you</li>
          </ul>
        </div>

        {/* First aid while help comes (DESIGN.md 7.7a): plain, collapsed, and part of this page, so it works offline too. */}
        <section className="mt-2 grid gap-2" aria-labelledby="first-aid">
          <h2 id="first-aid" className="text-[1.375rem] text-white">
            First aid while help comes
          </h2>
          <p className="text-[0.9375rem] opacity-90">Tap what&apos;s happening. This works without signal.</p>
          {FIRST_AID.map((guide) => (
            <details key={guide.id} id={guide.id} className="first-aid">
              <summary>
                <span className="block text-[1.0625rem] font-bold">{guide.title}</span>
                <span className="block text-[0.875rem] opacity-90">{guide.when}</span>
              </summary>
              <div className="grid gap-3 pt-3">
                {guide.call112 ? (
                  <a className="btn btn-emergency" href="tel:112" style={{ minHeight: 48, fontSize: "1rem" }}>
                    <PhoneIcon />
                    Call 112 first
                  </a>
                ) : null}
                <div>
                  <h3 className="text-[1rem] font-bold text-white">Do</h3>
                  <ol className="mt-1 grid list-decimal gap-1.5 pl-5">
                    {guide.dos.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ol>
                </div>
                <div>
                  <h3 className="text-[1rem] font-bold text-white">Don&apos;t</h3>
                  <ul className="mt-1 grid list-disc gap-1.5 pl-5">
                    {guide.donts.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </div>
                <p className="text-[0.8125rem] opacity-90">
                  From:{" "}
                  {guide.sources.map((source, index) => (
                    <span key={source.url}>
                      {index ? ", " : ""}
                      <a className="text-white underline" href={source.url} rel="noopener noreferrer" target="_blank">
                        {source.label}
                      </a>
                    </span>
                  ))}
                  . General first aid, not a substitute for emergency help.
                </p>
              </div>
            </details>
          ))}
        </section>

        <div className="mt-2 rounded-lg border-2 border-white/60 p-4">
          <h2 className="text-[1.25rem] text-white">Need to talk to someone?</h2>
          <p className="mt-1.5">
            Tele-MANAS is a free mental-health helpline, open day and night:{" "}
            <a className="font-bold text-white" href="tel:14416">
              14416
            </a>
            . If you are in immediate danger, call 112.
          </p>
        </div>

        <p className="text-[0.9375rem] opacity-90">Outside India, call your local emergency number (112 in the EU, 911 in the US, 999 in the UK).</p>
        <Link href="/" className="font-semibold text-white">
          Back to Hale
        </Link>
      </div>
    </main>
  );
}
