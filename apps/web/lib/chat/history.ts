// Turns saved messages (rows from the `messages` table) back into turns, so a reload shows the chat again.
import { newTurn } from "./reducer.ts";
import type { Answer, CareLevel, Source, Turn } from "./types.ts";

export type MessageRow = {
  id: string;
  /** The id the browser sent the question with (user rows; older rows may have none). */
  client_message_id?: string | null;
  role: "user" | "assistant";
  content: string | null;
  answer: Answer | null;
  sources: Source[] | null;
  care_level: CareLevel | null;
  raised_by_rules: boolean | null;
  rule_ids: string[] | null;
  reply_to: string | null;
  created_at: string;
};

/** A saved question's turn id: the id it was sent with, so a retry finds it on the server; the row id for old rows. */
export const turnIdOf = (row: MessageRow): string => row.client_message_id || row.id;

export function turnsFromRows(rows: MessageRow[]): Turn[] {
  const answers = new Map<string, MessageRow>();
  for (const row of rows) if (row.role === "assistant" && row.reply_to) answers.set(row.reply_to, row);
  const turns: Turn[] = [];
  for (const row of rows) {
    if (row.role !== "user") continue;
    const turn = newTurn(turnIdOf(row), row.content ?? "");
    const reply = answers.get(row.id);
    if (!reply || !reply.answer) {
      turns.push({ ...turn, status: "stopped" }); // asked, but no saved answer: offer a retry
      continue;
    }
    const sources = reply.sources ?? [];
    turns.push({
      ...turn,
      status: "done",
      steps: {
        read: "done",
        safety: "done",
        medlineplus: sources.some((s) => s.kind === "condition") ? "done" : "skipped",
        fda: sources.some((s) => s.kind === "medicine") ? "done" : "skipped",
        write: "done",
      },
      sources,
      sourcesArrived: true,
      // "model-crisis": the server's model noticed self-harm the rules didn't (bug review 2026-10-20).
      redFlag: (reply.rule_ids ?? []).some((id) => id === "self-harm" || id === "model-crisis")
        ? { level: "ambulance", rule_ids: reply.rule_ids ?? [], crisis: true, signs: [], source: "rules" }
        : null,
      fields: reply.answer,
      messageId: reply.id,
      done: {
        message_id: reply.id,
        usage: { tokens_in: 0, tokens_out: 0 },
        latency_ms: 0,
        degraded: false,
        degraded_reason: null,
        saved: true,
        care_level: reply.care_level,
        raised_by_rules: reply.raised_by_rules === true,
        replayed: true,
      },
    });
  }
  return turns;
}

/**
 * When chats are not saved, the server has no history, so the browser sends the last few turns itself
 * (the person's words and the gist of each answer). Most recent last, at most `max` items.
 */
export function historyForServer(turns: Turn[], excludeId: string, max = 12): { role: "user" | "assistant"; text: string }[] {
  const items: { role: "user" | "assistant"; text: string }[] = [];
  for (const turn of turns) {
    if (turn.id === excludeId) continue;
    items.push({ role: "user", text: turn.userText.slice(0, 2000) });
    // The same as the server's digest: the headline, the summary, and the questions Nox asked (so "Paracetamol" is understood).
    const asked = (turn.fields.questions_for_you ?? []).filter(Boolean);
    const gist = [turn.fields.headline, turn.fields.summary, asked.length ? `I asked: ${asked.join(" ")}` : null].filter(Boolean).join(" ");
    if (gist) items.push({ role: "assistant", text: gist.slice(0, 2000) });
  }
  return items.slice(-max);
}
