import Link from "next/link";
import { Nox } from "@/components/nox";
import { RoughEdge } from "@/components/rough-edge";
import { SafetyDemo } from "@/components/safety-demo";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

const SOURCES = [
  { name: "NIH MedlinePlus", href: "https://medlineplus.gov/" },
  { name: "FDA drug labels", href: "https://open.fda.gov/apis/drug/label/" },
  { name: "DailyMed", href: "https://dailymed.nlm.nih.gov/" },
];

export default function HomePage() {
  return (
    <>
      <SiteHeader />
      <main id="main">
        {/* Hero */}
        <div className="wrap relative pb-[clamp(48px,7vw,80px)] pt-[clamp(40px,7vw,88px)] text-center">
          <div className="float hidden -rotate-3 lg:block" style={{ left: 0, top: 30 }} aria-hidden="true">
            <span className="inline-flex items-center gap-1.5 rounded-md border-[2px] border-line bg-butter px-2.5 py-1 text-[0.8125rem] font-semibold text-[#1A1C1E]">
              See a doctor today
            </span>
            <p className="mt-2">A fever this high in a child is worth a call today. [1]</p>
          </div>
          <div className="float hidden rotate-[2.5deg] lg:block" style={{ right: 0, top: 70 }} aria-hidden="true">
            <b>Checked</b>
            <br />✓ Safety rules
            <br />✓ NIH MedlinePlus
            <br />✓ FDA drug labels
          </div>
          <Nox className="absolute bottom-0 right-[6%] hidden w-28 lg:block" />

          <p className="eyebrow">For the 11 PM moment</p>
          <h1 className="display mt-3.5">
            A calm place to ask
            <br />
            about your health
          </h1>
          <p className="lead mx-auto mt-5 max-w-[34em]">
            Plain-language answers, checked against NIH and FDA sources, with a clear next step. Day or night.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3.5">
            <Link href="/app" className="btn btn-primary btn-lg">
              Ask a question
            </Link>
            <Link href="/#safety" className="btn btn-lg">
              See the safety check
            </Link>
          </div>
          <p className="mt-4 text-[0.875rem] text-ink-muted">Free to try · English and हिंदी · Your data stays yours</p>

          <div className="mt-11 flex flex-wrap items-center justify-center gap-3.5">
            <p className="eyebrow w-full">Grounded in</p>
            {SOURCES.map((source) => (
              <a key={source.name} className="src-pill no-underline" href={source.href} target="_blank" rel="noopener noreferrer">
                <span className="dot" aria-hidden="true" />
                {source.name} ↗<span className="sr-only"> (opens in a new tab)</span>
              </a>
            ))}
            <span className="src-pill src-pill-soon">WHO · soon</span>
            <span className="src-pill src-pill-soon">CDC · soon</span>
          </div>
        </div>

        {/* Instant escalation demo */}
        <section id="safety" className="block block-coral section mt-5">
          <RoughEdge position="top" seed={11} />
          <RoughEdge position="bottom" seed={18} />
          <div className="wrap">
            <h2 className="h2 text-center">Instant escalation when minutes matter</h2>
            <p className="mx-auto mt-3.5 max-w-[36em] text-center">
              Type a symptom. If it could be an emergency, we say so in milliseconds, on your device. This runs the real
              safety rules.
            </p>
            <SafetyDemo />
          </div>
        </section>

        {/* Problem and solution */}
        <section className="section">
          <div className="wrap">
            <div className="grid items-center gap-[clamp(24px,5vw,64px)] md:grid-cols-2">
              <div>
                <h2 className="h2 mb-[18px]">It&apos;s 11 PM and your head is pounding.</h2>
                <ul className="grid list-none gap-3 p-0">
                  {[
                    "Search results jump to the scariest answer",
                    "Chatbots sound sure, but show no sources",
                    "Symptom apps want an account before they help",
                    "You still can't tell if tonight is “wait” or “go”",
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-3">
                      <span className="box box-bad" aria-hidden="true" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="grid place-items-center">
                <Nox className="w-44" />
              </div>
            </div>

            <div className="mt-[clamp(48px,8vw,96px)] grid items-center gap-[clamp(24px,5vw,64px)] md:grid-cols-2">
              <figure className="card order-2 overflow-hidden md:order-1" aria-label="Example answer">
                <div
                  className="flex items-center gap-3 px-4 py-3 font-semibold"
                  style={{ background: "var(--care-2-bg)", color: "var(--care-2-fg)", borderBottom: "var(--bw-2) solid var(--care-2-edge)" }}
                >
                  See a doctor soon
                  <span className="ml-auto tracking-[3px]" aria-label="Care level 2 of 5">
                    ●●○○○
                  </span>
                </div>
                <div className="grid gap-2 p-4">
                  <p className="font-display text-[1.375rem] leading-tight font-extrabold">A headache like this is usually not serious, but it&apos;s worth watching.</p>
                  <p>
                    I can&apos;t examine you, so I can&apos;t be sure. Most headaches come from tension and ease with rest and fluids.
                  </p>
                  <p className="text-[0.875rem] text-ink-muted">Example only. General guidance, not medical advice.</p>
                </div>
              </figure>
              <div className="order-1 md:order-2">
                <h2 className="h2 mb-[18px]">One calm place to ask</h2>
                <ul className="grid list-none gap-3 p-0">
                  {[
                    "Plain language at a school reading level",
                    "Every claim linked to NIH or FDA, or marked “general guidance”",
                    "A clear next step, from “care at home” to “call 112”",
                    "A diary for symptoms, blood pressure and sugar that your doctor can read",
                    "English and Hindi, and answers read aloud",
                    "Export or delete everything, any time",
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-3">
                      <span className="box box-ok" aria-hidden="true">
                        ✓
                      </span>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
