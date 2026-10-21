"use client";

import { EditIcon, SidebarIcon } from "./icons";

/**
 * The slim bar above the chat. When the sidebar is hidden (or on a phone) it shows the buttons to open it and to
 * start a new chat. The chat's title sits in the middle. Emergency is in the sidebar, beside Sign out (DESIGN.md 7.8, 2026-10-19).
 */
export function AppHeader({
  sidebarOpen,
  title,
  onNewChat,
  onOpenSidebar,
}: {
  sidebarOpen: boolean;
  title: string;
  onNewChat: () => void;
  onOpenSidebar: () => void;
}) {
  const showTools = sidebarOpen ? "lg:hidden" : "";
  return (
    <header className="sticky top-0 z-20 bg-[var(--paper)]">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-3 py-2.5 sm:px-4">
        <div className={`flex items-center gap-1 ${showTools}`}>
          <button type="button" className="icon-btn" onClick={onOpenSidebar} aria-label="Open the sidebar">
            <SidebarIcon />
          </button>
          <button type="button" className="icon-btn" onClick={onNewChat} aria-label="New chat">
            <EditIcon />
          </button>
        </div>
        {sidebarOpen ? <div className="hidden lg:block" /> : null}
        <p className="m-0 max-w-[46vw] truncate text-center font-semibold">{title}</p>
        <div aria-hidden="true" />
      </div>
    </header>
  );
}
