// The care-level floor (PLAN.md 6.3). The red-flag rules and the model's evidence-backed flags set a
// minimum before the answer is written. The final level is never below it, and nothing here can
// lower a level. The client's own claim is ignored: it could be forged to skip the quota.
import type { ModelFlag } from "./extract.ts";
import { checkRedFlags, careRank, higherCare } from "./vendor/redflags.js";
import type { CareLevel } from "./types.ts";

export type Floor = {
  level: CareLevel | null;
  /** Thoughts of self-harm: the calm crisis flow, not the red emergency one. */
  crisis: boolean;
  /** Plain labels of what raised it, safe to show the person. */
  signs: string[];
  /** Rule ids that matched in the NEW message (for tuning logs). Never text. */
  ruleIds: string[];
  /** Where the level came from, for the log. */
  via: "rules" | "model" | null;
  followUps: { id: string; ask: string }[];
};

/**
 * `current` is the new message and `recent` the person's last few earlier messages. Rules that need several
 * facts together (a baby and a fever) may use both, so "she is 6 weeks old" after "my baby has a fever" counts.
 * A rule that a single message can trigger (chest pain) counts only in the message that says it: otherwise one
 * emergency would turn every later, unrelated question into an emergency too. (Likewise a combined rule counts
 * only in the message that completes it.) The same goes for the model's
 * flags (they need the person's words in the new message) and for the self-harm flow, which carries on through
 * the conversation history the AI is given.
 */
export function computeFloor(current: string, recent: string[], flags: ModelFlag[]): Floor {
  const now = checkRedFlags(current);
  const together = recent.length ? checkRedFlags([...recent, current].join(". ")) : now;
  // A combined rule counts only if the NEW message completes it. If the earlier messages already made it
  // match on their own, it has been raised before and is not raised again for every later question.
  const earlier = recent.length ? checkRedFlags(recent.join(". ")) : null;
  const fromContext = together.matches.filter((match) => match.compound && !earlier?.matches.some((before) => before.id === match.id));

  const signs: string[] = [];
  for (const match of [...now.matches, ...fromContext]) {
    if (!signs.includes(match.sign)) signs.push(match.sign);
  }
  let level: CareLevel | null = (now.level as CareLevel | null) ?? null;
  for (const match of fromContext) level = higherCare(level, match.level);
  const ruleLevel = level;

  for (const flag of flags) {
    level = higherCare(level, flag.level);
    const quote = `“${flag.evidence}”`;
    if (!signs.includes(quote) && signs.length < 4) signs.push(quote);
  }

  return {
    level,
    crisis: now.crisis || flags.some((flag) => flag.crisis),
    signs: signs.slice(0, 4),
    // "model-crisis": the model noticed self-harm the rules didn't. Saved with the answer, so a reopened chat still shows
    // the calm crisis presentation (bug review 2026-10-20).
    ruleIds: [...now.matches.map((match) => match.id), ...(flags.some((flag) => flag.crisis) && !now.crisis ? ["model-crisis"] : [])],
    via: ruleLevel ? "rules" : level ? "model" : null,
    followUps: now.followUps.length ? now.followUps : together.followUps,
  };
}

export const isEmergency = (level: CareLevel | null): boolean => level !== null && careRank(level) >= careRank("emergency");

/** The level to show: never below the floor, and a missing model level counts as the floor (or "doctor"). */
export function finalLevel(floor: Floor, modelLevel: CareLevel | null | undefined): CareLevel {
  const base = modelLevel && careRank(modelLevel) >= 0 ? modelLevel : null;
  const lowest = floor.level ?? "doctor";
  return base ? higherCare(base, floor.level ?? base) : lowest;
}

/** True when the floor, not the model, decided the level. */
export function wasRaised(floor: Floor, modelLevel: CareLevel | null | undefined): boolean {
  if (!floor.level) return false;
  const base = modelLevel && careRank(modelLevel) >= 0 ? modelLevel : null;
  return base === null || careRank(floor.level) > careRank(base);
}

export function raisedNote(floor: Floor, language: string): string {
  const what = floor.signs.join("; ");
  return language === "hi"
    ? `आपने बताया: ${what}। इसलिए मैंने इसे ज़्यादा ज़रूरी माना है।`
    : `We raised this because you mentioned: ${what}.`;
}
