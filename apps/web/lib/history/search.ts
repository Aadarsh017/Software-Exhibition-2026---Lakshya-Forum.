// Searching your chats from the sidebar (DESIGN.md 8.5): titles, and the words inside messages. Pure helpers so they can
// be tested without a browser. Erasable TypeScript only.
import { displayTitle, type ConversationItem } from "./group.ts";

export type MessageHit = { conversation_id: string; content: string | null };
export type SearchResult = { item: ConversationItem; snippet: string | null };

/** At least two letters before we look inside messages; titles are filtered from the first letter. */
export const MIN_MESSAGE_QUERY = 2;

/** A LIKE pattern for the words typed: %, _ and \ match themselves, not "anything". */
export function likePattern(query: string): string {
  return `%${query.trim().replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/** About 70 characters around the first match, on one line, with … where it was cut. */
export function snippetAround(text: string, query: string, radius = 32): string | null {
  const flat = text.replace(/\s+/g, " ").trim();
  const needle = query.trim().toLowerCase();
  if (!needle) return null;
  const at = flat.toLowerCase().indexOf(needle);
  if (at < 0) return null;
  let start = Math.max(0, at - radius);
  let end = Math.min(flat.length, at + needle.length + radius);
  // Cut between words, not inside one.
  const space = flat.indexOf(" ", start);
  if (start > 0 && space >= 0 && space < at) start = space + 1;
  const lastSpace = flat.lastIndexOf(" ", end);
  if (end < flat.length && lastSpace > at + needle.length) end = lastSpace;
  return `${start > 0 ? "…" : ""}${flat.slice(start, end).trim()}${end < flat.length ? "…" : ""}`;
}

/**
 * The chats to show for a search, newest first as in the list: those whose title matches, and those with a message that
 * matches (with the line it was found in). A chat that matches both shows the line too.
 */
export function searchResults(items: ConversationItem[], query: string, hits: MessageHit[]): SearchResult[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return items.map((item) => ({ item, snippet: null }));
  const lines = new Map<string, string>();
  for (const hit of hits) {
    if (lines.has(hit.conversation_id) || typeof hit.content !== "string") continue;
    const line = snippetAround(hit.content, needle);
    if (line) lines.set(hit.conversation_id, line);
  }
  return items
    .filter((item) => displayTitle(item.title).toLowerCase().includes(needle) || lines.has(item.id))
    .map((item) => ({ item, snippet: lines.get(item.id) ?? null }));
}
