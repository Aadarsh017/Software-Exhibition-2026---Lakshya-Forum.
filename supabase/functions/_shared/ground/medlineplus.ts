// MedlinePlus health topics (U.S. National Library of Medicine), through the Web Service.
// Only a plain topic term is sent ("headache"), never the person's sentence or any identifier.
// Gotchas found by testing (PLAN.md 3.5): XML only; spaces mean AND; use title:"…"; matches come
// wrapped in <span> tags even in titles; a term with no match returns a spelling suggestion.
// A plain search matches anywhere in a page, so its top hit is often a page that only mentions the
// term in passing ("sleep difficulty" ranks Lewy Body Dementia first): every hit must be named for it.
import { contentWords, decodeEntities, htmlToText } from "../text.ts";
import type { Fetch } from "../types.ts";

export type Topic = {
  title: string;
  url: string;
  summary: string; // plain text, paragraphs separated by a blank line
  aliases: string[]; // MedlinePlus's other names for the page ("Menstrual Cramps" for Period Pain)
};

export type NlmIdentity = { tool: string; email: string };

const ENDPOINT = "https://wsearch.nlm.nih.gov/ws/query";

/** Only plain, short terms are allowed out of the building. */
export function safeTerm(term: string): string | null {
  const clean = term.toLowerCase().replace(/[^a-z\s'-]/g, " ").replace(/\s+/g, " ").trim();
  if (clean.length < 3 || clean.length > 40 || clean.split(" ").length > 4) return null;
  return clean;
}

export function buildUrl(term: string, who: NlmIdentity, titleOnly: boolean, retmax = 3): string {
  const url = new URL(ENDPOINT);
  url.searchParams.set("db", "healthTopics");
  url.searchParams.set("term", titleOnly ? `title:"${term}"` : term);
  url.searchParams.set("retmax", String(retmax));
  if (who.tool) url.searchParams.set("tool", who.tool);
  if (who.email) url.searchParams.set("email", who.email);
  return url.toString();
}

/** Reads the XML reply with plain pattern matching: the shape is small and fixed. */
export function parseSearchResult(xml: string): { topics: Topic[]; spelling: string | null } {
  const topics: Topic[] = [];
  for (const block of xml.matchAll(/<document\b([^>]*)>([\s\S]*?)<\/document>/g)) {
    const url = /\burl="([^"]+)"/.exec(block[1])?.[1];
    if (!url) continue;
    const link = decodeEntities(url);
    if (!link.startsWith("https://medlineplus.gov/")) continue;
    // The XML holds escaped HTML: decode the XML escapes first, then turn the HTML into text.
    const contents = (name: string) =>
      [...block[2].matchAll(new RegExp(`<content name="${name}">([\\s\\S]*?)</content>`, "g"))].map((found) => htmlToText(decodeEntities(found[1])));
    const name = (text: string) => text.replace(/\s+/g, " ").trim();
    const title = name(contents("title")[0] ?? "");
    const summary = (contents("FullSummary")[0] ?? "")
      .split(/\n{2,}/)
      .map((paragraph) => paragraph.trim())
      .filter((paragraph) => paragraph && !/^(NIH|FDA|CDC|WHO|Also called):/i.test(paragraph))
      .join("\n\n");
    const aliases = contents("altTitle").map(name).filter(Boolean);
    if (title && summary) topics.push({ title, url: link, summary, aliases });
  }
  const spelling = /<spellingCorrection>([\s\S]*?)<\/spellingCorrection>/.exec(xml)?.[1];
  const corrected = spelling ? safeTerm(decodeEntities(spelling).replace(/^title:/i, "").replace(/"/g, "")) : null;
  return { topics, spelling: corrected };
}

async function fetchXml(fetchFn: Fetch, url: string, signal: AbortSignal): Promise<string> {
  const response = await fetchFn(url, { signal, headers: { Accept: "application/xml" } });
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`medlineplus_${response.status}`);
  }
  return response.text();
}

/** A rough word stem, so "sleeping", "sleepy" and "sleep" (or "rashes" and "rash") compare equal. */
function stem(word: string): string {
  let out = word;
  const cut = (suffix: string, add = "") => {
    if (!out.endsWith(suffix) || out.length - suffix.length + add.length < 3) return false;
    out = out.slice(0, out.length - suffix.length) + add;
    return true;
  };
  if (!cut("ies", "y") && !/(?:ss|us|is)$/.test(out)) cut("s");
  cut("ing");
  cut("e");
  cut("y");
  return out;
}

const stems = (text: string) => [...new Set(contentWords(text.replace(/[^a-z]+/gi, " ")).map(stem))];

// Words that say what kind of complaint it is, not what it is about. They never make a page fit on
// their own, and a page name may carry them ("Sleep Disorders", "Neck Injuries and Disorders").
// ("sore" is left out on purpose: "Cold Sores" is not a page about a cold.)
const GENERIC = new Set(
  "pain ache problem trouble difficulty issue disorder disease symptom condition infection injury mild high low severe bad chronic acute sudden constant frequent body feeling health care sign change poor lack loss"
    .split(" ")
    .map(stem),
);

/**
 * How well one of a page's names (its title or an alternate name) fits a term:
 * 3 a name is the term ("Menstrual Cramps" for "menstrual cramps");
 * 2 a name is about the term and nothing else ("Healthy Sleep" for "trouble sleeping");
 * 1 a name shares a telling word with the term ("Common Cold" for "cold");
 * 0 nothing in the names: the page only mentions the term somewhere ("Lewy Body Dementia" for "sleep difficulty").
 * Half a point more when the name ends on a word of the term, since that word is what the page is
 * about ("Common Cold" beats "Cold Sores" for "cold").
 */
export function nameFit(topic: Pick<Topic, "title" | "aliases">, term: string): number {
  const wanted = stems(term);
  const telling = wanted.filter((word) => !GENERIC.has(word));
  let best = 0;
  for (const name of [topic.title, ...topic.aliases]) {
    const words = stems(name);
    if (words.length === wanted.length && wanted.every((word) => words.includes(word))) return 3;
    if (!telling.some((word) => words.includes(word))) continue;
    const level = words.every((word) => wanted.includes(word) || GENERIC.has(word)) ? 2 : 1;
    const last = stems(name.replace(/\([^)]*\)/g, " ")).at(-1) ?? "";
    best = Math.max(best, level + (wanted.includes(last) ? 0.5 : 0));
  }
  return best;
}

/** The pages that fit the term at least `min`, best first (NLM's order among equals). */
function fitting(topics: Topic[], term: string, min: number): Topic[] {
  return topics
    .map((topic) => ({ topic, fit: nameFit(topic, term) }))
    .filter((entry) => entry.fit >= min)
    .sort((a, b) => b.fit - a.fit)
    .map((entry) => entry.topic);
}

/**
 * Looks up one topic. Tries the exact title, then NLM's own spelling suggestion, then a plain search.
 * A title match must share a telling word with the term, and the closest name wins ("Stress" over
 * "Post-Traumatic Stress Disorder"). A plain search is noisy, so its one kept hit must be named for
 * the term and nothing else; a page that only mentions the term is never used.
 */
export async function searchTopic(term: string, deps: { fetch: Fetch; who: NlmIdentity; signal: AbortSignal }): Promise<Topic[]> {
  const clean = safeTerm(term);
  if (!clean) return [];
  const run = async (query: string, titleOnly: boolean) =>
    parseSearchResult(await fetchXml(deps.fetch, buildUrl(query, deps.who, titleOnly), deps.signal));

  const exact = await run(clean, true);
  const named = fitting(exact.topics, clean, 1);
  if (named.length) return named;
  if (exact.spelling && exact.spelling !== clean) {
    const fixed = fitting((await run(exact.spelling, true)).topics, exact.spelling, 1);
    if (fixed.length) return fixed;
  }
  const loose = await run(clean, false);
  return fitting(loose.topics, clean, 2).slice(0, 1);
}

/** The sentences of a topic that best fit what the person described, plus any warning sentences. */
const WARNING = /\b(?:get medical help|medical help right away|call (?:your|a|911|112)|emergency|seek|right away|immediately|let your (?:health care )?provider know|see (?:a|your) (?:doctor|health)|serious)\b/i;

export function chooseTopicPassage(topic: Topic, focus: string[], maxChars = 600): string {
  const sentences = topic.summary
    .split(/\n{2,}/)
    .flatMap((paragraph) => paragraph.replace(/\s+/g, " ").split(/(?<=[.!?])\s+(?=[A-Z])/))
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 20);
  const wanted = new Set(focus.flatMap((phrase) => contentWords(phrase)));
  const scored = sentences.map((text, index) => {
    const words = contentWords(text);
    const overlap = words.filter((word) => wanted.has(word)).length;
    const warns = WARNING.test(text) ? 2 : 0;
    const early = index === 0 ? 1.5 : 0; // the opening sentence defines the topic
    return { text, index, score: overlap + warns + early };
  });
  const picked: typeof scored = [];
  let length = 0;
  for (const candidate of [...scored].sort((a, b) => b.score - a.score || a.index - b.index)) {
    if (length + candidate.text.length + 1 > maxChars) continue;
    picked.push(candidate);
    length += candidate.text.length + 1;
  }
  return picked
    .sort((a, b) => a.index - b.index)
    .map((item) => item.text)
    .join(" ");
}
