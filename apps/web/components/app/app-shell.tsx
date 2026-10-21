import type { ReactNode } from "react";
import { AppTopbar, type Back } from "./app-topbar";

/**
 * The frame for the pages around the chat (Settings, Personalization, Summaries): the top bar stays put and only the
 * content area scrolls, so the page itself never moves (DESIGN.md 8.3, "No page scroll"). Printing lets it flow.
 */
export function AppShell({ title, back, children }: { title: string; back?: Back; children: ReactNode }) {
  return (
    <div className="app-frame">
      <AppTopbar title={title} back={back} />
      <div className="app-scroll">{children}</div>
    </div>
  );
}
