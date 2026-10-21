// Grounding: fetch short, quotable passages from trusted public sources, in parallel, with a cache,
// per-source timeouts and an overall deadline. Whatever arrives in time is used; the rest is left out.
import { resolveDrug } from "../aliases.ts";
import type { Source, StatusState } from "../types.ts";
import type { Fetch, Repo } from "../types.ts";
import { chooseLabelPassage, findLabel, safeDrugName, type Label } from "./openfda.ts";
import { chooseTopicPassage, safeTerm, searchTopic, type NlmIdentity, type Topic } from "./medlineplus.ts";

export type GroundDeps = {
  fetch: Fetch;
  repo: Pick<Repo, "cacheGet" | "cacheSet">;
  now: () => number;
  perSourceTimeoutMs: number;
  overallTimeoutMs: number;
  who: NlmIdentity;
  openFdaKey: string;
  onStatus?: (step: "medlineplus" | "fda", state: StatusState) => void;
  onWarn?: (event: string, fields: Record<string, string | number>) => void;
};

export type GroundInput = {
  /** Plain topic names (already normalized, never a sentence). */
  topics: string[];
  /** Medicine names as the person wrote them. */
  drugs: string[];
  /** Words from the person's message, used only on this machine to pick the best passages. */
  focus: string[];
  /** True when the question is about a baby or a child, so a children's label fits better. */
  forChild?: boolean;
};

export type Grounding = {
  sources: Source[];
  medlineplus: StatusState;
  fda: StatusState;
  /** Medicines the person named that are prescription-only or have no US over-the-counter label. */
  unlabelled: { name: string; reason: "prescription" | "no_label" }[];
  /** The medicines the person named (as written, and the plain generic name used for lookup). */
  drugNames: { asWritten: string; generic: string }[];
  /** Which source holds the label for each medicine that was found. */
  drugSources: { asWritten: string; generic: string; id: string }[];
};

const HIT_TTL_S = 12 * 3600;
const MISS_TTL_S = 3600;
const MAX_TOPICS = 2;
const MAX_DRUGS = 2;

type Cached<T> = { found: T | null; at: string };

async function cached<T>(deps: GroundDeps, key: string, source: string, load: () => Promise<T | null>): Promise<{ value: T | null; at: string; hit: boolean }> {
  try {
    const hit = (await deps.repo.cacheGet(key)) as Cached<T> | undefined;
    if (hit && typeof hit === "object" && "found" in hit && typeof hit.at === "string") return { value: hit.found, at: hit.at, hit: true };
  } catch {
    deps.onWarn?.("cache_read_failed", { source });
  }
  const value = await load();
  const at = new Date(deps.now()).toISOString();
  try {
    await deps.repo.cacheSet(key, source, { found: value, at } satisfies Cached<T>, value ? HIT_TTL_S : MISS_TTL_S);
  } catch {
    deps.onWarn?.("cache_write_failed", { source });
  }
  return { value, at, hit: false };
}

function dedupe(list: string[], clean: (value: string) => string | null, max: number): string[] {
  const out: string[] = [];
  for (const item of list) {
    const value = clean(item);
    if (value && !out.includes(value)) out.push(value);
    if (out.length >= max) break;
  }
  return out;
}

export async function ground(input: GroundInput, deps: GroundDeps): Promise<Grounding> {
  const topicTerms = dedupe(input.topics, safeTerm, MAX_TOPICS);
  const drugs = input.drugs.slice(0, 4).map(resolveDrug);
  const unlabelled: Grounding["unlabelled"] = [];
  const lookups: { asWritten: string; generic: string; lookup: string }[] = [];
  for (const drug of drugs) {
    if (drug.prescription) {
      unlabelled.push({ name: drug.generic, reason: "prescription" });
      continue;
    }
    const names = dedupe(drug.lookup, safeDrugName, 1);
    if (!names.length) {
      unlabelled.push({ name: drug.generic || drug.asWritten, reason: "no_label" });
      continue;
    }
    if (lookups.length < MAX_DRUGS) lookups.push({ asWritten: drug.asWritten, generic: drug.generic, lookup: names[0] });
  }

  const abort = new AbortController();
  let timedOut = false;
  const overall = setTimeout(() => {
    timedOut = true;
    abort.abort();
  }, deps.overallTimeoutMs);
  const within = () => AbortSignal.any([abort.signal, AbortSignal.timeout(deps.perSourceTimeoutMs)]);

  const topicResults: { term: string; topic: Topic | null; at: string }[] = [];
  const labelResults: { lookup: string; label: Label | null; at: string }[] = [];
  const failures = { medlineplus: 0, fda: 0 };
  const reported = { medlineplus: false, fda: false };
  const report = (step: "medlineplus" | "fda", state: StatusState) => {
    if (reported[step]) return;
    reported[step] = true;
    deps.onStatus?.(step, state);
  };

  if (topicTerms.length) deps.onStatus?.("medlineplus", "active");
  else report("medlineplus", "skipped");
  if (lookups.length) deps.onStatus?.("fda", "active");
  else report("fda", "skipped");

  const topicJobs = topicTerms.map(async (term) => {
    try {
      // v2: pages are now checked against the term by name, so pages picked by the old rule are not reused.
      const result = await cached<Topic>(deps, `medlineplus:v2:${term}`, "medlineplus", async () => {
        const topics = await searchTopic(term, { fetch: deps.fetch, who: deps.who, signal: within() });
        return topics[0] ?? null;
      });
      topicResults.push({ term, topic: result.value, at: result.at });
    } catch {
      failures.medlineplus += 1;
    }
  });
  const labelJobs = lookups.map(async ({ lookup }) => {
    try {
      const audience = input.forChild ? "child" : "adult";
      const result = await cached<Label>(deps, `openfda:v2:${lookup}:${audience}`, "openfda", () =>
        findLabel(lookup, { fetch: deps.fetch, apiKey: deps.openFdaKey, signal: within(), forChild: input.forChild }),
      );
      labelResults.push({ lookup, label: result.value, at: result.at });
    } catch {
      failures.fda += 1;
    }
  });

  // A source is reported the moment all of its own lookups have finished (it is "failed" only when
  // none of them produced an answer and at least one broke).
  const sourceDone = (step: "medlineplus" | "fda", jobs: Promise<void>[], answered: () => number) =>
    Promise.allSettled(jobs).then(() => {
      if (jobs.length) report(step, answered() === 0 && failures[step] > 0 ? "failed" : "done");
    });
  await Promise.race([
    Promise.all([
      sourceDone("medlineplus", topicJobs, () => topicResults.length),
      sourceDone("fda", labelJobs, () => labelResults.length),
    ]),
    new Promise<void>((resolve) => abort.signal.addEventListener("abort", () => resolve(), { once: true })),
  ]);
  clearTimeout(overall);
  abort.abort(); // anything still running stops here
  // After the deadline, a source that has not answered is reported as failed.
  if (topicJobs.length) report("medlineplus", topicResults.length ? "done" : "failed");
  if (labelJobs.length) report("fda", labelResults.length ? "done" : "failed");
  if (timedOut) deps.onWarn?.("ground_deadline", { count: topicResults.length + labelResults.length });

  const sources: Source[] = [];
  const drugSources: Grounding["drugSources"] = [];
  const seenUrls = new Set<string>();
  const add = (source: Omit<Source, "id">): Source | null => {
    const existing = sources.find((item) => item.url === source.url);
    if (existing) return existing;
    if (!source.passage || seenUrls.has(source.url)) return null;
    seenUrls.add(source.url);
    const created = { ...source, id: `S${sources.length + 1}` };
    sources.push(created);
    return created;
  };
  // Keep the order the person asked in, not the order the answers arrived.
  for (const term of topicTerms) {
    const result = topicResults.find((entry) => entry.term === term);
    if (result?.topic) {
      add({
        kind: "condition",
        publisher: "MedlinePlus (U.S. National Library of Medicine)",
        title: result.topic.title,
        url: result.topic.url,
        retrieved_at: result.at,
        passage: chooseTopicPassage(result.topic, input.focus),
      });
    }
  }
  for (const { lookup, generic, asWritten } of lookups) {
    const result = labelResults.find((entry) => entry.lookup === lookup);
    if (result?.label) {
      const added = add({
        kind: "medicine",
        publisher: "U.S. FDA drug label, via DailyMed",
        title: `${result.label.name} (${generic || asWritten}) label`,
        url: result.label.url,
        retrieved_at: result.at,
        passage: chooseLabelPassage(result.label),
      });
      if (added) drugSources.push({ asWritten, generic, id: added.id });
      else unlabelled.push({ name: generic || asWritten, reason: "no_label" });
    } else if (result) {
      unlabelled.push({ name: generic || asWritten, reason: "no_label" });
    }
  }

  const state = (step: "medlineplus" | "fda", wanted: number, got: number): StatusState =>
    wanted === 0 ? "skipped" : got > 0 ? "done" : failures[step] > 0 || timedOut ? "failed" : "done";
  return {
    sources,
    medlineplus: state("medlineplus", topicTerms.length, sources.filter((source) => source.kind === "condition").length),
    fda: state("fda", lookups.length, sources.filter((source) => source.kind === "medicine").length),
    unlabelled,
    drugNames: drugs.map((drug) => ({ asWritten: drug.asWritten, generic: drug.generic })),
    drugSources,
  };
}
