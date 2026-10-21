// Questions other screens can start a chat with, by key (`/app?ask=readings`). Only these exact texts: a link can't put
// its own words in the message box. The person still reads it and taps send (DESIGN.md 8.6d).
export const ASK_PRESETS: Record<string, string> = {
  readings: "Can you look at my blood pressure and sugar readings from the last two weeks and tell me what they show?",
};

export function presetFrom(search: string): string | null {
  const key = new URLSearchParams(search).get("ask");
  return key && Object.hasOwn(ASK_PRESETS, key) ? ASK_PRESETS[key]! : null;
}
