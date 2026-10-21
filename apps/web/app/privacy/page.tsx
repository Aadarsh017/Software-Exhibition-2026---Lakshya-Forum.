import type { Metadata } from "next";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = { title: "Privacy notice (beta draft)" };

// A plain-language draft for the closed beta. It states what the product actually does today, including what is
// not yet known. It has NOT been reviewed by a lawyer; that is required before a public launch (PLAN.md 7.7).
export default function PrivacyPage() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="wrap section" style={{ paddingTop: 24 }}>
        <article className="mx-auto grid max-w-[68ch] gap-4">
          <p className="banner m-0">Beta draft. This notice describes how the test version works today. It has not yet been reviewed by a lawyer.</p>
          <h1 className="text-[clamp(2rem,1.5rem+1.8vw,2.75rem)] leading-tight">Privacy notice</h1>
          <p>Hale gives general health information. It is an AI chatbot, not a doctor. It can be wrong and cannot diagnose or treat. In an emergency, call 112.</p>

          <h2 className="text-[1.5rem]">What we keep</h2>
          <ul className="grid list-disc gap-1.5 pl-5">
            <li>Your account: a guest ID, or your email address if you log in.</li>
            <li>Your chats (your questions and the answers) and the notices you accepted, with their versions.</li>
            <li>Optional health details, only if you add them: age range, sex at birth, pregnancy, long-term conditions, allergies and regular medicines. They are saved only to a logged-in account, never to a guest session.</li>
            <li>Your settings (language, text size, theme).</li>
            <li>Counts of how many questions you ask each day, to keep the service fair.</li>
            <li>When a message mentions a warning sign, we note <em>which rule matched</em> (for example &ldquo;chest-pain&rdquo;), never your words.</li>
          </ul>
          <p>This is kept in a private database. Other people cannot read your chats. During this test period the database is hosted by Supabase in Japan.</p>

          <h2 className="text-[1.5rem]">What we send to others</h2>
          <ul className="grid list-disc gap-1.5 pl-5">
            <li>
              <strong>An AI service</strong>, to write the answer. We first replace phone numbers, emails, ID numbers and names we can find with placeholders, then put your real details back in the reply. This is not perfect: please don&apos;t type details you don&apos;t want sent. If you add health details and leave &ldquo;Use this in my answers&rdquo; on, they are sent with your questions too. During this beta the AI service is River AI. <strong>We have not yet confirmed how long it keeps messages or whether it learns from them.</strong>
            </li>
            <li>
              <strong>US government health databases</strong> (MedlinePlus and the FDA): only plain topic or medicine names such as &ldquo;headache&rdquo;, never your sentence.
            </li>
            <li>Our email provider, if you log in with your email, to send you a code.</li>
          </ul>

          <h2 className="text-[1.5rem]">What we don&apos;t do</h2>
          <ul className="grid list-disc gap-1.5 pl-5">
            <li>No ads, no tracking, no analytics, no session recording.</li>
            <li>Only the cookies needed to keep you signed in.</li>
            <li>Our logs record timings and rule names, never what you wrote or what we answered.</li>
          </ul>

          <h2 className="text-[1.5rem]">Your choices</h2>
          <p>This service is for adults (18 and over). You can sign out at any time. Deleting your account removes your chats and settings; an on-screen button for this is coming. Until then, ask us. A privacy contact and a grievance officer will be published before launch.</p>
        </article>
      </main>
      <SiteFooter />
    </>
  );
}
