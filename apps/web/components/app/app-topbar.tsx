import Link from "next/link";
import { ArrowLeftIcon } from "@/components/chat/icons";

export type Back = { href?: string; label?: string; onClick?: () => void };

/**
 * The bar on pages around the chat (Settings, Personalization, Summaries), after the Tuckii reference: a square back
 * button and the page name in the middle (Emergency is in the sidebar, DESIGN.md 7.8). A screen inside a page (one topic of
 * Personalization) passes `back` so the button returns to the page instead of the chat.
 */
export function AppTopbar({ title, back }: { title: string; back?: Back }) {
  const label = back?.label ?? "Back to chat";
  return (
    <header className="no-print flex-none bg-[var(--paper)]">
      <div className="mx-auto grid max-w-[var(--w-content)] grid-cols-[1fr_auto_1fr] items-center gap-3 px-3 py-2.5 sm:px-5">
        <div className="justify-self-start">
          {back?.onClick ? (
            <button type="button" className="icon-btn" onClick={back.onClick} aria-label={label} title={label}>
              <ArrowLeftIcon />
            </button>
          ) : (
            <Link href={back?.href ?? "/app"} className="icon-btn" aria-label={label} title={label}>
              <ArrowLeftIcon />
            </Link>
          )}
        </div>
        <p className="m-0 max-w-[60vw] truncate text-center font-display text-[1.25rem] font-extrabold tracking-tight text-[var(--ink)]">{title}</p>
        <div aria-hidden="true" />
      </div>
    </header>
  );
}
