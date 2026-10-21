// Turns what the model wrote into something safe to show (PLAN.md 6.5, 6.6), one field at a time so
// fields can be streamed the moment they are complete. Every rule here can only REMOVE or SOFTEN
// content, or raise the care level. Nothing here trusts the model:
//   - amounts of medicine are replaced with "follow the label"
//   - web addresses and markup are stripped
//   - "you have <disease>" statements are dropped
//   - medicines are limited to the ones the person named, with fixed wording for prescription ones, plus everyday
//     medicines from the checked list in otc.ts (fixed wording, only when the profile checks allowed them)
//   - citation ids that were not retrieved are dropped, and so are citations that do not fit the claim
//   - the care level is never below the floor, and emergencies get no home remedies
//   - a short reply (PLAN.md §12) is a headline and one or two sentences, unless the level is an emergency
import { findDrugMentions, resolveDrug } from "./aliases.ts";
import { finalLevel, isEmergency, raisedNote, wasRaised, type Floor } from "./care.ts";
import { DOSE_REPLACEMENT, hasDose, hasDoseOrSchedule } from "./dose.ts";
import { matchOtc, nameMeans, type OtcOptions } from "./otc.ts";
import { clip, contentWords, splitSentences } from "./text.ts";
import type { Answer, AnswerField, CareLevel, Claim, Medicine, ProfileUpdate, Source } from "./types.ts";
import { CARE_LEVELS } from "./vendor/redflags.js";

export const FIELD_ORDER: readonly AnswerField[] = [
  "care_level",
  "care_reason",
  "headline",
  "summary",
  "likely_causes",
  "try_tonight",
  "see_doctor_if",
  "emergency_if",
  "medicines",
  "questions_for_you",
  "unknowns",
  "questions_for_doctor",
  "profile_updates",
  "language",
];

export type CleanStats = { doseHits: number; droppedCitations: number; downgraded: number; softened: number };

export type CleanContext = {
  sources: Source[];
  floor: Floor;
  /** The language the reply should be in. */
  language: string;
  mode: "normal" | "crisis";
  drugNames: { asWritten: string; generic: string }[];
  drugSources: { asWritten: string; generic: string; id: string }[];
  /** A short reply to a message that raises nothing new (decided in chat.ts after the safety checks). */
  brief?: boolean;
  /** Everyday medicines that may be suggested, and the ones the person's profile rules out (otc.ts). */
  otc?: OtcOptions;
  /**
   * A reply that continues a problem already answered (DESIGN.md 7.6, "Follow-ups, like a doctor"). `newProblem`: the
   * message raises a topic the earlier messages didn't. `standing`: the highest care level already given, if known.
   */
  followUp?: { newProblem: boolean; standing: CareLevel | null };
  /**
   * What the person's profile already lists, when Nox may propose additions (accounts with "Use my profile in answers"
   * on). Absent: no proposals at all.
   */
  known?: { medicines: string[]; conditions: string[]; allergies: string[] } | null;
  /** Filled in as fields are cleaned. */
  state: { modelLevel: CareLevel | null };
  stats: CleanStats;
};

export function newCleanContext(input: Omit<CleanContext, "state" | "stats">): CleanContext {
  return { ...input, state: { modelLevel: null }, stats: { doseHits: 0, droppedCitations: 0, downgraded: 0, softened: 0 } };
}

// ---------------------------------------------------------------------------
// Text rules
// ---------------------------------------------------------------------------

const URL_LIKE = /(?:https?:\/\/|www\.)\S+/gi;

/** Plain text only: no markup, no web addresses, one line, clipped. */
export function plain(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return clip(
    value
      .replace(/<[^>]*>/g, " ")
      .replace(URL_LIKE, "")
      .replace(/[`*~>]+/g, "") // markdown marks; underscores stay, placeholders like [NAME_1] need them
      .replace(/^\s*(?:#+|[-•])\s+/, "")
      .replace(/\s+/g, " ")
      .replace(/\s+([,.;:!?])/g, "$1")
      .trim(),
    max,
  );
}

const CONDITIONS =
  "migraine|infection|flu|influenza|covid(?:-19)?|dengue|malaria|typhoid|pneumonia|appendicitis|meningitis|cancer|diabetes|hypertension|high blood pressure|asthma|uti|urinary tract infection|gastritis|ulcer|stroke|heart attack|anaemia|anemia|sinusitis|tonsillitis|bronchitis|food poisoning|gastroenteritis|depression|anxiety disorder|tumou?r|concussion|fracture|hernia|kidney stones?|gallstones?";
const DIAGNOSTIC = [
  new RegExp(`\\byou(?:'ve| have)?\\s+(?:definitely |certainly |clearly |probably |likely |most likely )?(?:have|has|got|are suffering from|are having|suffer from)\\s+(?:an? |the )?(?:${CONDITIONS})\\b`, "i"),
  /\b(?:this|it) is (?:definitely|certainly|clearly|surely)\b/i,
  /\byou (?:definitely|certainly) (?:have|need)\b/i,
  /\byou (?:are|were) diagnosed\b|\bmy diagnosis\b|\bi (?:can )?diagnose\b|\bthe diagnosis is\b/i,
];

export function isDiagnostic(text: string): boolean {
  return DIAGNOSTIC.some((pattern) => pattern.test(text));
}

/** Removes diagnostic sentences and sentences that state an amount of medicine from a paragraph. */
function safeText(text: string, stats: CleanStats): string {
  const kept = splitSentences(text).filter((sentence) => {
    if (isDiagnostic(sentence)) {
      stats.softened += 1;
      return false;
    }
    if (hasDose(sentence)) {
      stats.doseHits += 1;
      return false;
    }
    return true;
  });
  return kept.join(" ");
}

const stem = (word: string) => (word.length > 5 ? word.replace(/(?:ing|ed|es|s)$/, "") : word);
const stemmed = (text: string) => new Set(contentWords(text).filter((word) => word.length >= 4).map(stem));

/** Cheap check that a cited source really talks about what the claim says (English only). */
function supports(claim: string, ids: string[], sources: Source[]): boolean {
  const claimWords = stemmed(claim);
  if (claimWords.size === 0) return true;
  const passage = new Set<string>();
  for (const id of ids) {
    const source = sources.find((item) => item.id === id);
    if (source) for (const word of stemmed(`${source.title} ${source.passage}`)) passage.add(word);
  }
  let shared = 0;
  for (const word of claimWords) if (passage.has(word)) shared += 1;
  return shared >= (claimWords.size >= 9 ? 2 : 1);
}

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

const CLAIM_LIMITS: Partial<Record<AnswerField, { max: number; length: number }>> = {
  likely_causes: { max: 3, length: 240 },
  try_tonight: { max: 5, length: 240 },
  see_doctor_if: { max: 5, length: 240 },
  emergency_if: { max: 4, length: 240 },
};

function cleanIds(raw: unknown, ctx: CleanContext): string[] {
  const ids: string[] = [];
  for (const id of Array.isArray(raw) ? raw : []) {
    if (typeof id !== "string") continue;
    if (!ctx.sources.some((source) => source.id === id)) {
      ctx.stats.droppedCitations += 1;
      continue;
    }
    if (!ids.includes(id)) ids.push(id);
  }
  return ids.slice(0, 3);
}

// Rehydration salts are home care, not a medicine recommendation.
const SUPPORTIVE = new Set(["ors", "electral", "oral rehydration"]);

function cleanClaims(field: AnswerField, raw: unknown, ctx: CleanContext): Claim[] {
  const limit = CLAIM_LIMITS[field];
  if (!limit || !Array.isArray(raw)) return [];
  const mentioned = new Set(ctx.drugNames.flatMap((drug) => [drug.asWritten.toLowerCase(), drug.generic.toLowerCase()]));
  const out: Claim[] = [];
  for (const item of raw) {
    const text0 = typeof item === "string" ? item : item && typeof item === "object" ? (item as { text?: unknown }).text : "";
    let text = plain(text0, limit.length);
    if (!text) continue;
    let ids = typeof item === "object" && item ? cleanIds((item as { source_ids?: unknown }).source_ids, ctx) : [];

    if (field === "likely_causes" && isDiagnostic(text)) {
      ctx.stats.softened += 1;
      continue;
    }
    // Medicines belong in "medicines", where they are controlled. A home-care line that names one the
    // person did not mention (for example an antibiotic) is dropped.
    if ((field === "try_tonight" || field === "likely_causes") && findDrugMentions(text).some((name) => !mentioned.has(name) && !SUPPORTIVE.has(name))) {
      ctx.stats.softened += 1;
      continue;
    }
    if (hasDose(text)) {
      ctx.stats.doseHits += 1;
      text = DOSE_REPLACEMENT;
      ids = [];
    }
    if (ids.length && ctx.language === "en" && !supports(text, ids, ctx.sources)) {
      ctx.stats.downgraded += 1;
      ids = []; // shown as "general guidance"
    }
    if (!out.some((claim) => claim.text === text)) out.push({ text, source_ids: ids });
    if (out.length >= limit.max) break;
  }
  return out;
}

const PRESCRIPTION_NOTE: Record<string, string> = {
  en: "This is a prescription medicine. Do not start, stop or change it without asking the doctor who prescribed it, or a pharmacist.",
  hi: "यह डॉक्टर की पर्ची वाली दवा है। इसे शुरू करने, बंद करने या बदलने से पहले अपने डॉक्टर या फार्मासिस्ट से पूछें।",
};
const NO_LABEL_NOTE: Record<string, string> = {
  en: "I couldn't find an official label for this one, so this is general information only. Please ask a pharmacist.",
  hi: "मुझे इसका आधिकारिक लेबल नहीं मिला, इसलिए यह सिर्फ़ सामान्य जानकारी है। कृपया फार्मासिस्ट से पूछें।",
};
const RULED_OUT_NOTE: Record<string, (reason: string) => string> = {
  en: (reason) => `Because of ${reason}, ask a pharmacist or your doctor before taking this one.`,
  hi: (reason) => `${reason} की वजह से, इसे लेने से पहले फार्मासिस्ट या अपने डॉक्टर से पूछें।`,
};
const LABEL_NOTE: Record<string, string> = {
  en: "The label lists warnings and when to ask a doctor. See the source for details, and ask a pharmacist how much to take.",
  hi: "लेबल पर चेतावनियाँ और डॉक्टर से कब पूछना है, यह लिखा है। विवरण के लिए स्रोत देखें, और मात्रा फार्मासिस्ट से पूछें।",
};

/**
 * Medicines are limited to the ones the person named. The model's own wording is used only for
 * non-prescription medicines that have a retrieved label, and only if it states no amounts.
 */
function cleanMedicines(raw: unknown, ctx: CleanContext): Medicine[] {
  if (ctx.mode === "crisis") return [];
  // In an emergency the only advice is to get help. A medicine named earlier in the chat is not repeated.
  if (isEmergency(finalLevel(ctx.floor, ctx.state.modelLevel))) return [];
  const modelEntries = (Array.isArray(raw) ? raw : []).filter((item): item is Record<string, unknown> => !!item && typeof item === "object");
  const lang = ctx.language === "hi" ? "hi" : "en";
  const out: Medicine[] = [];
  for (const drug of ctx.drugNames) {
    const resolved = resolveDrug(drug.asWritten);
    const name = titleCase(plain(drug.asWritten, 60) || resolved.generic);
    if (!name) continue;
    if (resolved.prescription) {
      out.push({ name, note: PRESCRIPTION_NOTE[lang], source_ids: [] });
      continue;
    }
    // A medicine the person named that their profile rules out (an allergy, a condition, another medicine) gets a
    // plain warning instead of the label's text.
    const ruledOut = ctx.otc?.blocked.find((item) => nameMeans(drug.asWritten, item.names) || item.id === resolved.generic);
    if (ruledOut) {
      out.push({ name, note: RULED_OUT_NOTE[lang](ruledOut.reason), source_ids: [] });
      continue;
    }
    const label = ctx.drugSources.find((item) => item.asWritten === drug.asWritten);
    if (!label) {
      out.push({ name, note: NO_LABEL_NOTE[lang], source_ids: [] });
      continue;
    }
    const theirs = modelEntries.find((entry) => {
      const candidate = resolveDrug(String(entry.name ?? ""));
      return candidate.generic === resolved.generic || String(entry.name ?? "").toLowerCase() === drug.asWritten.toLowerCase();
    });
    let note = plain(theirs?.note, 220);
    if (!note || hasDoseOrSchedule(note) || isDiagnostic(note)) {
      if (note) ctx.stats.doseHits += hasDoseOrSchedule(note) ? 1 : 0;
      note = LABEL_NOTE[lang];
    } else if (ctx.language === "en" && !supports(note, [label.id], ctx.sources)) {
      ctx.stats.downgraded += 1;
      note = LABEL_NOTE[lang];
    }
    out.push({ name, note, source_ids: [label.id] });
    if (out.length >= 3) break;
  }

  // Everyday medicines Nox chose from the checked list. Our fixed wording only, and its label as the source when we
  // have one. Anything else the model wrote here is dropped.
  for (const entry of modelEntries) {
    if (out.length >= 3) break;
    const offered = matchOtc(String(entry.name ?? ""), ctx.otc?.offered ?? []);
    if (!offered) continue;
    if (out.some((item) => item.kind === "otc" && item.name === offered.name)) continue;
    if (ctx.drugNames.some((drug) => resolveDrug(drug.asWritten).generic === offered.id)) continue; // already above
    out.push({ name: offered.name, note: offered.note[lang], source_ids: offered.sourceId ? [offered.sourceId] : [], kind: "otc" });
  }
  return out;
}

const NO_SOURCES_NOTE: Record<string, string> = {
  en: "I couldn't find a trusted source for this, so this is general guidance only.",
  hi: "मुझे इसके लिए कोई भरोसेमंद स्रोत नहीं मिला, इसलिए यह सिर्फ़ सामान्य जानकारी है।",
};
const SAFE_SUMMARY: Record<string, string> = {
  en: "I can't examine you, so I can't say what is causing this. Here is general information and the signs to watch for.",
  hi: "मैं आपकी जाँच नहीं कर सकता, इसलिए कारण नहीं बता सकता। यहाँ सामान्य जानकारी और ध्यान रखने वाले संकेत हैं।",
};
const SAFE_HEADLINE: Record<string, string> = {
  en: "Here is what I can tell you, and when to get help.",
  hi: "यह है जो मैं बता सकता हूँ, और मदद कब लेनी है।",
};

const titleCase = (text: string) => text.replace(/(^|[\s-])([a-z])/g, (_, edge: string, letter: string) => edge + letter.toUpperCase());

const strings = (raw: unknown, max: number, length: number, stats: CleanStats): string[] => {
  const out: string[] = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    const text = safeText(plain(item, length), stats);
    if (text && !out.includes(text)) out.push(text);
    if (out.length >= max) break;
  }
  return out;
};

const RANK: Record<CareLevel, number> = { selfcare: 1, doctor: 2, doctor24: 3, emergency: 4, ambulance: 5 };

/**
 * A follow-up about the same problem doesn't repeat the warning signs or the questions for the doctor: they were given
 * with the first answer. They come back when the safety rules find something in this message, the message raises a
 * new problem, or the care level goes above what was already given (to "doctor24" or higher when that isn't known).
 */
function repeatsEarlierAdvice(ctx: CleanContext): boolean {
  const follow = ctx.followUp;
  if (!follow || ctx.mode !== "normal" || follow.newProblem || ctx.floor.level !== null) return false;
  const level = finalLevel(ctx.floor, ctx.state.modelLevel);
  const rose = follow.standing ? RANK[level] > RANK[follow.standing] : RANK[level] >= RANK.doctor24;
  return !rose;
}

/** True when the rules found an emergency but the model rated it lower (or not at all). */
function overruled(ctx: CleanContext): boolean {
  return ctx.mode === "normal" && isEmergency(ctx.floor.level) && wasRaised(ctx.floor, ctx.state.modelLevel);
}

// A short reply has no lists, but never while the level is an emergency: then it is a full answer again.
const SECTIONS = new Set<AnswerField>(["likely_causes", "try_tonight", "see_doctor_if", "emergency_if", "medicines", "questions_for_you", "questions_for_doctor"]);
const short = (ctx: CleanContext) => ctx.brief === true && ctx.mode === "normal" && !isEmergency(finalLevel(ctx.floor, ctx.state.modelLevel));

/** One or two sentences, plus any sentence that gives a helpline number. */
function twoSentences(text: string): string {
  return splitSentences(text)
    .filter((sentence, index) => index < 2 || /\b(?:112|14416)\b/.test(sentence))
    .join(" ");
}

/** Cleans one field. Returns undefined when the raw value is unusable (the field is then filled by default). */
export function cleanField(name: string, raw: unknown, ctx: CleanContext): Answer[AnswerField] | undefined {
  const lang = ctx.language === "hi" ? "hi" : "en";
  if (short(ctx) && SECTIONS.has(name as AnswerField)) return [];
  switch (name as AnswerField) {
    case "care_level": {
      const level = typeof raw === "string" && (CARE_LEVELS as readonly string[]).includes(raw) ? (raw as CareLevel) : null;
      ctx.state.modelLevel = level;
      return ctx.mode === "crisis" ? "ambulance" : finalLevel(ctx.floor, level);
    }
    case "care_reason": {
      const reason = safeText(plain(raw, 240), ctx.stats);
      if (ctx.mode === "normal" && wasRaised(ctx.floor, ctx.state.modelLevel)) return raisedNote(ctx.floor, lang);
      return reason || undefined;
    }
    case "headline": {
      // The model rated this below an emergency the rules found: its wording cannot be trusted.
      if (overruled(ctx)) return EMERGENCY[lang].headline;
      const text = safeText(plain(raw, 200), ctx.stats);
      return text ? clip(text, 140) : SAFE_HEADLINE[lang];
    }
    case "summary": {
      if (overruled(ctx)) return EMERGENCY[lang].summary;
      const text = safeText(plain(raw, 900), ctx.stats);
      return (short(ctx) ? twoSentences(text) : text) || SAFE_SUMMARY[lang];
    }
    case "likely_causes":
    case "emergency_if":
      return repeatsEarlierAdvice(ctx) ? [] : cleanClaims(name as AnswerField, raw, ctx);
    case "see_doctor_if":
      // "See a doctor if..." is confusing when the person should already be calling 112.
      return ctx.mode === "normal" && isEmergency(finalLevel(ctx.floor, ctx.state.modelLevel)) ? [] : cleanClaims("see_doctor_if", raw, ctx);
    case "try_tonight": {
      // No home remedies while someone should be getting emergency help.
      const level = finalLevel(ctx.floor, ctx.state.modelLevel);
      return ctx.mode === "normal" && isEmergency(level) ? [] : cleanClaims("try_tonight", raw, ctx);
    }
    case "medicines":
      return cleanMedicines(raw, ctx);
    case "questions_for_you":
      return strings(raw, 3, 160, ctx.stats);
    case "questions_for_doctor":
      return repeatsEarlierAdvice(ctx) ? [] : strings(raw, 4, 160, ctx.stats);
    case "unknowns": {
      if (short(ctx)) return "";
      const text = safeText(plain(raw, 300), ctx.stats);
      const missing = ctx.mode === "normal" && ctx.sources.length === 0;
      return missing ? `${text ? `${text} ` : ""}${NO_SOURCES_NOTE[lang]}`.trim() : text;
    }
    case "profile_updates":
      return cleanProfileUpdates(raw, ctx);
    case "language":
      return typeof raw === "string" && /^(en|hi)$/i.test(raw) ? raw.toLowerCase() : ctx.language;
    default:
      return undefined;
  }
}

const PROFILE_LISTS = new Set(["medicines", "conditions", "allergies"]);

/**
 * Proposed additions to the person's profile (DESIGN.md 8.6f): at most two, only to the three lists, short, never a
 * hidden detail (a placeholder such as [NAME_1] or [PHONE_1]), never what the profile already has, and none at all in a
 * crisis, a short reply, an emergency, or when proposals aren't allowed.
 */
function cleanProfileUpdates(raw: unknown, ctx: CleanContext): ProfileUpdate[] {
  if (!ctx.known || ctx.mode === "crisis" || short(ctx) || isEmergency(finalLevel(ctx.floor, ctx.state.modelLevel)) || !Array.isArray(raw)) return [];
  const out: ProfileUpdate[] = [];
  for (const entry of raw) {
    if (out.length >= 2 || !entry || typeof entry !== "object") continue;
    const { list, item } = entry as { list?: unknown; item?: unknown };
    if (typeof list !== "string" || !PROFILE_LISTS.has(list) || typeof item !== "string") continue;
    const text = item.replace(/\s+/g, " ").trim();
    if (text.length < 2 || text.length > 60 || /\[[A-Z]+_\d+\]/.test(text) || /https?:|www\./i.test(text)) continue;
    const key = text.toLowerCase();
    const have = ctx.known[list as ProfileUpdate["list"]].map((value) => value.toLowerCase());
    if (have.includes(key) || out.some((done) => done.list === list && done.item.toLowerCase() === key)) continue;
    out.push({ list: list as ProfileUpdate["list"], item: text.charAt(0).toUpperCase() + text.slice(1) });
  }
  return out;
}

/** Builds the full answer from the fields that arrived, filling every gap with a safe default. */
export function assemble(raw: Record<string, unknown>, ctx: CleanContext): { answer: Answer; missing: AnswerField[] } {
  ctx.state.modelLevel = null;
  const missing: AnswerField[] = [];
  const out: Partial<Record<AnswerField, Answer[AnswerField]>> = {};
  for (const field of FIELD_ORDER) {
    const value = field in raw ? cleanField(field, raw[field], ctx) : undefined;
    if (value === undefined) {
      missing.push(field);
      out[field] = defaultField(field, ctx);
    } else {
      out[field] = value;
    }
  }
  return { answer: out as Answer, missing };
}

function defaultField(field: AnswerField, ctx: CleanContext): Answer[AnswerField] {
  const lang = ctx.language === "hi" ? "hi" : "en";
  switch (field) {
    case "care_level":
      return ctx.mode === "crisis" ? "ambulance" : finalLevel(ctx.floor, ctx.state.modelLevel);
    case "care_reason":
      return ctx.floor.level && ctx.mode === "normal" ? raisedNote(ctx.floor, lang) : "";
    case "headline":
      return overruled(ctx) ? EMERGENCY[lang].headline : SAFE_HEADLINE[lang];
    case "summary":
      return overruled(ctx) ? EMERGENCY[lang].summary : SAFE_SUMMARY[lang];
    case "medicines":
      return short(ctx) ? [] : cleanMedicines([], ctx);
    case "unknowns":
      return ctx.mode === "normal" && ctx.sources.length === 0 && !short(ctx) ? NO_SOURCES_NOTE[lang] : "";
    case "language":
      return ctx.language;
    case "questions_for_you":
    case "questions_for_doctor":
    case "profile_updates":
      return [];
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Fixed answers: used when the AI is unavailable, switched off, or out of quota. No model involved.
// DRAFT wording: needs clinician review, and the Hindi needs a native speaker (PLAN.md 6.12).
// ---------------------------------------------------------------------------

export const HELPLINES = { emergency: "112", telemanas: "14416" };

const CRISIS: Record<string, Pick<Answer, "care_reason" | "headline" | "summary" | "try_tonight" | "emergency_if" | "questions_for_you">> = {
  en: {
    care_reason: "You said you are having thoughts of hurting yourself. You matter, and help is available right now.",
    headline: "I'm really glad you told me. You don't have to go through this alone.",
    summary:
      "I'm an AI and I can't watch over you, but I'm here to listen. If you can, please talk to someone now. Tele-MANAS is free, open all day and night, and you can call 14416. If you are in danger right now, call 112.",
    try_tonight: [
      { text: "Call Tele-MANAS on 14416 (free, any time) and tell them how you feel.", source_ids: [] },
      { text: "Tell someone you trust how you feel right now, and ask them to stay with you.", source_ids: [] },
      { text: "Move away from anything you could use to hurt yourself.", source_ids: [] },
    ],
    emergency_if: [{ text: "If you feel you may act on these thoughts, call 112 or go to the nearest hospital now.", source_ids: [] }],
    questions_for_you: ["Are you safe right now?"],
  },
  hi: {
    care_reason: "आपने बताया कि आप खुद को नुकसान पहुँचाने के बारे में सोच रहे हैं। आप ज़रूरी हैं, और मदद अभी उपलब्ध है।",
    headline: "आपने बताया, मुझे अच्छा लगा। आपको यह अकेले नहीं सहना है।",
    summary:
      "मैं एक AI हूँ और आपका ध्यान नहीं रख सकता, लेकिन मैं सुनने के लिए यहाँ हूँ। हो सके तो अभी किसी से बात करें। Tele-MANAS मुफ़्त है, दिन-रात खुला है, और आप 14416 पर कॉल कर सकते हैं। अगर आप अभी ख़तरे में हैं, तो 112 पर कॉल करें।",
    try_tonight: [
      { text: "Tele-MANAS को 14416 पर कॉल करें (मुफ़्त, कभी भी) और बताएँ कि आप कैसा महसूस कर रहे हैं।", source_ids: [] },
      { text: "किसी भरोसेमंद व्यक्ति को अभी बताएँ, और उनसे अपने साथ रहने को कहें।", source_ids: [] },
      { text: "ऐसी किसी भी चीज़ से दूर हो जाएँ जिससे आप खुद को नुकसान पहुँचा सकते हैं।", source_ids: [] },
    ],
    emergency_if: [{ text: "अगर आपको लगे कि आप ये विचार अमल में ला सकते हैं, तो अभी 112 पर कॉल करें या नज़दीकी अस्पताल जाएँ।", source_ids: [] }],
    questions_for_you: ["क्या आप अभी सुरक्षित हैं?"],
  },
};

export function crisisAnswer(language: string): Answer {
  const lang = language === "hi" ? "hi" : "en";
  return {
    care_level: "ambulance",
    ...CRISIS[lang],
    likely_causes: [],
    see_doctor_if: [],
    medicines: [],
    unknowns: "",
    questions_for_doctor: [],
    profile_updates: [],
    language: lang,
  };
}

const EMERGENCY: Record<string, { headline: string; summary: string; none: string }> = {
  en: {
    headline: "This may be an emergency. Call 112 now.",
    summary:
      "The signs you described can be serious, and I can't judge them from a message. Please call 112 or go to the nearest emergency department now. Don't wait to see if it passes, and don't drive yourself.",
    none: "Call 112 if the person gets worse or you are unsure.",
  },
  hi: {
    headline: "यह आपातकाल हो सकता है। अभी 112 पर कॉल करें।",
    summary:
      "आपने जो संकेत बताए वे गंभीर हो सकते हैं, और मैं मैसेज से इन्हें नहीं परख सकता। कृपया अभी 112 पर कॉल करें या नज़दीकी इमरजेंसी में जाएँ। इंतज़ार न करें कि यह अपने आप ठीक हो जाए, और खुद गाड़ी न चलाएँ।",
    none: "अगर हालत बिगड़े या आप सुनिश्चित न हों तो 112 पर कॉल करें।",
  },
};

/** The answer when someone has emergency signs but the AI cannot be used (off, down, or over quota). */
export function emergencyAnswer(floor: Floor, language: string): Answer {
  const lang = language === "hi" ? "hi" : "en";
  const level: CareLevel = floor.level ?? "emergency";
  return {
    care_level: level,
    care_reason: raisedNote(floor, lang),
    headline: EMERGENCY[lang].headline,
    summary: EMERGENCY[lang].summary,
    likely_causes: [],
    try_tonight: [],
    see_doctor_if: [],
    emergency_if: floor.signs.slice(0, 4).map((sign) => ({ text: sign, source_ids: [] })),
    medicines: [],
    questions_for_you: [],
    unknowns: "",
    questions_for_doctor: [],
    profile_updates: [],
    language: lang,
  };
}

const WARNING = /\b(?:get medical help|medical help right away|call (?:your|a|911|112)|emergency|seek|right away|immediately|let your (?:health care )?provider know|see (?:a|your) (?:doctor|health))\b/i;
const OFFLINE: Record<string, { reason: string; headline: string; summary: string; unknowns: string; general: string; emergency: string }> = {
  en: {
    reason: "Our AI helper is offline, so I can't judge how urgent this is. If you are unsure, it is safest to talk to a doctor.",
    headline: "Our AI helper is offline right now. Here is what trusted sources say.",
    summary: "I couldn't write an answer for you this time, so these are short passages from trusted public sources. Please try again in a few minutes.",
    unknowns: "I could not look at your situation, so none of this is personal advice.",
    general: "If it gets worse, lasts longer than you expected, or you are worried, see a doctor.",
    emergency: "Trouble breathing, chest pain, confusion, fainting, or heavy bleeding: call 112 now.",
  },
  hi: {
    reason: "हमारा AI सहायक अभी बंद है, इसलिए मैं नहीं बता सकता कि यह कितना ज़रूरी है। अगर आप सुनिश्चित नहीं हैं, तो डॉक्टर से बात करना सबसे सुरक्षित है।",
    headline: "हमारा AI सहायक अभी बंद है। भरोसेमंद स्रोत यह कहते हैं।",
    summary: "इस बार मैं आपके लिए जवाब नहीं लिख सका, इसलिए ये भरोसेमंद सार्वजनिक स्रोतों के छोटे अंश हैं। कृपया कुछ मिनट बाद फिर कोशिश करें।",
    unknowns: "मैं आपकी स्थिति नहीं देख सका, इसलिए इनमें से कुछ भी व्यक्तिगत सलाह नहीं है।",
    general: "अगर हालत बिगड़े, उम्मीद से ज़्यादा समय तक रहे, या आप चिंतित हों, तो डॉक्टर को दिखाएँ।",
    emergency: "साँस लेने में तकलीफ़, सीने में दर्द, भ्रम, बेहोशी, या ज़्यादा खून बहना: अभी 112 पर कॉल करें।",
  },
};

/** The answer when the AI cannot be used but a normal question was asked: quote the sources, add the basics. */
export function sourcesOnlyAnswer(floor: Floor, sources: Source[], language: string): Answer {
  if (isEmergency(floor.level)) return emergencyAnswer(floor, language);
  const lang = language === "hi" ? "hi" : "en";
  const text = OFFLINE[lang];
  const warnings: Claim[] = [];
  for (const source of sources.filter((item) => item.kind === "condition")) {
    for (const sentence of splitSentences(source.passage)) {
      if (WARNING.test(sentence) && !hasDoseOrSchedule(sentence) && warnings.length < 3) {
        warnings.push({ text: clip(sentence, 240), source_ids: [source.id] });
      }
    }
  }
  return {
    care_level: floor.level ?? "doctor",
    care_reason: text.reason,
    headline: text.headline,
    summary: text.summary,
    likely_causes: [],
    try_tonight: [],
    see_doctor_if: [...warnings, { text: text.general, source_ids: [] }].slice(0, 5),
    emergency_if: [{ text: text.emergency, source_ids: [] }],
    medicines: [],
    questions_for_you: [],
    unknowns: text.unknowns,
    questions_for_doctor: [],
    profile_updates: [],
    language: lang,
  };
}

// ---------------------------------------------------------------------------
// Measurements and small helpers
// ---------------------------------------------------------------------------

function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  const groups = w.replace(/e$/, "").match(/[aeiouy]+/g);
  return Math.max(1, groups ? groups.length : 1);
}

/** Flesch-Kincaid grade level of English text. For monitoring only, never shown. */
export function readingGrade(text: string): number | null {
  const sentences = splitSentences(text).length;
  const words = text.match(/[A-Za-z']+/g) ?? [];
  if (!sentences || words.length < 5) return null;
  const grade = 0.39 * (words.length / sentences) + 11.8 * (words.reduce((sum, word) => sum + syllables(word), 0) / words.length) - 15.59;
  return Math.round(Math.min(Math.max(grade, 0), 20) * 10) / 10;
}

/** The short text stored as the assistant's message, used as history for the next turn. */
/**
 * What an answer leaves in the chat's history for the next turn: the headline, the summary, and the questions Nox asked,
 * so a short reply ("Paracetamol", "Since Monday") is understood as the answer to them.
 */
export function digest(answer: Answer): string {
  const asked = (answer.questions_for_you ?? []).filter(Boolean);
  return `${answer.headline} ${answer.summary}${asked.length ? ` I asked: ${asked.join(" ")}` : ""}`.trim().slice(0, 800);
}

/** A short chat title from the first message, using a topic name when one is known. */
export function chatTitle(message: string, topics: string[]): string {
  if (topics.length) {
    const topic = topics[0];
    return topic.charAt(0).toUpperCase() + topic.slice(1);
  }
  return clip(message.replace(/\[[A-Z]+_\d+\]/g, "").replace(/\s+/g, " ").trim(), 60) || "New chat";
}
