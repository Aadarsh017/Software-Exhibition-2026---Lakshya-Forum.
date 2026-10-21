// The product never gives amounts of medicine (PLAN.md 6.7). These patterns find them so they can
// be removed from anything the model writes and from the label text we quote.

const UNIT =
  "(?:mg|mcg|µg|μg|ug|milligrams?|micrograms?|grams?|gm|g|ml|millilitres?|milliliters?|iu|units?|tablets?|tabs?|capsules?|caps|caplets?|pills?|drops?|teaspoons?|tsp|tablespoons?|tbsp|spoons?(?:ful)?|sachets?|puffs?|sprays?|patch(?:es)?|suppositor(?:y|ies)|doses?)";
const NUMBER_WORD = "(?:one|two|three|four|five|six|half|a\\s+half|1/2|quarter|a\\s+couple\\s+of)";

// "500 mg", "2.5 ml", "1-2 tablets", "1,000 mg", "two tablets", "half a tablet".
const AMOUNT = new RegExp(
  `(?<![\\w.])(?:\\d[\\d,]*(?:\\.\\d+)?(?:\\s*(?:-|–|to)\\s*\\d[\\d,]*(?:\\.\\d+)?)?\\s*${UNIT}\\b|${NUMBER_WORD}\\s+(?:of\\s+(?:a|an|the)\\s+)?${UNIT}\\b|half\\s+(?:a|an|the)\\s+${UNIT}\\b)`,
  "i",
);

// "every 6 hours", "3 times a day", "twice daily", "once a day": a dosing schedule.
const SCHEDULE = /(?<![\w.])(?:every\s+\d+(?:\s*(?:-|–|to)\s*\d+)?\s*(?:hours?|hrs?)|\d+\s*(?:x|times)\s*(?:a|per|each)\s*day|(?:once|twice|thrice)\s+(?:a|per|each)?\s*day|(?:once|twice)\s+daily|(?:one|two|three)\s+times\s+(?:a|per)\s+day)/i;

export const DOSE_REPLACEMENT = "Follow the instructions on the label, or ask a pharmacist how much to take.";

/** True if the text states an amount of a medicine (not a temperature, a duration or a count of days). */
export function hasDose(text: string): boolean {
  return AMOUNT.test(text);
}

/** True if the text states how often to take something. Applied to medicine notes only. */
export function hasSchedule(text: string): boolean {
  return SCHEDULE.test(text);
}

export function hasDoseOrSchedule(text: string): boolean {
  return hasDose(text) || hasSchedule(text);
}

const AMOUNT_ALL = new RegExp(AMOUNT.source, "gi");
const SCHEDULE_ALL = new RegExp(SCHEDULE.source, "gi");

const squeeze = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();

/** Every amount or schedule the text states, lowercased. */
export function doseMentions(text: string): string[] {
  return [...text.matchAll(AMOUNT_ALL), ...text.matchAll(SCHEDULE_ALL)].map((match) => squeeze(match[0]));
}

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * True if every amount in `text` also appears in `source` (so the text only repeats what a person said). Whole amounts
 * only (bug review 2026-10-20): "5 mg" is not in "25 mg", and "1 tablet" is not in "11 tablets".
 */
export function dosesComeFrom(text: string, source: string): boolean {
  const original = squeeze(source);
  return doseMentions(text).every((mention) => new RegExp(`(?<![\\w.,])${escapeRegex(mention)}(?!\\d)`).test(original));
}
