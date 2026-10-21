// "While you wait" lines for the emergency sheet (DESIGN.md 7.7). A vetted static table keyed by rule id,
// generic by default. DRAFT: a physician must review every line before launch (PLAN.md 6.12).
// Only things that are safe in every case belong here: no first-aid steps that could harm if wrong.
export const GENERIC_WAIT: readonly string[] = [
  "Stay with the person",
  "Don't drive yourself or them",
  "Unlock the door and switch on a light so help can find you",
  "Follow what the person on the phone tells you",
];

export function whileYouWait(_ruleIds: readonly string[]): readonly string[] {
  return GENERIC_WAIT;
}
