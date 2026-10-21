"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { displayTitle, isUrgent, type ConversationItem } from "@/lib/history/group";
import { MIN_MESSAGE_QUERY, searchResults, type MessageHit } from "@/lib/history/search";
import { displayName } from "@/lib/personalization/profile";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { InstallRow } from "@/components/pwa/install-row";
import { AlertIcon, LogoMark } from "@/components/nox";
import { BowlIcon, CloseIcon, DocIcon, EditIcon, GearIcon, PersonIcon, SearchIcon, SidebarIcon, ThermometerIcon } from "@/components/chat/icons";

type Props = {
  items: ConversationItem[];
  loading: boolean;
  error: string | null;
  currentId: string | null;
  onOpen: (id: string) => void;
  onNewChat: () => void;
  onRename: (id: string, title: string) => Promise<string | null>;
  onDelete: (id: string) => Promise<string | null>;
  /** "Save my chats" is off: say so instead of "no chats yet". */
  savingOff?: boolean;
  account: { guest: boolean; email: string | null; name: string | null } | null;
  onSignOut: () => void;
  /** Wide screens: hide the sidebar. Phones: close the drawer. */
  onHide: () => void;
  hideLabel: string;
  /** The same sidebar, as the phone's slide-out: a clear close button instead of the "hide sidebar" icon. */
  variant?: "rail" | "drawer";
  /** Messages (yours and Nox's) whose text contains the words, newest first; null when they couldn't be searched. */
  onSearchMessages?: (query: string) => Promise<MessageHit[] | null>;
};

/** From the name when there is one ("Raunak Jain" → "RJ"); the sidebar never shows the email (founder, 2026-10-19). */
function initials(name: string | null, email: string | null, guest: boolean): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length) return (words[0]!.charAt(0) + (words.length > 1 ? words[words.length - 1]!.charAt(0) : "")).toUpperCase();
  return guest || !email ? "G" : email.charAt(0).toUpperCase();
}

/**
 * The left sidebar (after the founder's reference): name, search, hide; New chat, Personalization, Doctor summaries, Settings; Recents
 * with a menu per chat; and the account at the bottom. The same panel is the drawer on phones.
 */
export function Sidebar({ items, loading, error, currentId, onOpen, onNewChat, onRename, onDelete, savingOff = false, account, onSignOut, onHide, hideLabel, variant = "rail", onSearchMessages }: Props) {
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<{ query: string; rows: MessageHit[]; failed: boolean }>({ query: "", rows: [], failed: false });
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ConversationItem | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const needle = query.trim();
  // Look inside messages a moment after typing stops (DESIGN.md 8.5). Titles are filtered at once, below.
  useEffect(() => {
    if (!onSearchMessages || needle.length < MIN_MESSAGE_QUERY) return;
    let live = true;
    const timer = setTimeout(() => {
      void onSearchMessages(needle).then((rows) => {
        if (live) setHits({ query: needle, rows: rows ?? [], failed: rows === null });
      });
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [needle, onSearchMessages]);
  const lookingInside = Boolean(onSearchMessages) && needle.length >= MIN_MESSAGE_QUERY && hits.query !== needle;
  const results = useMemo(() => searchResults(items, needle, hits.query === needle ? hits.rows : []), [items, needle, hits]);

  function closeSearch() {
    setSearching(false);
    setQuery("");
  }

  async function saveRename(id: string) {
    const failure = await onRename(id, draft);
    if (failure) {
      setRenameError(failure);
      return;
    }
    setRenaming(null);
    setRenameError(null);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-1 px-3 pt-3 pb-3.5">
        <Link href="/" className="flex min-w-0 items-center gap-2 px-1 font-display text-[1.375rem] font-extrabold tracking-tight no-underline">
          <LogoMark size={26} />
          <span className="truncate">hale</span>
        </Link>
        <div className="flex items-center">
          <button
            type="button"
            className="side-icon"
            aria-label="Search your chats"
            aria-expanded={searching}
            onClick={() => {
              if (searching) closeSearch();
              else {
                setSearching(true);
                setTimeout(() => searchRef.current?.focus(), 0);
              }
            }}
          >
            <SearchIcon />
          </button>
          {variant === "drawer" ? (
            <button type="button" className="icon-btn" style={{ width: 40, height: 40 }} aria-label={hideLabel} onClick={onHide} data-autofocus>
              <CloseIcon />
            </button>
          ) : (
            <button type="button" className="side-icon" aria-label={hideLabel} onClick={onHide}>
              <SidebarIcon />
            </button>
          )}
        </div>
      </div>

      {/* Search opens right under its button, and the links step aside while you type (founder, 2026-10-19). */}
      {searching ? (
        <div className="px-3 pb-3">
          <label htmlFor={`history-search-${variant}`} className="sr-only">
            Search your chats
          </label>
          <input
            ref={searchRef}
            id={`history-search-${variant}`}
            className="field"
            type="search"
            placeholder="Search titles and messages"
            autoComplete="off"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                closeSearch();
              }
            }}
          />
        </div>
      ) : null}

      <div className="grid gap-1 px-3" hidden={Boolean(needle)}>
        <button type="button" className="nav-row nav-row-primary" onClick={onNewChat}>
          <span className="tile" data-tone="coral" aria-hidden="true">
            <EditIcon size={18} />
          </span>
          New chat
        </button>
        <Link href="/app/personalization" className="nav-row">
          <span className="tile" data-tone="lilac" aria-hidden="true">
            <PersonIcon size={18} />
          </span>
          Personalization
        </Link>
        <Link href="/app/diary" className="nav-row">
          <span className="tile" data-tone="sky" aria-hidden="true">
            <ThermometerIcon size={18} />
          </span>
          Health diary
        </Link>
        <Link href="/app/thali" className="nav-row">
          <span className="tile" data-tone="butter" aria-hidden="true">
            <BowlIcon size={18} />
          </span>
          Thali
        </Link>
        <Link href="/app/summaries" className="nav-row">
          <span className="tile" data-tone="butter" aria-hidden="true">
            <DocIcon size={18} />
          </span>
          Doctor summaries
        </Link>
        <Link href="/app/settings" className="nav-row">
          <span className="tile" data-tone="paper" aria-hidden="true">
            <GearIcon size={18} />
          </span>
          Settings
        </Link>
      </div>

      <nav aria-label={needle ? "Search results" : "Recent chats"} className={`${needle ? "mt-1" : "mt-5"} grid min-h-0 flex-1 grid-cols-1 content-start gap-1 overflow-x-hidden overflow-y-auto px-3 pb-3`}>
        <p className="section-label">{needle ? "Results" : "Recents"}</p>
        {loading ? <p className="m-0 px-3 text-[0.9375rem] text-[var(--ink-muted)]">Loading…</p> : null}
        {error ? (
          <p role="alert" className="error-card m-0 text-[0.9375rem]">
            {error}
          </p>
        ) : null}
        {!loading && !error && results.length === 0 && !lookingInside ? (
          <p className="m-0 px-3 text-[0.9375rem] text-[var(--ink-muted)]">
            {needle ? `No chats with “${needle}”.` : savingOff ? "Saving is off, so new chats aren't kept here." : "No chats yet."}
          </p>
        ) : null}
        <p className="m-0 px-3 text-[0.8125rem] text-[var(--ink-muted)]" role="status">
          {lookingInside
            ? "Looking inside your chats…"
            : needle
              ? `${results.length ? `${results.length} ${results.length === 1 ? "chat" : "chats"}` : ""}${hits.query === needle && hits.failed ? `${results.length ? ". " : ""}Titles only: we couldn't reach your messages.` : ""}`
              : ""}
        </p>
        <ul className="m-0 grid list-none grid-cols-1 gap-0.5 p-0">
          {results.map(({ item, snippet }) => (
            <li key={item.id} className="history-item relative" data-current={item.id === currentId ? "true" : "false"}>
              {renaming === item.id ? (
                <form
                  className="grid w-full gap-2 p-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveRename(item.id);
                  }}
                >
                  <label htmlFor={`rename-${item.id}`} className="sr-only">
                    New name for this chat
                  </label>
                  <input
                    id={`rename-${item.id}`}
                    className="field"
                    value={draft}
                    maxLength={120}
                    autoFocus
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") setRenaming(null);
                    }}
                  />
                  {renameError ? <p className="m-0 text-[0.875rem] text-[var(--alert-text)]">{renameError}</p> : null}
                  <div className="flex gap-2">
                    <button type="submit" className="btn">
                      Save
                    </button>
                    <button type="button" className="btn" onClick={() => setRenaming(null)}>
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <button type="button" className="history-open" aria-current={item.id === currentId ? "page" : undefined} onClick={() => onOpen(item.id)}>
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="history-title">{displayTitle(item.title)}</span>
                      {isUrgent(item.max_care_level) ? <span className="urgent-tag flex-none">Urgent</span> : null}
                    </span>
                    {snippet ? <span className="history-snippet">{snippet}</span> : null}
                  </button>
                  <details className="history-menu">
                    <summary aria-label={`Options for ${displayTitle(item.title)}`}>⋯</summary>
                    <div>
                      <button
                        type="button"
                        className="menu-item"
                        onClick={(event) => {
                          (event.currentTarget.closest("details") as HTMLDetailsElement | null)?.removeAttribute("open");
                          setDraft(displayTitle(item.title));
                          setRenameError(null);
                          setRenaming(item.id);
                        }}
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        className="menu-item text-[var(--alert-text)]"
                        onClick={(event) => {
                          (event.currentTarget.closest("details") as HTMLDetailsElement | null)?.removeAttribute("open");
                          setDeleting(item);
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </details>
                </>
              )}
            </li>
          ))}
        </ul>
      </nav>

      <InstallRow />

      {account ? (
        <div className="account-block">
          <div className="flex items-center gap-3">
            <span className="avatar" aria-hidden="true">
              {initials(account.name, account.email, account.guest)}
            </span>
            <div className="min-w-0 flex-1">
              {displayName(account.name) ? (
                <p className="m-0 truncate font-bold">{displayName(account.name)}</p>
              ) : account.guest ? (
                <p className="m-0 truncate font-bold">Guest</p>
              ) : (
                <Link href="/app/personalization?section=about" className="block truncate font-bold">
                  Add your name
                </Link>
              )}
              <p className="m-0 text-[0.8125rem] text-[var(--ink-muted)]">{account.guest ? "Guest · a few questions a day" : "Signed in"}</p>
            </div>
          </div>
          {/* Emergency lives here, beside the account button (founder's decision, DESIGN.md 7.8). */}
          <div className="grid grid-cols-2 gap-2">
            {account.guest ? (
              <Link href="/login?next=/app" className="btn btn-primary btn-compact">
                Save my chats
              </Link>
            ) : (
              <button type="button" className="btn btn-compact" onClick={onSignOut}>
                Sign out
              </button>
            )}
            <Link href="/emergency" className="btn btn-compact btn-alert">
              <AlertIcon size={16} />
              Emergency
            </Link>
          </div>
          <p className="m-0 text-center text-[0.75rem] text-[var(--ink-muted)]">Not medical advice. In an emergency, call 112.</p>
        </div>
      ) : null}

      <ConfirmDialog
        open={deleting !== null}
        title="Delete this chat?"
        confirmLabel="Delete chat"
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return null;
          const failure = await onDelete(deleting.id);
          if (!failure) setDeleting(null);
          return failure;
        }}
      >
        <p className="m-0">
          <strong>{deleting ? displayTitle(deleting.title) : ""}</strong>
        </p>
        <p className="m-0">This removes the chat from your account. Summaries you saved stay unless you delete them too.</p>
      </ConfirmDialog>
    </div>
  );
}
