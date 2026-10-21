// Keyword fallback for understanding a message when the fast model is slow or down, so the
// lookups still work. Each topic is a MedlinePlus health-topic title; the phrases cover English,
// common Hinglish spellings and Hindi. Also used to add topics the model missed.

const TOPICS: [title: string, phrases: string[]][] = [
  ["Headache", ["headache", "head ache", "head pain", "head is paining", "sar dard", "sir dard", "sar me dard", "sar mein dard", "sir mein dard", "sir me dard", "सिरदर्द", "सिर दर्द", "सिर में दर्द"]],
  ["Migraine", ["migraine", "माइग्रेन"]],
  ["Fever", ["fever", "temperature", "bukhar", "bukhaar", "बुखार"]],
  ["Common Cold", ["common cold", "a cold", "cold and cough", "runny nose", "blocked nose", "stuffy nose", "jukam", "zukam", "jukaam", "zukaam", "nazla", "जुकाम", "सर्दी"]],
  ["Cough", ["cough", "khansi", "khaansi", "खांसी", "खाँसी"]],
  ["Sore Throat", ["sore throat", "throat pain", "throat hurts", "throat is sore", "gala kharab", "gale me dard", "gale mein dard", "गले में दर्द", "गला खराब"]],
  ["Abdominal Pain", ["stomach pain", "stomach ache", "stomachache", "tummy ache", "tummy pain", "belly pain", "abdominal pain", "pet dard", "pet me dard", "pet mein dard", "पेट दर्द", "पेट में दर्द"]],
  ["Diarrhea", ["diarrhea", "diarrhoea", "loose motion", "loose motions", "loose stool", "loose stools", "dast", "दस्त"]],
  ["Nausea and Vomiting", ["vomiting", "vomit", "throwing up", "nausea", "nauseous", "ulti", "ultee", "उल्टी", "जी मिचला"]],
  ["Heartburn", ["acidity", "heartburn", "acid reflux", "khatte dakar", "एसिडिटी"]],
  ["Constipation", ["constipation", "constipated", "kabz", "kabj", "कब्ज"]],
  ["Dizziness and Vertigo", ["dizzy", "dizziness", "vertigo", "chakkar", "चक्कर"]],
  ["Back Pain", ["back pain", "backache", "lower back", "kamar dard", "कमर दर्द"]],
  ["Rashes", ["rash", "rashes", "skin allergy", "hives", "dane", "दाने"]],
  ["Itching", ["itching", "itchy", "khujli", "खुजली"]],
  ["Allergy", ["allergy", "allergic", "sneezing", "chheenk", "छींक"]],
  ["Insomnia", ["insomnia", "can't sleep", "cannot sleep", "unable to sleep", "trouble sleeping", "not sleeping", "waking up at night", "wake up at night", "waking up in the night", "sleepless", "neend nahi", "नींद नहीं"]],
  ["Anxiety", ["anxiety", "anxious", "panic attack", "ghabrahat", "घबराहट"]],
  ["Depression", ["depression", "depressed"]],
  ["Toothache", ["toothache", "tooth pain", "tooth ache", "daant dard", "दांत दर्द", "दाँत दर्द"]],
  ["Ear Infections", ["ear pain", "earache", "ear ache", "kaan dard", "कान दर्द", "कान में दर्द"]],
  ["Period Pain", ["period pain", "period cramps", "menstrual cramps", "menstrual pain", "periods pain"]],
  ["Urinary Tract Infections", ["uti", "urine infection", "burning urine", "burning while peeing", "pain while urinating", "burning when i pee", "peshab me jalan", "पेशाब में जलन"]],
  ["Dengue", ["dengue", "डेंगू"]],
  ["Malaria", ["malaria", "मलेरिया"]],
  ["Typhoid Fever", ["typhoid", "टाइफाइड"]],
  ["COVID-19", ["covid", "coronavirus", "corona"]],
  ["Flu", ["flu", "influenza"]],
  ["Joint Disorders", ["joint pain", "knee pain", "jodo me dard", "जोड़ों में दर्द"]],
  ["Sunburn", ["sunburn", "sun burn"]],
  ["Burns", ["burn", "burned", "burnt", "jal gaya", "जल गया"]],
  ["Cuts and Wounds", ["cut myself", "a cut", "wound", "chot", "चोट"]],
  ["Dehydration", ["dehydration", "dehydrated"]],
  ["Fatigue", ["tired", "tiredness", "fatigue", "exhausted", "kamzori", "कमजोरी"]],
  ["Eye Infections", ["red eye", "pink eye", "conjunctivitis", "eye infection", "aankh lal", "आंख लाल"]],
  ["Pregnancy", ["pregnant", "pregnancy", "गर्भवती"]],
  ["High Blood Pressure", ["high bp", "blood pressure", "hypertension"]],
  ["Diabetes", ["diabetes", "diabetic", "sugar level", "blood sugar", "शुगर"]],
  ["Asthma", ["asthma", "dama", "दमा"]],
];

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Latin phrases need word edges; JavaScript's \b does not work for Devanagari, so use lookarounds.
const COMPILED = TOPICS.map(([title, phrases]) => ({
  title,
  regex: new RegExp(`(?<![a-z0-9\\u0900-\\u097f])(?:${phrases.map(escape).join("|")})(?![a-z0-9\\u0900-\\u097f])`, "i"),
}));

const normalize = (text: string) => text.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, " ");

/** MedlinePlus topic titles mentioned in the text, in the order of the table (most specific first). */
export function findTopics(text: string, max = 3): string[] {
  const clean = normalize(text);
  const out: string[] = [];
  for (const topic of COMPILED) {
    if (out.length >= max) break;
    if (topic.regex.test(clean)) out.push(topic.title);
  }
  // "Migraine" is more useful than "Headache" when both appear.
  if (out.includes("Migraine") && out.includes("Headache")) out.splice(out.indexOf("Headache"), 1);
  return out;
}

const HINGLISH = /(?<![a-z])(hai|hain|mujhe|mera|meri|mere|nahi|nahin|kya|kaise|kab|ho raha|ho rahi|dard|bukhar|kal se|subah|raat|bahut|thoda|kuch|aur|lekin)(?![a-z])/g;

export function detectLanguage(text: string): "en" | "hi" | "hinglish" {
  if (/[ऀ-ॿ]/.test(text)) return "hi";
  const hits = normalize(text).match(HINGLISH)?.length ?? 0;
  return hits >= 2 || (hits === 1 && text.split(/\s+/).length <= 4) ? "hinglish" : "en";
}

export type WhoFor = "self" | "baby" | "child" | "older_adult" | "pregnant" | "someone_else" | "unknown";

export function detectWhoFor(text: string): WhoFor {
  const clean = normalize(text);
  if (/(?<![a-z])(baby|infant|newborn|\d+\s*(?:day|week|month)s?\s*old)(?![a-z])|शिशु|बच्चा/.test(clean)) return "baby";
  if (/(?<![a-z])(son|daughter|child|kid|toddler|beta|beti|\d{1,2}\s*(?:year|yr)s?\s*old (?:boy|girl))(?![a-z])/.test(clean)) return "child";
  if (/(?<![a-z])(grandma|grandpa|grandmother|grandfather|nani|dadi|nana|dada|elderly|old age)(?![a-z])/.test(clean)) return "older_adult";
  if (/(?<![a-z])(pregnant|pregnancy)(?![a-z])|गर्भवती/.test(clean)) return "pregnant";
  if (/(?<![a-z])(my|meri|mere|mera)\s+(mom|mum|mother|dad|father|husband|wife|friend|brother|sister|maa|papa|pati|patni)(?![a-z])/.test(clean)) return "someone_else";
  if (/(?<![a-z])(i|i'm|i am|my|me|mujhe|mera|meri)(?![a-z])/.test(clean)) return "self";
  return "unknown";
}
