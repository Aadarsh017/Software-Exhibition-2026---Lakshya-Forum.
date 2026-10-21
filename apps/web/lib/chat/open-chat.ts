// Which chat is open in this visit (founder, 2026-10-20: "when I restart the app it should start in a new chat").
//
// Kept in sessionStorage, not localStorage: it lives through moving between screens and reloads in the same tab or
// installed app, and is gone when the app or tab is closed, so a fresh start opens a new chat. Coming back after
// AWAY_MS in the background starts fresh too (phones often keep an app paused rather than closing it, and a page the
// phone threw away and reloads keeps its sessionStorage). Tied to the account, so someone else signing in on this
// device never reopens it. The chat itself is never lost: it stays in History. Erasable TypeScript only.

export const OPEN_CHAT_KEY = "hale-open-chat";
export const HIDDEN_AT_KEY = "hale-hidden-at";
/** Where the open chat was kept before 2026-10-20 (localStorage). Cleared so it can't reopen anything. */
export const LEGACY_KEY = "hch-conversation";
export const AWAY_MS = 30 * 60_000;
/** Sent on window when the person comes back after AWAY_MS; the chat screen starts fresh if nothing would be lost. */
export const FRESH_START_EVENT = "hale:fresh-start";

export type Store = { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void };

/** The browser's store, or null where storage is blocked (then every start is fresh, which is safe). */
export function browserStore(kind: "session" | "local"): Store | null {
  try {
    return kind === "session" ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
}

function attempt(action: () => void): void {
  try {
    action();
  } catch {
    // Storage full or blocked: the chat still works for this visit.
  }
}

/** True when the page was hidden for AWAY_MS or more (a reload after the phone threw the page away counts too). */
function awayTooLong(store: Store, now: number): boolean {
  const at = Number(store.getItem(HIDDEN_AT_KEY));
  return Number.isFinite(at) && at > 0 && now - at >= AWAY_MS;
}

/** The chat to reopen for this person in this visit, or null for a new chat. */
export function readOpenChat(store: Store | null, userId: string, now: number): string | null {
  if (!store) return null;
  try {
    if (awayTooLong(store, now)) {
      store.removeItem(OPEN_CHAT_KEY);
      store.removeItem(HIDDEN_AT_KEY);
      return null;
    }
    const saved = JSON.parse(store.getItem(OPEN_CHAT_KEY) ?? "null") as { user?: unknown; chat?: unknown } | null;
    return saved && saved.user === userId && typeof saved.chat === "string" && saved.chat ? saved.chat : null;
  } catch {
    return null;
  }
}

/** Remembers the open chat for this visit (null: a new chat is open, so nothing to reopen). */
export function rememberOpenChat(store: Store | null, userId: string | null, chatId: string | null): void {
  if (!store) return;
  attempt(() => {
    if (!userId || !chatId) store.removeItem(OPEN_CHAT_KEY);
    else store.setItem(OPEN_CHAT_KEY, JSON.stringify({ user: userId, chat: chatId }));
  });
}

/** Forgets the open chat everywhere (signing out, deleting chats or the account), including the old localStorage key. */
export function forgetOpenChat(session: Store | null, local: Store | null): void {
  attempt(() => session?.removeItem(OPEN_CHAT_KEY));
  attempt(() => local?.removeItem(LEGACY_KEY));
}

/** The page went into the background. */
export function noteHidden(store: Store | null, now: number): void {
  attempt(() => store?.setItem(HIDDEN_AT_KEY, String(now)));
}

/**
 * The page is back in front. Returns true when it was away for AWAY_MS or more: the open chat is forgotten, so any
 * screen opened from now starts fresh.
 */
export function noteVisible(store: Store | null, now: number): boolean {
  if (!store) return false;
  try {
    const away = awayTooLong(store, now);
    store.removeItem(HIDDEN_AT_KEY);
    if (away) store.removeItem(OPEN_CHAT_KEY);
    return away;
  } catch {
    return false;
  }
}
