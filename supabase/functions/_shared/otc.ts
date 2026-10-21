// Everyday medicines that need no prescription (DESIGN.md 8.6b). Nox may suggest ONLY these, and only after the
// person's profile has been checked. The wording is ours and fixed: no amounts, ever (the dose check still runs).
// DRAFT: the list, the rules and the wording must be reviewed by a pharmacist before launch (PLAN.md §12).
// Erasable TypeScript only.
import type { HealthProfile } from "./types.ts";
import type { WhoFor } from "./terms.ts";

export type OtcMedicine = {
  id: string;
  /** The name shown in the answer. */
  name: string;
  /** What it is for, told to the model. */
  forWhat: string;
  /** The US generic name to fetch its FDA label, or null when no US over-the-counter label fits. */
  lookup: string | null;
  /** Names that mean this medicine when the model writes them (lower case, whole words). */
  names: string[];
  /** Symptoms it can help with, matched against the topics and the message. */
  helps: RegExp;
  avoid: {
    allergy: RegExp;
    condition?: RegExp;
    medicine?: RegExp;
    /** Not from 65. */
    olderAdults?: boolean;
    /** Not for someone who drinks alcohol regularly. */
    regularAlcohol?: boolean;
  };
  note: { en: string; hi: string };
};

const ON_THE_PACK = {
  en: "Use the dose on the pack for your age, and never more than the pack allows in a day.",
  hi: "पैक पर लिखी अपनी उम्र की खुराक लें, और दिन में पैक पर लिखी सीमा से ज़्यादा कभी न लें।",
};

export const OTC_MEDICINES: OtcMedicine[] = [
  {
    id: "paracetamol",
    name: "Paracetamol",
    forWhat: "fever and mild to moderate pain",
    lookup: "acetaminophen",
    names: ["paracetamol", "acetaminophen", "crocin", "dolo", "calpol", "tylenol"],
    helps: /(?<!hay )fever|temperature|headache|migraine|pain|ache|sore throat|cold|flu|toothache|period|cramp|sprain/i,
    avoid: { allergy: /paracetamol|acetaminophen|crocin|dolo/i, condition: /liver|hepat|cirrhosis|alcohol/i, regularAlcohol: true },
    note: {
      en: `Can ease fever and pain. Sold as Crocin or Dolo, among others. ${ON_THE_PACK.en} Don't take it with other medicines that also contain paracetamol.`,
      hi: `बुखार और दर्द में आराम दे सकती है। क्रोसिन या डोलो जैसे नामों से मिलती है। ${ON_THE_PACK.hi} पैरासिटामोल वाली दूसरी दवा के साथ न लें।`,
    },
  },
  {
    id: "ibuprofen",
    name: "Ibuprofen",
    forWhat: "pain, period cramps, sprains and fever",
    lookup: "ibuprofen",
    names: ["ibuprofen", "brufen", "ibugesic", "advil", "motrin"],
    helps: /headache|migraine|pain|ache|toothache|period|cramp|sprain|strain|back|muscle|joint|(?<!hay )fever/i,
    avoid: {
      allergy: /ibuprofen|brufen|nsaid|anti-?inflammator|aspirin|disprin|ecosprin/i,
      condition: /kidney|renal|ulcer|stomach bleed|gastric bleed|bleeding|heart|cardiac|asthma|high blood pressure|hypertension|stroke|liver/i,
      medicine: /warfarin|acitrom|apixaban|rivaroxaban|dabigatran|clopidogrel|aspirin|ecosprin|heparin|lithium|methotrexate|prednisolone|steroid|furosemide|diuretic/i,
      olderAdults: true,
    },
    note: {
      en: `Can ease pain, period cramps and swelling. Sold as Brufen, among others. Take it with food. ${ON_THE_PACK.en}`,
      hi: `दर्द, पीरियड के ऐंठन और सूजन में आराम दे सकती है। ब्रुफ़ेन जैसे नामों से मिलती है। खाने के साथ लें। ${ON_THE_PACK.hi}`,
    },
  },
  {
    id: "cetirizine",
    name: "Cetirizine",
    forWhat: "allergy symptoms: sneezing, runny nose, itchy eyes, hives",
    lookup: "cetirizine hydrochloride",
    names: ["cetirizine", "cetzine", "okacet", "alerid", "zyrtec"],
    helps: /allerg|hay fever|sneez|runny nose|itch|hives|urticaria/i,
    avoid: { allergy: /cetirizine|antihistamine/i, condition: /kidney|renal/i },
    note: {
      en: `An antihistamine for sneezing, a runny nose and itching. It can make some people sleepy: don't drive until you know how it affects you. ${ON_THE_PACK.en}`,
      hi: `छींक, बहती नाक और खुजली के लिए एक एंटीहिस्टामिन। कुछ लोगों को नींद आ सकती है: असर समझने तक गाड़ी न चलाएँ। ${ON_THE_PACK.hi}`,
    },
  },
  {
    id: "loratadine",
    name: "Loratadine",
    forWhat: "allergy symptoms, if cetirizine doesn't suit",
    lookup: "loratadine",
    names: ["loratadine", "lorfast", "claritin"],
    helps: /allerg|hay fever|sneez|runny nose|itch|hives|urticaria/i,
    avoid: { allergy: /loratadine|antihistamine/i, condition: /liver|hepat/i },
    note: {
      en: `An antihistamine that makes most people less sleepy. ${ON_THE_PACK.en}`,
      hi: `एक एंटीहिस्टामिन जिससे ज़्यादातर लोगों को कम नींद आती है। ${ON_THE_PACK.hi}`,
    },
  },
  {
    id: "antacid",
    name: "An antacid",
    forWhat: "acidity, heartburn and indigestion",
    lookup: "calcium carbonate",
    names: ["antacid", "digene", "gelusil", "mucaine", "calcium carbonate", "tums"],
    helps: /acidity|heartburn|indigestion|reflux|gastritis|dyspepsia|gas\b|burning in (the )?(chest|stomach)/i,
    avoid: { allergy: /antacid/i, condition: /kidney|renal/i },
    note: {
      en: `Eases acidity and heartburn for a short time. Sold as Digene or Gelusil, among others. ${ON_THE_PACK.en} Keep it two hours apart from other medicines.`,
      hi: `कुछ समय के लिए एसिडिटी और सीने की जलन में आराम देता है। डाइजीन या जेलुसिल जैसे नामों से मिलता है। ${ON_THE_PACK.hi} दूसरी दवाओं से दो घंटे का अंतर रखें।`,
    },
  },
  {
    id: "saline_nasal",
    name: "Saline nasal spray or drops",
    forWhat: "a blocked or stuffy nose",
    lookup: null,
    names: ["saline", "nasal saline", "salt water nasal"],
    helps: /blocked nose|stuffy|congest|cold|sinus|runny nose/i,
    avoid: { allergy: /saline/i },
    note: {
      en: "Salt water for the nose: it loosens a blocked nose and is safe to use often. Follow the pack.",
      hi: "नाक के लिए नमक का पानी: बंद नाक खोलता है और बार-बार इस्तेमाल करना सुरक्षित है। पैक पर लिखे अनुसार लें।",
    },
  },
  {
    id: "calamine",
    name: "Calamine lotion",
    forWhat: "itchy skin, insect bites, prickly heat",
    lookup: "calamine",
    names: ["calamine", "lacto calamine"],
    helps: /itch|insect bite|bite|sting|prickly heat|sunburn|chickenpox/i,
    avoid: { allergy: /calamine|zinc/i },
    note: {
      en: "Soothes itchy skin and bites. For the skin only: keep it away from the eyes. Follow the pack.",
      hi: "खुजली वाली त्वचा और कीड़े के काटने में आराम देता है। सिर्फ़ त्वचा पर लगाएँ, आँखों से दूर रखें। पैक पर लिखे अनुसार लें।",
    },
  },
  {
    id: "clotrimazole",
    name: "Clotrimazole cream",
    forWhat: "athlete's foot, ringworm and other fungal skin rashes",
    lookup: "clotrimazole",
    names: ["clotrimazole", "candid", "canesten"],
    helps: /athlete|ringworm|fungal|jock itch|tinea/i,
    avoid: { allergy: /clotrimazole|antifungal|azole/i },
    note: {
      en: "An antifungal cream for the skin. Keep using it for as long as the pack says, even after the rash fades. Follow the pack.",
      hi: "त्वचा के फंगल संक्रमण के लिए एक क्रीम। दाने ठीक लगने के बाद भी पैक पर लिखे समय तक लगाते रहें।",
    },
  },
];

export type OtcOffer = OtcMedicine & { sourceId?: string };
export type OtcBlocked = { id: string; name: string; names: string[]; reason: string };
export type OtcOptions = {
  offered: OtcOffer[];
  blocked: OtcBlocked[];
  /** When no medicine may be suggested at all, the reason the model must give instead. */
  none: string | null;
};

const EMPTY: OtcOptions = { offered: [], blocked: [], none: null };

const matches = (pattern: RegExp | undefined, items: string[]) => (pattern ? items.find((item) => pattern.test(item)) : undefined);

/**
 * The over-the-counter medicines Nox may suggest for this message, after the profile checks. Only for the person
 * themself (we can't check anyone else's allergies or medicines), never for a baby, a child or in pregnancy.
 */
export function otcOptions(input: { text: string; whoFor: WhoFor; profile: HealthProfile | null; max?: number }): OtcOptions {
  const helpful = OTC_MEDICINES.filter((medicine) => medicine.helps.test(input.text));
  if (!helpful.length) return EMPTY;

  const profile = input.profile;
  if (input.whoFor === "baby" || input.whoFor === "child") return { ...EMPTY, none: "it is for a child: the right medicine and dose depend on age and weight, so ask a pharmacist or doctor" };
  if (input.whoFor === "pregnant" || profile?.pregnancy === "yes" || profile?.pregnancy === "not_sure") return { ...EMPTY, none: "pregnancy: ask a doctor or pharmacist before taking any medicine" };
  if (input.whoFor === "someone_else") return { ...EMPTY, none: "it is for someone else: we can't check their allergies and medicines, so ask a pharmacist" };

  const older = input.whoFor === "older_adult" || profile?.age_range === "65-74" || profile?.age_range === "75+";
  const offered: OtcOffer[] = [];
  const blocked: OtcBlocked[] = [];
  for (const medicine of helpful) {
    const allergy = matches(medicine.avoid.allergy, profile?.allergies ?? []);
    const condition = matches(medicine.avoid.condition, profile?.conditions ?? []);
    const regular = matches(medicine.avoid.medicine, profile?.medicines ?? []);
    const reason = allergy
      ? `allergy to ${allergy}`
      : condition
        ? `${condition} in their profile`
        : regular
          ? `they take ${regular}`
          : medicine.avoid.olderAdults && older
            ? "aged 65 or over"
            : medicine.avoid.regularAlcohol && profile?.alcohol === "regular"
              ? "regular alcohol"
              : null;
    if (reason) blocked.push({ id: medicine.id, name: medicine.name, names: medicine.names, reason });
    // One antihistamine is enough: loratadine is only the fallback when cetirizine doesn't suit.
    else if (medicine.id === "loratadine" && offered.some((item) => item.id === "cetirizine")) continue;
    else offered.push({ ...medicine }); // a copy: chat.ts adds this request's label id to it
  }
  return { offered: offered.slice(0, input.max ?? 3), blocked, none: null };
}

const normalize = (text: string) => text.toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();

/** Whether a written name means one of these names. Whole words only ("candid" is not "candidate"). */
export function nameMeans(name: string, names: string[]): boolean {
  const words = ` ${normalize(name)} `;
  return names.some((alias) => words.includes(` ${alias} `));
}

/** The offered medicine a name written by the model means, or undefined. */
export function matchOtc(name: string, offered: OtcOffer[]): OtcOffer | undefined {
  return offered.find((medicine) => nameMeans(name, medicine.names));
}

/** The offered or blocked entry a medicine the person named matches, by its plain generic name. */
export function otcById(id: string): OtcMedicine | undefined {
  return OTC_MEDICINES.find((medicine) => medicine.id === id);
}
