// Pure helpers for the list of past chats (DESIGN.md 7.8, 8.6). Erasable TypeScript, tested under Node.
import type { CareLevel } from "../chat/types.ts";

export type ConversationItem = {
  id: string;
  title: string | null;
  max_care_level: CareLevel | null;
  updated_at: string;
};

export type Group = { label: "Today" | "Yesterday" | "Earlier"; items: ConversationItem[] };

const dayKey = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;

/** Newest first, grouped by the person's own calendar days. Empty groups are left out. */
export function groupByDay(items: ConversationItem[], now: Date): Group[] {
  const today = dayKey(now);
  const yesterdayDate = new Date(now);
  yesterdayDate.setDate(now.getDate() - 1);
  const yesterday = dayKey(yesterdayDate);
  const groups: Group[] = [
    { label: "Today", items: [] },
    { label: "Yesterday", items: [] },
    { label: "Earlier", items: [] },
  ];
  const sorted = [...items].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
  for (const item of sorted) {
    const key = dayKey(new Date(item.updated_at));
    const group = key === today ? groups[0] : key === yesterday ? groups[1] : groups[2];
    group?.items.push(item);
  }
  return groups.filter((group) => group.items.length > 0);
}

export function displayTitle(title: string | null): string {
  const clean = (title ?? "").replace(/\s+/g, " ").trim();
  return clean || "Untitled chat";
}

/** Case-insensitive match on the title. */
export function filterByTitle(items: ConversationItem[], query: string): ConversationItem[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return items;
  return items.filter((item) => displayTitle(item.title).toLowerCase().includes(needle));
}

/** A short time for the list: "11:42 PM" today, "Yesterday", or "17 Oct". */
export function formatWhen(iso: string, now: Date): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  if (dayKey(date) === dayKey(now)) return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (dayKey(date) === dayKey(yesterday)) return "Yesterday";
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export const isUrgent = (level: CareLevel | null): boolean => level === "emergency" || level === "ambulance";

/** A new title for a chat: one line, at most 120 characters (the database limit). Empty means "no change". */
export function cleanTitle(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 120);
}
