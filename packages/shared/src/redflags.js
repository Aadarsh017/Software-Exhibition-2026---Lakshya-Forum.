// Red-flag engine shared by the browser (instant, works offline) and the server.
// Rules can only raise the care level: the AI may answer with a higher level,
// never a lower one. Patterns are strings compiled with RegExp so the build
// minifier never has to parse regex literals.

export const CARE_LEVELS = ["selfcare", "doctor", "doctor24", "emergency", "ambulance"];

// Stored with every answer (messages.content_version). Change it whenever a rule or level changes.
export const RULES_VERSION = "2026-10-20.1";

export function careRank(level) {
  return CARE_LEVELS.indexOf(level);
}

export function higherCare(a, b) {
  return careRank(a) >= careRank(b) ? a : b;
}

const WHO = "(?:my|his|her|their|the|our)\\s+";
const PERSON = "(?:he|she|they|dad|mom|mum|mother|father|grandma|grandpa|grandmother|grandfather|nani|dadi|nana|dada|baby|child|son|daughter|husband|wife|patient)";
// "can't breathe through my nose" is a blocked nose, not an emergency. Written after the fixed word "breath" so the
// regex can't backtrack around it.
const NOT_NOSE = "(?![a-z]*\\s+(?:properly\\s+|well\\s+|normally\\s+)?(?:through|from|out\\s+of|with)\\s+(?:my\\s+|his\\s+|her\\s+|their\\s+|the\\s+|one\\s+|a\\s+)?(?:blocked\\s+|stuffy\\s+)?(?:nose|nostrils?))";

// Each rule matches when any `any` pattern matches, or when every group in
// `all` has at least one pattern that matches. `exclude` phrases are blanked
// out first (e.g. "food poisoning" is not a poisoning emergency).
const RULES = [
  {
    id: "chest-pain",
    level: "ambulance",
    sign: "Chest pain, pressure or tightness",
    any: [
      "chest\\s+(?:pain|pains|pian|tightness|pressure|discomfort|heaviness)",
      "(?:pain|pressure|tightness|heaviness|squeezing)\\s+(?:in|on)\\s+(?:" + WHO + ")?chest",
      "chest\\s+(?:is|feels|was)\\s+(?:tight|heavy|crushing|squeezing)",
      // Everyday wording (bug review 2026-10-20): "my chest hurts", "chest is paining since morning".
      "chest\\s+(?:is\\s+|was\\s+|has\\s+been\\s+|keeps\\s+)?(?:hurts|hurting|paining|aching)",
      "chest\\s+(?:me|mein|main|mai|mei)\\s+(?:pain|dard)",
      "heart\\s+attack",
      "seen[ae]\\s+(?:me|mein|main|mai|mei)\\s+(?:(?:bahut|bohot|bahot|tez|tej|zor\\s+ka)\\s+)?dard",
      "chh?aa?tt?(?:i|ee)\\s+(?:me|mein|main|mai|mei)\\s+(?:(?:bahut|bohot|bahot|tez|tej|zor\\s+ka)\\s+)?dard",
      "(?:सीने|छाती)\\s*(?:में|मे)\\s*(?:(?:बहुत|तेज|जोर\\s*का|भारी)\\s*)?दर्द",
      "दिल\\s*का\\s*दौरा",
    ],
  },
  {
    id: "stroke",
    level: "ambulance",
    sign: "Stroke signs (face drooping, arm weakness, speech trouble)",
    any: [
      "(?:face|mouth|smile)\\s+(?:is\\s+)?(?:drooping|droops|drooped|droopy|lopsided)",
      "drooping\\s+(?:face|mouth)",
      "slurr(?:ed|ing)\\s+(?:speech|words)",
      "(?:can't|cannot|can\\s+not|unable\\s+to)\\s+(?:speak|talk)\\s+(?:properly|clearly|right)",
      "(?:weakness|numbness)\\s+(?:on|in)\\s+one\\s+side",
      "one\\s+side\\s+of\\s+(?:" + WHO + ")?(?:face|body)\\s+(?:is\\s+)?(?:weak|numb|drooping|not\\s+moving)",
      "\\bstroke\\b",
      "lakwa",
      "लकवा",
    ],
  },
  {
    id: "cannot-breathe",
    level: "ambulance",
    sign: "Can't breathe, choking or blue lips",
    any: [
      "(?:can't|cant|cannot|can\\s+not|unable\\s+to|struggling\\s+to|(?:not|isn't|isnt|am\\s+not|is\\s+not|are\\s+not)\\s+able\\s+to)\\s+breath" + NOT_NOSE,
      // "he is not breathing" is an emergency; "not breathing properly" is handled by breathing-trouble,
      // and "not breathing through my nose" (a blocked nose) is neither.
      // "right now" and "in his sleep" still mean not breathing (bug review 2026-10-20).
      "(?:not|isn't|isnt|wasn't|wasnt|stopped)\\s+breathing(?!\\s+(?:problem|problems|issue|issues|trouble|difficult|properly|well|right(?!\\s+now)|normally|through|from|out|in\\b(?!\\s+(?:(?:his|her|their|my|the|its)\\s+)?sleep)))",
      "breathing\\s+(?:has\\s+|had\\s+)?stopped",
      "gasping\\s+for\\s+(?:air|breath)",
      "(?:lips|face)\\s+(?:(?:are|is|turning|look|looks|went|gone|going)\\s+)*(?:blue|bluish)",
      "blue\\s+lips",
      "\\bchoking\\b",
      "saa?ns\\s+(?:nahi|nahin|nhi)\\s+(?:aa|le)\\b",
      "सा(?:ं|ँ)?स\\s*(?:नहीं|नही)\\s*(?:आ|ले)",
    ],
  },
  {
    id: "breathing-trouble",
    level: "emergency",
    sign: "Trouble breathing",
    any: [
      "(?:trouble|difficulty|difficult|hard|problem)\\s+(?:in\\s+)?breathing",
      "(?:not|isn't|isnt)\\s+breathing\\s+(?:properly|well|right|normally)(?!\\s+(?:through|from))",
      "short(?:ness)?\\s+of\\s+breath",
      "breathless",
      "saa?ns\\s+(?:lene\\s+)?(?:me|mein|main)\\s+(?:dikkat|takleef|taklif|pareshani)",
      "saa?ns\\s+phool",
      "सा(?:ं|ँ)?स\\s*(?:लेने\\s*)?(?:में|मे)\\s*(?:दिक्कत|तकलीफ|परेशानी)",
      "सा(?:ं|ँ)?स\\s*फूल",
    ],
  },
  {
    id: "unconscious",
    level: "ambulance",
    sign: "Unconscious or not waking up",
    any: [
      "unconscious",
      "unresponsive",
      "(?:not|won't|wont|can't|cant|doesn't|doesnt|didn't|didnt|couldn't|couldnt)\\s+(?:waking|wake)\\s+(?:up|him|her|them)(?!\\s+(?:for|on\\s+time|early|easily|in\\s+the\\s+morning|at\\s+night))",
      // Collapsed, or someone not responding (but not "not responding to the medicine").
      "\\bcollaps(?:ed|es|ing)\\b",
      "\\b" + PERSON + "\\s+(?:is\\s+|was\\s+|has\\s+)?(?:not|isn't|isnt|wasn't|wasnt|stopped)\\s+respond(?![a-z]*\\s+to\\s+(?:the\\s+|any\\s+|my\\s+|our\\s+|his\\s+|her\\s+)?(?:medicines?|medications?|treatment|tablets?|pills?|antibiotics?|paracetamol|drugs?|calls?|messages?|texts?|phone))",
      "behosh",
      "बेहोश",
    ],
  },
  {
    id: "fainting",
    level: "emergency",
    sign: "Fainting or passing out",
    any: ["faint(?:ed|ing)", "passed\\s+out", "blacked\\s+out"],
  },
  {
    id: "seizure",
    level: "ambulance",
    sign: "Seizure or convulsions",
    any: ["seizure", "convulsion", "jerking\\s+uncontrollably", "mirgi", "daura\\s+(?:pada|aaya|aa\\s+raha)", "मिर्गी", "दौरा\\s*(?:पड|आ)"],
  },
  {
    id: "severe-bleeding",
    level: "ambulance",
    sign: "Severe bleeding that won't stop",
    any: [
      "(?:severe|heavy|massive|uncontrolled|lot\\s+of)\\s+bleeding",
      "bleeding\\s+(?:a\\s+lot|heavily|badly|profusely)",
      "bleeding\\s+(?:won't|wont|will\\s+not|doesn't|does\\s+not|isn't|is\\s+not)\\s+stop",
      "(?:can't|cant|cannot)\\s+stop\\s+(?:the\\s+)?bleeding",
      "spurting\\s+blood",
      "khoon\\s+(?:ruk\\s+nahi|band\\s+nahi)",
      "खून\\s*(?:रुक|बंद)\\s*(?:नहीं|नही)",
    ],
  },
  {
    id: "vomiting-blood",
    level: "emergency",
    sign: "Vomiting or coughing up blood, or black stools",
    any: [
      "(?:vomit(?:ing|ed)?|throw(?:ing)?\\s+up|cough(?:ing|ed)?(?:\\s+up)?)\\s+blood",
      "blood\\s+in\\s+(?:" + WHO + ")?vomit",
      "black\\s+(?:tarry\\s+)?(?:stool|stools|poop)",
      "khoon\\s+ki\\s+ulti",
      "खून\\s*की\\s*उल्टी",
    ],
  },
  {
    id: "anaphylaxis",
    level: "ambulance",
    sign: "Severe allergic reaction (swelling of throat, tongue or lips)",
    any: [
      "anaphyla",
      "(?:throat|tongue|lips?)\\s+(?:is\\s+|are\\s+)?(?:swelling|swollen|closing)",
      "swollen\\s+(?:throat|tongue)",
    ],
  },
  {
    id: "poisoning",
    level: "ambulance",
    sign: "Poisoning or overdose",
    any: [
      "overdos",
      "took\\s+(?:too\\s+many|a\\s+lot\\s+of|an\\s+entire|the\\s+whole)\\s+(?:pills|tablets|bottle|strip)",
      "(?:swallowed|drank|ate|drunk)\\s+(?:some\\s+)?(?:bleach|poison|pesticide|kerosene|acid|rat\\s+poison|cleaning)",
      "\\bpoison(?:ed|ing)?\\b",
      "zeher",
      "जहर\\s*(?:खा|पी)",
    ],
    exclude: ["food\\s+poison(?:ing|ed)?", "poison\\s+(?:ivy|oak|sumac)"],
  },
  {
    id: "self-harm",
    level: "ambulance",
    crisis: true,
    sign: "Thoughts of suicide or self-harm",
    any: [
      "suicid",
      "kill(?:ing)?\\s+(?:my|him|her|them)sel(?:f|ves)",
      "end(?:ing)?\\s+(?:my|it)\\s+(?:life|all)",
      "tak(?:e|ing)\\s+my\\s+(?:own\\s+)?life",
      "(?:want|wanted|wanting)\\s+to\\s+die",
      "(?:don't|dont|do\\s+not)\\s+want\\s+to\\s+(?:live|be\\s+alive)",
      "no\\s+reason\\s+to\\s+live",
      "better\\s+off\\s+dead",
      "(?:want|wanted|thinking\\s+(?:of|about)|keep|kept|been)\\s+(?:to\\s+)?(?:hurt|hurting|harm|harming|cut|cutting)\\s+myself",
      "self[\\s-]?harm",
      "marna\\s+chaht[aie]",
      "jeena\\s+nahi\\s+chaht[aie]",
      "mujhe\\s+(?:mar\\s+jana|marna)\\s+(?:hai|h)\\b",
      "mar\\s+jana\\s+chaht[aie]",
      "jeene\\s+ka\\s+(?:man|mann|dil)\\s+(?:nahi|nahin|nhi)",
      "aatmahatya|atmahatya|khudkushi",
      "आत्महत्या|खुदकुशी|मरना\\s*चाहत",
      "मर\\s*जाना\\s*चाहत|मुझे\\s*(?:मर\\s*जाना|मरना)\\s*है",
      "जीना\\s*(?:नहीं|नही)\\s*चाहत|जीने\\s*का\\s*(?:मन|दिल)\\s*(?:नहीं|नही)",
    ],
  },
  {
    id: "worst-headache",
    level: "emergency",
    sign: "Sudden, severe or 'worst ever' headache",
    any: [
      "worst\\s+headache",
      "thunderclap",
      "sudden(?:ly)?\\s+(?:severe|very\\s+bad|terrible|intense|extreme|bad)\\s+headache",
      "headache\\s+(?:came\\s+on\\s+)?(?:suddenly|out\\s+of\\s+nowhere)\\s+(?:and\\s+)?(?:is\\s+)?(?:severe|terrible|unbearable)",
    ],
  },
  {
    id: "fever-stiff-neck",
    level: "emergency",
    sign: "Fever with a stiff neck or a rash that doesn't fade",
    all: [
      ["fever", "temperature", "bukhar", "बुखार", "\\b10[3-6](?:\\.\\d)?\\s*(?:°|deg|degrees)?\\s*f\\b"],
      ["stiff\\s+neck", "neck\\s+(?:is\\s+|feels\\s+)?stiff", "rash\\s+(?:that\\s+)?(?:doesn't|does\\s+not|won't)\\s+fade"],
    ],
  },
  {
    id: "baby-fever",
    level: "emergency",
    sign: "Fever in a baby under 3 months",
    all: [
      [
        "newborn",
        "\\b(?:[1-9]|1[0-2])[\\s-]*(?:week|weeks)[\\s-]*old",
        "\\b[0-2][\\s-]*(?:month|months)[\\s-]*old",
        "\\b(?:one|two)[\\s-]*months?[\\s-]*old",
        // Ages in days or written as words (bug review 2026-10-20): "10 day old", "three week old", "a week old".
        "\\b(?:[1-9]|[1-8]\\d)[\\s-]*days?[\\s-]*old",
        "\\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)[\\s-]*weeks?[\\s-]*old",
        "\\b(?:a|few|couple\\s+of)[\\s-]+(?:days?|weeks?|month)[\\s-]*old",
        "\\b(?:[1-9]|[1-8]\\d)\\s+din\\s+k[aie]\\b",
        "\\b[1-2]\\s+(?:mahine|mahina)\\s+k[aie]\\b",
      ],
      ["fever", "temperature", "hot\\s+to\\s+the\\s+touch", "bukhar", "बुखार"],
    ],
  },
  {
    id: "head-injury",
    level: "emergency",
    sign: "Head injury with vomiting, confusion or drowsiness",
    all: [
      ["head\\s+injur", "hit\\s+(?:my|his|her|their)\\s+head", "fell\\s+on\\s+(?:my|his|her|their)\\s+head", "bumped\\s+(?:my|his|her|their)\\s+head"],
      ["vomit", "throw(?:ing)?\\s+up", "confus", "drows", "sleepy", "passed\\s+out", "blurr"],
    ],
  },
  {
    id: "sudden-confusion",
    level: "emergency",
    sign: "Sudden confusion",
    any: [
      "sudden(?:ly)?\\s+(?:very\\s+)?confus",
      "\\b" + PERSON + "\\s+(?:is|became|seems|has\\s+become)\\s+(?:very\\s+|suddenly\\s+)?(?:confused|disoriented)",
      "not\\s+making\\s+(?:any\\s+)?sense\\s+when\\s+(?:he|she|they)\\s+(?:talk|speak)",
    ],
  },
  {
    id: "severe-abdominal",
    level: "emergency",
    sign: "Severe belly pain",
    any: [
      "(?:severe|unbearable|worst|excruciating|extreme)\\s+(?:stomach|abdominal|belly|tummy)\\s+(?:pain|ache)",
      "(?:stomach|abdominal|belly|tummy)\\s+pain\\s+is\\s+(?:severe|unbearable|excruciating)",
    ],
  },
  {
    id: "pregnancy-warning",
    level: "emergency",
    sign: "Pregnancy with bleeding, severe pain or reduced baby movement",
    all: [
      ["pregnan", "garbh", "गर्भ", "प्रेग्नेंट"],
      ["bleeding", "severe\\s+(?:pain|cramp)", "(?:baby|fetus)\\s+(?:is\\s+)?not\\s+moving", "(?:less|reduced|no)\\s+(?:baby\\s+)?movement", "water\\s+broke", "blurred\\s+vision", "severe\\s+headache"],
    ],
  },
  {
    id: "vision-loss",
    level: "emergency",
    sign: "Sudden loss of vision",
    any: ["sudden(?:ly)?\\s+(?:loss\\s+of\\s+vision|lost\\s+(?:my\\s+)?vision|blind)", "(?:can't|cannot|cant)\\s+see\\s+(?:anything|out\\s+of)"],
  },
  {
    id: "severe-burn",
    level: "emergency",
    sign: "Serious burn or electric shock",
    any: ["(?:severe|serious|bad|large|deep)\\s+burn", "burn(?:ed|t)\\s+(?:badly|my\\s+whole|all\\s+over)", "electric\\s+shock", "electrocut"],
  },
  {
    id: "heat-stroke",
    level: "emergency",
    sign: "Heat stroke",
    any: ["heat\\s*stroke", "\\bloo\\s+lag"],
  },
  {
    id: "major-injury",
    level: "ambulance",
    sign: "Serious injury or accident",
    any: [
      "major\\s+injur",
      "(?:serious|bad|major)\\s+(?:road\\s+|car\\s+|bike\\s+|traffic\\s+)?accident",
      "hit\\s+by\\s+a\\s+(?:car|bike|truck|bus|vehicle|motorcycle|train)",
      "fell\\s+from\\s+(?:a\\s+|the\\s+)?(?:height|roof|building|terrace|tree)",
      "bone\\s+(?:is\\s+)?(?:sticking|poking)\\s+out",
    ],
  },
];

// A negating word right before a match ("no chest pain", "don't have a fever")
// cancels it. The window is deliberately tiny and skips words like "never" or
// "without", because "I've never had chest pain like this" is an emergency.
const NEGATORS = new RegExp(
  "\\b(?:no|not|denies|deny|none|don't|dont|do\\s+not|doesn't|doesnt|does\\s+not|didn't|didnt|did\\s+not|isn't|isnt|aren't|arent|haven't|havent|hasn't|hasnt)\\b"
);
// Phrases that contain a negation word but do not negate the symptom.
const PSEUDO_NEGATIONS = new RegExp(
  "\\b(?:not\\s+(?:sure|certain|only|just)|(?:don't|dont|do\\s+not|didn't|didnt|did\\s+not)\\s+(?:know|think|realize|realise|expect)|no\\s+(?:idea|matter|doubt))\\b",
  "g"
);
// "and" ends a clause too (bug review 2026-10-20): in "no appetite and chest pain" or "haven't slept and want to die"
// the "no"/"haven't" belongs to the first part. Rules lean towards raising the alarm.
const CLAUSE_BREAKS = new RegExp("(?:[.,!?;\\n]|\\band\\b|\\baur\\b|\\bbut\\b|\\bhowever\\b|\\balthough\\b|\\bthough\\b|\\bexcept\\b|\\blekin\\b|\\bmagar\\b|और|लेकिन|मगर)", "g");
const WHITESPACE = new RegExp("\\s+");

// Hindi typed on different keyboards: precomposed letters (U+0958–U+095F) are split by NFD and the nukta dropped, so
// "ज़हर" and "जहर" read the same; zero-width joiners are removed, not turned into spaces (bug review 2026-10-20).
function normalize(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(new RegExp("[\\u093c\\u200b-\\u200d\\u2060\\ufeff]", "g"), "")
    .toLowerCase()
    .replace(new RegExp("[\\u2018\\u2019\\u02bc`]", "g"), "'")
    .replace(new RegExp("[^a-z0-9\\s'.,!?;°\\-\\u0900-\\u097f]", "g"), " ")
    .replace(new RegExp("[ \\t]+", "g"), " ");
}

function isNegated(text, index) {
  let clause = text.slice(Math.max(0, index - 60), index);
  let lastBreak = -1;
  CLAUSE_BREAKS.lastIndex = 0;
  let found = CLAUSE_BREAKS.exec(clause);
  while (found) {
    lastBreak = found.index + found[0].length;
    found = CLAUSE_BREAKS.exec(clause);
  }
  if (lastBreak !== -1) {
    clause = clause.slice(lastBreak);
  }
  clause = clause.replace(PSEUDO_NEGATIONS, " ");
  const lastWords = clause.trim().split(WHITESPACE).slice(-3).join(" ");
  return NEGATORS.test(lastWords);
}

const compiled = RULES.map((rule) => {
  const toRegex = (pattern) => new RegExp(pattern, "g");
  return {
    ...rule,
    anyRe: (rule.any || []).map(toRegex),
    allRe: (rule.all || []).map((group) => group.map(toRegex)),
    excludeRe: (rule.exclude || []).map(toRegex),
  };
});

// When a key fact is missing, the rules cannot decide. Instead of staying silent, ask one question.
// Only offered when no emergency rule matched.
const AGE_PHRASES = [
  "\\b\\d+[\\s-]*(?:day|days|week|weeks|month|months|year|years|yr|yrs)[\\s-]*old\\b",
  "\\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)[\\s-]*(?:week|weeks|month|months|year|years)[\\s-]*old\\b",
  "\\bnewborn\\b",
];
const FOLLOW_UPS = [
  {
    id: "baby-fever-age",
    ask: "How old is the baby? A fever in a baby under 3 months needs urgent care.",
    all: [["\\b(?:baby|infant|toddler)\\b", "बच्चा|बच्चे|शिशु"], ["fever", "temperature", "bukhar", "बुखार"]],
    unless: AGE_PHRASES,
  },
  {
    id: "head-injury-symptoms",
    ask: "After the knock, did they vomit, pass out, seem confused or very sleepy? Any of those needs urgent care.",
    all: [["head\\s+injur", "hit\\s+(?:my|his|her|their)\\s+head", "fell\\s+on\\s+(?:my|his|her|their)\\s+head", "bumped\\s+(?:my|his|her|their)\\s+head"]],
    unless: [],
  },
].map((rule) => ({
  ...rule,
  allRe: rule.all.map((group) => group.map((pattern) => new RegExp(pattern, "g"))),
  unlessRe: rule.unless.map((pattern) => new RegExp(pattern, "g")),
}));

function firstLiveMatch(text, regexes) {
  for (const regex of regexes) {
    regex.lastIndex = 0;
    let match = regex.exec(text);
    while (match) {
      if (!isNegated(text, match.index)) {
        return match[0];
      }
      if (match[0] === "") {
        regex.lastIndex += 1;
      }
      match = regex.exec(text);
    }
  }
  return null;
}

/**
 * Checks a message for emergency warning signs.
 * Returns { level, crisis, matches, followUps } where level is "ambulance", "emergency" or null.
 * `followUps` holds one question to ask when a key fact is missing (only when nothing else matched).
 */
export function checkRedFlags(input) {
  const base = normalize(input);
  const matches = [];

  for (const rule of compiled) {
    let text = base;
    for (const regex of rule.excludeRe) {
      regex.lastIndex = 0;
      text = text.replace(regex, (found) => " ".repeat(found.length));
    }

    let phrase = null;
    if (rule.anyRe.length) {
      phrase = firstLiveMatch(text, rule.anyRe);
    } else if (rule.allRe.length) {
      const parts = rule.allRe.map((group) => firstLiveMatch(text, group));
      phrase = parts.every(Boolean) ? parts.join(" + ") : null;
    }

    if (phrase) {
      matches.push({
        id: rule.id,
        level: rule.level,
        sign: rule.sign,
        crisis: Boolean(rule.crisis),
        compound: rule.allRe.length > 0,
        phrase,
      });
    }
  }

  matches.sort((a, b) => careRank(b.level) - careRank(a.level));

  const followUps = [];
  if (!matches.length) {
    for (const rule of FOLLOW_UPS) {
      const hit = rule.allRe.every((group) => firstLiveMatch(base, group));
      const known = rule.unlessRe.some((regex) => {
        regex.lastIndex = 0;
        return regex.test(base);
      });
      if (hit && !known) {
        followUps.push({ id: rule.id, ask: rule.ask });
      }
    }
  }

  return {
    level: matches.length ? matches[0].level : null,
    crisis: matches.some((match) => match.crisis),
    matches,
    followUps,
  };
}
