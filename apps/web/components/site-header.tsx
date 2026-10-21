import Link from "next/link";
import { AlertIcon, LogoMark } from "@/components/nox";
import { isSignedInMember } from "@/lib/auth/member";

/**
 * The site navigation: the logo on the left, and one rounded bar holding four rounded buttons: Safety, Log in,
 * Ask a question and Emergency (the style of the founder's sketch, in the product's colours). Emergency is on every
 * page and is a plain link to a static page, so it works with no network (DESIGN.md 7.8). On a phone the bar
 * keeps Log in, Ask and Emergency, and Safety (a link to a section of the home page) comes back from tablet size.
 * Someone logged in with an account sees no "Log in", and the main button takes them to their chats (DESIGN.md 8.6b).
 */
export async function SiteHeader({ accountAware = true }: { accountAware?: boolean } = {}) {
  // The not-found page passes false: reading cookies there would make every page dynamic, /emergency included,
  // which must stay a plain static page (DESIGN.md 7.8).
  const member = accountAware ? await isSignedInMember() : false;
  return (
    <div className="wrap wrap-wide">
      <header className="flex items-center justify-between gap-2 py-4 sm:gap-3">
        <Link
          href="/"
          className="flex items-center gap-2.5 whitespace-nowrap font-display text-[1.125rem] font-extrabold tracking-tight no-underline sm:text-[1.375rem]"
          aria-label="Hale, home"
        >
          <LogoMark />
          <span className="hidden min-[360px]:inline">hale</span>
        </Link>

        <nav aria-label="Main" className="nav-capsule">
          <Link href="/#safety" className="nav-pill hidden sm:inline-flex">
            Safety
          </Link>
          {member ? null : (
            <Link href="/login" className="nav-pill">
              Log in
            </Link>
          )}
          {member ? (
            <Link href="/app" className="nav-pill nav-pill-primary">
              My chats
            </Link>
          ) : (
            <Link href="/app" className="nav-pill nav-pill-primary" aria-label="Ask a question">
              <span className="sm:hidden">Ask</span>
              <span className="hidden sm:inline">Ask a question</span>
            </Link>
          )}
          <Link href="/emergency" className="nav-pill nav-pill-emergency">
            <AlertIcon size={16} />
            Emergency
          </Link>
        </nav>
      </header>
    </div>
  );
}
