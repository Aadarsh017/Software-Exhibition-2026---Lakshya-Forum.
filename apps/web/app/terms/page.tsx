import type { Metadata } from "next";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = { title: "Terms (beta draft)" };

// A plain-language draft for the closed beta. Not reviewed by a lawyer (PLAN.md 7.7).
export default function TermsPage() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="wrap section" style={{ paddingTop: 24 }}>
        <article className="mx-auto grid max-w-[68ch] gap-4">
          <p className="banner m-0">Beta draft. These terms describe the test version. They have not yet been reviewed by a lawyer.</p>
          <h1 className="text-[clamp(2rem,1.5rem+1.8vw,2.75rem)] leading-tight">Terms of use</h1>
          <ul className="grid list-disc gap-2 pl-5">
            <li>
              <strong>Information, not medical advice.</strong> Hale explains general health information in plain language. It does not diagnose, treat or prescribe, and it does not give amounts of medicine.
            </li>
            <li>
              <strong>It can be wrong.</strong> Answers are written by an AI, using short passages from US government health pages. Check anything important with a doctor or pharmacist.
            </li>
            <li>
              <strong>Not for emergencies.</strong> If someone may be in danger, call 112 (or your local emergency number) first. Do not wait for an answer here.
            </li>
            <li>
              <strong>Adults only.</strong> You must be 18 or older. If you are asking about a child, you are the adult in charge of their care.
            </li>
            <li>
              <strong>Be kind and honest.</strong> Don&apos;t use the service to harm anyone or to try to break it.
            </li>
            <li>
              <strong>It&apos;s a beta.</strong> Things may change or stop working. Daily limits apply.
            </li>
          </ul>
        </article>
      </main>
      <SiteFooter />
    </>
  );
}
