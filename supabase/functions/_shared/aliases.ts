// Medicine names people in India use, mapped to the US generic names that openFDA knows.
// openFDA only knows US names ("paracetamol" finds nothing, "acetaminophen" does), and RxNorm maps
// Indian brands wrongly (PLAN.md 3.5), so this table comes first.
//
// NOT YET REVIEWED BY A PHARMACIST (PLAN.md 6.7, 6.12). Brand compositions vary by product and
// year. `lookup` is empty when there is no matching US over-the-counter label: the answer then
// treats it as general information and sends questions to a pharmacist. `prescription` marks
// medicines the answer must never suggest starting, stopping or changing.

export type DrugInfo = {
  /** Plain name shown to the model, e.g. "paracetamol". */
  generic: string;
  /** US generic names to look up in openFDA, in order. */
  lookup: string[];
  prescription: boolean;
};

const TABLE: { names: string[]; info: DrugInfo }[] = [
  { names: ["paracetamol", "acetaminophen", "crocin", "dolo", "dolo 650", "calpol", "pcm", "tylenol", "paracip", "pacimol"], info: { generic: "paracetamol", lookup: ["acetaminophen"], prescription: false } },
  { names: ["combiflam"], info: { generic: "ibuprofen and paracetamol", lookup: ["ibuprofen", "acetaminophen"], prescription: false } },
  { names: ["ibuprofen", "brufen", "ibugesic", "advil", "motrin"], info: { generic: "ibuprofen", lookup: ["ibuprofen"], prescription: false } },
  { names: ["aspirin", "disprin", "ecosprin"], info: { generic: "aspirin", lookup: ["aspirin"], prescription: false } },
  { names: ["naproxen", "naprosyn", "aleve"], info: { generic: "naproxen", lookup: ["naproxen sodium"], prescription: false } },
  { names: ["cetirizine", "cetzine", "okacet", "alerid", "zyrtec"], info: { generic: "cetirizine", lookup: ["cetirizine hydrochloride"], prescription: false } },
  { names: ["levocetirizine", "levocet", "xyzal"], info: { generic: "levocetirizine", lookup: ["levocetirizine dihydrochloride"], prescription: false } },
  { names: ["fexofenadine", "allegra"], info: { generic: "fexofenadine", lookup: ["fexofenadine hydrochloride"], prescription: false } },
  { names: ["loratadine", "lorfast", "claritin"], info: { generic: "loratadine", lookup: ["loratadine"], prescription: false } },
  { names: ["diphenhydramine", "benadryl"], info: { generic: "diphenhydramine", lookup: ["diphenhydramine hydrochloride"], prescription: false } },
  { names: ["famotidine", "famocid", "pepcid"], info: { generic: "famotidine", lookup: ["famotidine"], prescription: false } },
  { names: ["omeprazole", "omez", "prilosec"], info: { generic: "omeprazole", lookup: ["omeprazole magnesium", "omeprazole"], prescription: false } },
  { names: ["loperamide", "imodium", "eldoper", "lopamide"], info: { generic: "loperamide", lookup: ["loperamide hydrochloride"], prescription: false } },
  { names: ["eno"], info: { generic: "sodium bicarbonate and citric acid (antacid)", lookup: ["sodium bicarbonate"], prescription: false } },
  { names: ["digene", "gelusil", "mucaine"], info: { generic: "antacid (aluminium and magnesium hydroxide)", lookup: [], prescription: false } },
  { names: ["betadine", "povidone iodine", "povidone-iodine"], info: { generic: "povidone-iodine", lookup: ["povidone-iodine"], prescription: false } },
  { names: ["volini", "moov", "diclofenac", "voveran", "voltaren"], info: { generic: "diclofenac or similar pain-relief gel", lookup: ["diclofenac sodium"], prescription: false } },
  { names: ["vicks", "vaporub", "vicks vaporub"], info: { generic: "camphor, menthol and eucalyptus rub", lookup: [], prescription: false } },
  { names: ["ors", "electral", "oral rehydration"], info: { generic: "oral rehydration salts", lookup: [], prescription: false } },
  { names: ["saridon"], info: { generic: "a combination pain reliever (not sold in the US)", lookup: [], prescription: false } },
  { names: ["pantoprazole", "pan 40", "pan-d", "pantocid"], info: { generic: "pantoprazole", lookup: [], prescription: true } },
  { names: ["ranitidine", "rantac", "zinetac"], info: { generic: "ranitidine", lookup: [], prescription: false } },
  { names: ["azithromycin", "azee", "azithral"], info: { generic: "azithromycin (an antibiotic)", lookup: [], prescription: true } },
  { names: ["amoxicillin", "mox", "augmentin", "amoxyclav"], info: { generic: "amoxicillin (an antibiotic)", lookup: [], prescription: true } },
  { names: ["ciprofloxacin", "ciplox", "cifran"], info: { generic: "ciprofloxacin (an antibiotic)", lookup: [], prescription: true } },
  { names: ["metronidazole", "flagyl", "metrogyl"], info: { generic: "metronidazole (an antibiotic)", lookup: [], prescription: true } },
  { names: ["prednisolone", "wysolone", "dexamethasone", "dexona"], info: { generic: "a steroid medicine", lookup: [], prescription: true } },
  { names: ["metformin", "glycomet"], info: { generic: "metformin (a diabetes medicine)", lookup: [], prescription: true } },
  { names: ["amlodipine", "amlong", "telmisartan", "telma"], info: { generic: "a blood pressure medicine", lookup: [], prescription: true } },
];

const BY_NAME = new Map<string, DrugInfo>();
for (const row of TABLE) for (const name of row.names) BY_NAME.set(name, row.info);

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const MENTION = new RegExp(
  `(?<![a-z0-9])(${[...BY_NAME.keys()].sort((a, b) => b.length - a.length).map(escape).join("|")})(?![a-z0-9])`,
  "g",
);

const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();

/** Looks a name up. Unknown names are passed through as-is for a direct openFDA search. */
export function resolveDrug(name: string): DrugInfo & { asWritten: string; known: boolean } {
  const full = normalize(name);
  const withoutStrength = full.replace(/\s*\d+(?:\.\d+)?\s*(?:mg|mcg|ml|g)?$/, "").trim(); // "crocin 500" → "crocin"
  const info = BY_NAME.get(full) ?? BY_NAME.get(withoutStrength);
  if (info) return { ...info, asWritten: name, known: true };
  // Unknown: look it up as written, but only if it looks like a medicine name (letters, 4+).
  const clean = withoutStrength.replace(/[^a-z\s-]/g, "").replace(/\s+/g, " ").trim();
  const usable = clean.length >= 4 && clean.length <= 40 && !/\[|\]/.test(name);
  return { generic: clean, lookup: usable ? [clean] : [], prescription: false, asWritten: name, known: false };
}

/** Medicine names from the table found in a message, as written there. */
export function findDrugMentions(text: string): string[] {
  const found = new Set<string>();
  for (const match of normalize(text).matchAll(MENTION)) found.add(match[1]);
  return [...found];
}
