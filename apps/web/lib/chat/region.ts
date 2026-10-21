// Emergency numbers by region, chosen from the browser's language and time zone, never from an IP lookup
// (DESIGN.md 7.7). India is the default. These numbers must be verified before launch (PLAN.md Appendix C).
export type Region = "IN" | "US" | "GB" | "EU" | "OTHER";

export type EmergencyNumbers = {
  region: Region;
  primary: { number: string; label: string };
  secondary: { number: string; label: string } | null;
  /** Shown under the buttons when the numbers may not apply. */
  footer: string;
};

const EU_ZONES = /^Europe\/(?!London|Dublin|Moscow|Istanbul|Kyiv|Minsk)/;

export function detectRegion(language: string | undefined, timeZone: string | undefined): Region {
  const lang = (language ?? "").toLowerCase();
  const zone = timeZone ?? "";
  if (zone === "Asia/Kolkata" || zone === "Asia/Calcutta" || lang.endsWith("-in") || lang.startsWith("hi")) return "IN";
  if (zone.startsWith("America/") && (lang === "en-us" || lang === "en")) return "US";
  if (zone === "Europe/London" || lang === "en-gb") return "GB";
  if (EU_ZONES.test(zone)) return "EU";
  if (lang === "en-us") return "US";
  return "OTHER";
}

export function emergencyNumbers(region: Region): EmergencyNumbers {
  const outside = "Outside India, call your local emergency number.";
  switch (region) {
    case "IN":
      return { region, primary: { number: "112", label: "Call 112" }, secondary: { number: "108", label: "Call 108, ambulance" }, footer: outside };
    case "US":
      return { region, primary: { number: "911", label: "Call 911" }, secondary: null, footer: "If you are not in the US, call your local emergency number." };
    case "GB":
      return { region, primary: { number: "999", label: "Call 999" }, secondary: null, footer: "If you are not in the UK, call your local emergency number." };
    case "EU":
      return { region, primary: { number: "112", label: "Call 112" }, secondary: null, footer: "If you are not in the EU, call your local emergency number." };
    default:
      return { region, primary: { number: "112", label: "Call 112" }, secondary: null, footer: "Call your local emergency number if 112 does not connect." };
  }
}
