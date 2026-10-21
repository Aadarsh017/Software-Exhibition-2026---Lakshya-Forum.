// First aid while help comes (DESIGN.md 7.7a): short do's and don'ts for the emergencies people in India meet most,
// shown on the offline emergency page. Close paraphrases of the sources listed with each guide (PLAN.md §12, "Research
// round 2"); where sources differ we keep the more careful advice. Fixed wording, never the AI. Needs clinician review,
// and a Hindi version checked by a clinician, before launch (PLAN 6.12). Erasable TypeScript only.

export type Guide = {
  id: string;
  title: string;
  /** One line under the title: when this guide applies. */
  when: string;
  call112: boolean;
  dos: string[];
  donts: string[];
  sources: { label: string; url: string }[];
};

export const FIRST_AID: Guide[] = [
  {
    id: "cpr",
    title: "Not breathing normally",
    when: "Doesn't respond, and isn't breathing or only gasping",
    call112: true,
    dos: [
      "Call 112 and put the phone on speaker.",
      "Kneel beside them. Put the heel of one hand in the centre of the chest, the other hand on top.",
      "Push down hard and fast, about 5 to 6 cm, twice a second. Let the chest come back up each time.",
      "Keep going until help arrives or they start breathing normally. Swap with someone if you tire.",
    ],
    donts: ["Don't stop to check for breathing again and again.", "Don't wait for a doctor before you start pushing."],
    sources: [{ label: "NHS: CPR", url: "https://www.nhs.uk/conditions/first-aid/cpr/" }],
  },
  {
    id: "choking",
    title: "Choking (adult)",
    when: "Can't cough, speak or breathe",
    call112: true,
    dos: [
      "If they can cough, tell them to keep coughing.",
      "If they can't: up to 5 sharp blows between the shoulder blades while they lean forward.",
      "Then up to 5 abdominal thrusts: stand behind, a fist just above the belly button, pull sharply in and up.",
      "Keep alternating. Call 112 if it doesn't clear. If they stop responding, start CPR.",
      "See a doctor afterwards if you used abdominal thrusts.",
    ],
    donts: ["Don't put your fingers in their mouth to search for the object.", "Don't use abdominal thrusts on a pregnant woman or a baby under 1: call 112 and follow their instructions."],
    sources: [
      { label: "NHS (NEAS): choking", url: "https://www.neas.nhs.uk/community-learning/emergency-advice/choking" },
      { label: "AHA 2025 basic life support", url: "https://cpr.heart.org/en/resuscitation-science/cpr-and-ecc-guidelines/adult-basic-life-support" },
    ],
  },
  {
    id: "snakebite",
    title: "Snake bite",
    when: "Any snake bite, even if it doesn't hurt much",
    call112: true,
    dos: [
      "Stay calm and reassure them: most snake bites are not venomous.",
      "Keep the bitten arm or leg still, like a broken bone: a loose splint, no pressure.",
      "Take off rings, watches, shoes and anything tight near the bite.",
      "Get to the nearest hospital or health centre at once (call 108 or 112). Don't let them walk or drive.",
      "Tell the doctor about any symptoms on the way. Take a photo of the snake only if it's safe.",
    ],
    donts: [
      "No tight tourniquet or rope.",
      "Don't cut, suck, rub or massage the bite, and put nothing on it: no herbs, chemicals, ice or 'black stone'.",
      "Nothing to eat or drink.",
      "Don't lose time with a traditional healer, and don't try to catch or kill the snake.",
    ],
    sources: [
      { label: "MoHFW snakebite guidelines (2016)", url: "https://clinicalestablishments.mohfw.gov.in/sites/default/files/standard-treatment-guidelines/3941.pdf" },
      { label: "WHO: snakebite", url: "https://www.who.int/news-room/fact-sheets/detail/snakebite-envenoming" },
      { label: "NHS: snake bites", url: "https://www.nhs.uk/conditions/snake-bites/" },
    ],
  },
  {
    id: "burns",
    title: "Burns and scalds",
    when: "Hot water, oil, fire, electricity or chemicals",
    call112: false,
    dos: [
      "Make it safe first: switch off the electricity, move away from the heat.",
      "Take off clothes and jewellery near the burn, unless stuck to the skin.",
      "Cool the burn under cool running water for 20 minutes. Keep the rest of the person warm, especially a child.",
      "Cover it loosely with cling film or a clean cloth.",
      "Go to hospital for a large or deep burn, or one on the face, hands, feet or private parts.",
      "Chemical and electrical burns always need a hospital. Call 112 for a serious burn.",
    ],
    donts: ["No ice.", "No butter, oil, toothpaste, haldi, paste or cream.", "Don't burst blisters or pull off stuck clothing.", "No sticky plasters."],
    sources: [
      { label: "NHS: burns and scalds", url: "https://www.nhs.uk/conditions/burns-and-scalds/" },
      { label: "WHO: burns", url: "https://www.who.int/news-room/fact-sheets/detail/burns" },
    ],
  },
  {
    id: "heatstroke",
    title: "Heat stroke",
    when: "Very hot skin with confusion, fainting, fits, or no sweating",
    call112: true,
    dos: [
      "Call 112 or 108.",
      "Move them to shade or a cool room and take off extra clothes.",
      "Wet the skin with cool water and fan them all the time. Cold packs or wet cloths on the neck and armpits.",
      "If they're unconscious but breathing, lay them on their side.",
      "Small sips of water only if they're fully awake.",
    ],
    donts: ["No drinks if they're confused or unconscious.", "Don't leave them alone."],
    sources: [
      { label: "NCDC heatwave advisory", url: "https://ncdc.mohfw.gov.in/uploads/pdf/5.%20Public%20Health%20Advisory_Extreme%20HeatHeatwave.pdf" },
      { label: "NHS: heatstroke", url: "https://www.nhs.uk/conditions/heat-exhaustion-heatstroke/" },
    ],
  },
  {
    id: "dogbite",
    title: "Dog or animal bite",
    when: "A bite or scratch from a dog, cat, monkey or any animal",
    call112: false,
    dos: [
      "Wash the wound with soap and running water for at least 15 minutes.",
      "Put on an antiseptic such as povidone-iodine if you have it.",
      "Go to a hospital or health centre the same day for the rabies vaccine. Deep bites also need an injection around the wound.",
      "Ask whether you need a tetanus shot.",
    ],
    donts: ["Don't put chillies, oil, turmeric or anything else on the wound.", "Don't stitch it or bind it tightly at home.", "Don't wait to see if the animal gets ill: start the vaccine now."],
    sources: [
      { label: "WHO: rabies", url: "https://www.who.int/news-room/fact-sheets/detail/rabies" },
      { label: "NHS: animal and human bites", url: "https://www.nhs.uk/conditions/animal-and-human-bites/" },
    ],
  },
  {
    id: "fainting",
    title: "Fainting",
    when: "Suddenly falls or slumps, then usually wakes quickly",
    call112: false,
    dos: [
      "Check they respond and are breathing.",
      "Lay them on their back and raise their legs. If she's more than 28 weeks pregnant, on her side.",
      "Call 112 if they don't wake within a minute, or aren't breathing normally.",
      "Also call 112 for chest pain, a fit, an injury, or fainting while exercising or lying down.",
      "See a doctor afterwards, even if they feel fine.",
    ],
    donts: ["Don't let them get up quickly: slowly, when they feel ready.", "Don't let them drive afterwards."],
    sources: [{ label: "NHS: fainting", url: "https://www.nhs.uk/conditions/fainting/" }],
  },
];
