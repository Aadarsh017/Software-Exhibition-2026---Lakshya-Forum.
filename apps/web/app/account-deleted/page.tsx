import type { Metadata } from "next";
import Link from "next/link";
import { LogoMark } from "@/components/nox";

export const metadata: Metadata = { title: "Account deleted", robots: { index: false } };

/** The plain receipt after deleting an account (DESIGN.md 8.6). */
export default async function AccountDeletedPage({ searchParams }: { searchParams: Promise<{ at?: string }> }) {
  const { at } = await searchParams;
  const when = at && !Number.isNaN(Date.parse(at)) ? new Date(at) : null;
  return (
    <main id="main" className="min-screen-h mx-auto grid max-w-[560px] content-center gap-5 px-4 py-10">
      <Link href="/" aria-label="Hale, home" className="w-fit">
        <LogoMark size={44} />
      </Link>
      <h1 className="text-[clamp(2rem,1.5rem+1.8vw,2.75rem)] leading-tight">Your account is deleted</h1>
      <div className="card grid gap-3 p-5">
        <p className="m-0">
          <strong>Deleted:</strong> your account, chats, doctor summaries, settings, health details, feedback and the notices you accepted.
        </p>
        {when ? (
          <p className="m-0">
            <strong>When:</strong> {when.toUTCString()}
          </p>
        ) : null}
        <p className="m-0 text-[var(--ink-muted)]">
          Copies inside our database provider&apos;s own backups disappear when those backups expire. Warning-sign notes that were never linked to your words are kept, without your account.
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Link href="/" className="btn btn-primary">
          Back to the home page
        </Link>
        <Link href="/emergency" className="btn">
          Emergency numbers
        </Link>
      </div>
    </main>
  );
}
