// openFDA over-the-counter drug labels. Only a generic drug name is sent, never a sentence.
// Gotchas found by testing (PLAN.md 3.5): US generic names only ("acetaminophen", not "paracetamol");
// a search with no match answers HTTP 404, which here means "none", not "broken"; quotes make a
// phrase; "?" and "!" make a 400. The label's dosing section is never read, on purpose.
import { hasDoseOrSchedule } from "../dose.ts";
import { clip, htmlToText, splitSentences } from "../text.ts";
import type { Fetch } from "../types.ts";

export type Label = {
  name: string; // brand or product name
  generic: string;
  set_id: string;
  effective: string | null; // YYYY-MM-DD
  url: string; // DailyMed page for this exact label
  sections: Record<(typeof SECTIONS)[number][0], string>;
};

// [field in the openFDA record, prefix shown before the quoted text]
const SECTIONS = [
  ["purpose", "Purpose"],
  ["do_not_use", "Do not use"],
  ["ask_doctor", "Ask a doctor before use"],
  ["ask_doctor_or_pharmacist", "Ask a doctor or pharmacist before use"],
  ["stop_use", "Stop use and ask a doctor"],
  ["pregnancy_or_breast_feeding", "Pregnancy and breast-feeding"],
  ["when_using", "When using this product"],
  ["warnings", "Warnings"],
] as const;

const ENDPOINT = "https://api.fda.gov/drug/label.json";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Only plain generic names are allowed out of the building. */
export function safeDrugName(name: string): string | null {
  const clean = name.toLowerCase().replace(/[^a-z\s-]/g, " ").replace(/\s+/g, " ").trim();
  return clean.length >= 4 && clean.length <= 40 ? clean : null;
}

export function buildUrl(generic: string, apiKey: string, exact: boolean, limit = 6): string {
  const field = exact ? "openfda.generic_name.exact" : "openfda.generic_name";
  const value = exact ? generic.toUpperCase() : generic;
  const url = new URL(ENDPOINT);
  url.searchParams.set("search", `${field}:"${value}" AND openfda.product_type:"HUMAN OTC DRUG"`);
  url.searchParams.set("sort", "effective_time:desc");
  url.searchParams.set("limit", String(limit));
  if (apiKey) url.searchParams.set("api_key", apiKey);
  return url.toString();
}

const first = (value: unknown): string => (Array.isArray(value) && typeof value[0] === "string" ? value[0] : "");

function parseRecord(record: Record<string, unknown> | undefined): Label | null {
  if (!record) return null;
  const setId = typeof record.set_id === "string" ? record.set_id : "";
  if (!UUID.test(setId)) return null;
  const openfda = (record.openfda ?? {}) as Record<string, unknown>;
  const sections = {} as Label["sections"];
  for (const [field] of SECTIONS) {
    const raw = first(record[field]);
    sections[field] = raw ? htmlToText(raw).replace(/\s+/g, " ").trim() : "";
  }
  const effective = typeof record.effective_time === "string" && /^\d{8}$/.test(record.effective_time)
    ? `${record.effective_time.slice(0, 4)}-${record.effective_time.slice(4, 6)}-${record.effective_time.slice(6, 8)}`
    : null;
  return {
    name: first(openfda.brand_name) || first(openfda.generic_name) || "Over-the-counter medicine",
    generic: first(openfda.generic_name).toLowerCase(),
    set_id: setId,
    effective,
    url: `https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${setId}`,
    sections,
  };
}

export function parseLabel(body: unknown): Label | null {
  return parseRecord((body as { results?: Record<string, unknown>[] } | null)?.results?.[0]);
}

export function parseLabels(body: unknown): Label[] {
  const list = (body as { results?: Record<string, unknown>[] } | null)?.results;
  return (Array.isArray(list) ? list : []).map((record) => parseRecord(record)).filter((label): label is Label => label !== null);
}

const PEDIATRIC = /\b(?:child|children|childrens|child's|kids?|infants?|pediatric|paediatric|junior|babies|baby|toddlers?)\b/i;

/**
 * The newest label is often a children's product. Pick one for the right audience: an adult product when
 * the question is about an adult, a children's product when it is about a child, else just the newest.
 */
export function pickLabel(labels: Label[], forChild: boolean): Label | null {
  const fits = labels.find((label) => PEDIATRIC.test(`${label.name} ${label.generic}`) === forChild);
  return fits ?? labels[0] ?? null;
}

async function queryOnce(fetchFn: Fetch, url: string, signal: AbortSignal, forChild: boolean): Promise<Label | null> {
  const response = await fetchFn(url, { signal, headers: { Accept: "application/json" } });
  if (response.status === 404) {
    await response.body?.cancel().catch(() => {});
    return null; // openFDA says "no matches" with a 404
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`openfda_${response.status}`);
  }
  return pickLabel(parseLabels(await response.json()), forChild);
}

/** Newest single-ingredient OTC label for a generic name, or null. Tries the exact index first. */
export async function findLabel(generic: string, deps: { fetch: Fetch; apiKey: string; signal: AbortSignal; forChild?: boolean }): Promise<Label | null> {
  const clean = safeDrugName(generic);
  if (!clean) return null;
  const forChild = deps.forChild === true;
  const exact = await queryOnce(deps.fetch, buildUrl(clean, deps.apiKey, true), deps.signal, forChild);
  if (exact) return exact;
  return queryOnce(deps.fetch, buildUrl(clean, deps.apiKey, false), deps.signal, forChild);
}

/**
 * The part of the label we quote: purpose, what not to do, when to ask a doctor, when to stop,
 * pregnancy. Sentences that state an amount or a schedule are left out, so no dose can leak.
 */
export function chooseLabelPassage(label: Label, maxChars = 600): string {
  const parts: string[] = [];
  let used = 0;
  for (const [field, heading] of SECTIONS) {
    const text = label.sections[field];
    if (!text) continue;
    const safe = splitSentences(text.replace(/^(Purpose|Warnings?|Uses?|Do not use|Ask a doctor before use if)\s*:?\s*/i, ""))
      .filter((sentence) => !hasDoseOrSchedule(sentence) && sentence.length < 280)
      .slice(0, 2)
      .join(" ");
    if (!safe) continue;
    const piece = `${heading}: ${clip(safe, 170)}`;
    if (used + piece.length + 1 > maxChars) break;
    parts.push(piece);
    used += piece.length + 1;
  }
  return parts.join(" ");
}
