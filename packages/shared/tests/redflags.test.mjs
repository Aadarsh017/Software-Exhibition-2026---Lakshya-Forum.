import { test } from "node:test";
import assert from "node:assert/strict";
import { checkRedFlags, higherCare } from "../src/redflags.js";

const flagged = (text) => checkRedFlags(text).level;

test("flags clear emergencies", () => {
  const cases = [
    ["I have chest pain and my left arm hurts", "ambulance"],
    ["my dad has crushing pressure in his chest", "ambulance"],
    ["her face is drooping and her speech is slurred", "ambulance"],
    ["I can't breathe", "ambulance"],
    ["cant breath properly", "ambulance"],
    ["baby's lips are turning blue", "ambulance"],
    ["he is unconscious", "ambulance"],
    ["my son is having a seizure", "ambulance"],
    ["the bleeding won't stop", "ambulance"],
    ["my tongue is swelling after eating peanuts", "ambulance"],
    ["my friend took too many pills", "ambulance"],
    ["I want to kill myself", "ambulance"],
    ["worst headache of my life", "emergency"],
    ["fever and a stiff neck since morning", "emergency"],
    ["my 2 month old has a fever", "emergency"],
    ["shortness of breath when I walk", "emergency"],
    ["I fainted at work", "emergency"],
    ["she hit her head and keeps vomiting", "emergency"],
    ["I'm pregnant and bleeding", "emergency"],
    ["vomiting blood since an hour", "emergency"],
  ];
  for (const [text, level] of cases) {
    assert.equal(flagged(text), level, text);
  }
});

test("understands Hinglish and Hindi", () => {
  assert.equal(flagged("seene mein dard ho raha hai"), "ambulance");
  assert.equal(flagged("saans nahi aa rahi"), "ambulance");
  assert.equal(flagged("सीने में दर्द हो रहा है"), "ambulance");
  assert.equal(flagged("मुझे साँस लेने में दिक्कत है"), "emergency");
  assert.equal(flagged("marna chahta hoon"), "ambulance");
});

test("respects simple negation", () => {
  assert.equal(flagged("no chest pain, just a runny nose"), null);
  assert.equal(flagged("I don't have chest pain or fever"), null);
  assert.equal(flagged("I do not have shortness of breath"), null);
  assert.equal(flagged("there is no bleeding"), null);
});

test("does not let a far-away or tricky negation hide an emergency", () => {
  assert.equal(flagged("I've never had chest pain like this before"), "ambulance");
  assert.equal(flagged("I'm not sure if it's chest pain or heartburn"), "ambulance");
  assert.equal(flagged("No, I have chest pain"), "ambulance");
  assert.equal(flagged("I don't have a fever but I have chest pain"), "ambulance");
  assert.equal(flagged("I can't walk without chest pain"), "ambulance");
  assert.equal(flagged("I don't know if this is a heart attack"), "ambulance");
});

test("avoids common false alarms", () => {
  const calm = [
    "I have a headache. What should I do?",
    "I think I have food poisoning from street food",
    "rash from poison ivy",
    "I hurt myself playing football",
    "I cut myself while cooking, small cut",
    "I'm confused about how often to take my medicine",
    "stiff neck after sleeping badly",
    "I don't want to die from this, I'm scared",
    "my 8 year old has a mild fever",
    "Is paracetamol poisonous for dogs?",
    "cough and cold for two days",
  ];
  for (const text of calm) {
    assert.equal(flagged(text), null, text);
  }
});

test("asks one question when a key fact is missing", () => {
  const baby = checkRedFlags("my baby has a fever");
  assert.equal(baby.level, null);
  assert.equal(baby.followUps[0].id, "baby-fever-age");

  assert.equal(flagged("my 2 month old has a fever"), "emergency");
  assert.equal(checkRedFlags("my baby is 8 months old and has a fever").followUps.length, 0);
  assert.equal(checkRedFlags("my baby has a runny nose").followUps.length, 0);

  const knock = checkRedFlags("I hit my head on the shelf");
  assert.equal(knock.level, null);
  assert.equal(knock.followUps[0].id, "head-injury-symptoms");
  assert.equal(flagged("I hit my head and I keep vomiting"), "emergency");
  assert.equal(checkRedFlags("I hit my head and I keep vomiting").followUps.length, 0);
});

test("marks crisis messages separately", () => {
  const result = checkRedFlags("I don't want to live anymore");
  assert.equal(result.crisis, true);
  assert.equal(checkRedFlags("chest pain").crisis, false);
});

test("higherCare never lowers the level", () => {
  assert.equal(higherCare("ambulance", "selfcare"), "ambulance");
  assert.equal(higherCare("doctor", "emergency"), "emergency");
  assert.equal(higherCare(null, "doctor24"), "doctor24");
});

test("someone who is not breathing is an ambulance case, a blocked nose is not", () => {
  assert.equal(flagged("my dad is not breathing"), "ambulance");
  assert.equal(flagged("the baby stopped breathing for a few seconds"), "ambulance");
  assert.equal(flagged("he isn't breathing"), "ambulance");
  assert.equal(flagged("her breathing has stopped"), "ambulance");
  assert.equal(flagged("she is not breathing properly"), "emergency");
  assert.equal(flagged("I'm not breathing properly through my nose because of a cold"), null);
  assert.equal(flagged("no breathing problems, just a cough"), null);
  assert.equal(flagged("not breathing problems exactly, more a tight feeling in my throat"), null);
});

test("marks rules that need several facts together", () => {
  const baby = checkRedFlags("my 2 month old has a fever");
  assert.equal(baby.matches[0].compound, true);
  const chest = checkRedFlags("chest pain");
  assert.equal(chest.matches[0].compound, false);
});

test("bug review 2026-10-20: everyday emergency wording is caught", () => {
  const cases = [
    ["I feel like killing myself", "ambulance"],
    ["I am thinking of ending my life", "ambulance"],
    ["ending it all", "ambulance"],
    ["I want to take my own life", "ambulance"],
    ["मैं जीना नहीं चाहता", "ambulance"],
    ["मैं मर जाना चाहता हूँ", "ambulance"],
    ["mujhe mar jana hai", "ambulance"],
    ["jeene ka man nahi karta", "ambulance"],
    ["I am not able to breathe", "ambulance"],
    ["my father is not able to breathe properly", "ambulance"],
    ["baby saans nahi le raha", "ambulance"],
    ["my baby is not breathing in his sleep", "ambulance"],
    ["he is not breathing right now", "ambulance"],
    ["my chest is paining since morning", "ambulance"],
    ["my chest hurts", "ambulance"],
    ["mujhe chest me pain ho raha hai", "ambulance"],
    ["chaati mein dard", "ambulance"],
    ["सीने में बहुत दर्द है", "ambulance"],
    ["he is not responding", "ambulance"],
    ["she doesn't wake up", "ambulance"],
    ["he collapsed in the bathroom", "ambulance"],
    ["my 10 day old baby has fever", "emergency"],
    ["three week old baby has a fever", "emergency"],
    ["a week old baby with high temperature", "emergency"],
  ];
  for (const [text, level] of cases) assert.equal(flagged(text), level, text);
  for (const text of ["I feel like killing myself", "ending it all", "मैं जीना नहीं चाहता", "mujhe mar jana hai"]) {
    assert.equal(checkRedFlags(text).crisis, true, text);
  }
});

test("bug review 2026-10-20: a 'no' before 'and' doesn't cancel what comes after", () => {
  assert.equal(flagged("haven't slept and want to die"), "ambulance");
  assert.equal(checkRedFlags("haven't slept and want to die").crisis, true);
  assert.equal(flagged("I have no appetite and chest pain"), "ambulance");
  assert.equal(flagged("not eating and chest pain since morning"), "ambulance");
  assert.equal(flagged("no fever and no cough"), null);
  assert.equal(flagged("no chest pain"), null);
});

test("bug review 2026-10-20: Hindi typed with precomposed letters or joiners is read the same", () => {
  assert.equal(flagged("ज़हर खा लिया"), "ambulance");
  assert.equal(flagged("दौरा पड़ गया"), "ambulance");
  assert.equal(flagged("सां‍स नहीं आ रही"), "ambulance");
  assert.equal(flagged("हर खाने के बाद पेट में दर्द"), null, "'every meal' is not poison");
});

test("bug review 2026-10-20: the new wording doesn't raise false alarms", () => {
  const calm = [
    "I can't breathe through my nose, it's blocked",
    "I'm not able to breathe through my nose at night",
    "my fever is not responding to paracetamol",
    "he is not responding to the antibiotics",
    "she is not responding to my messages",
    "my son doesn't wake up for school on time",
    "my 4 month old has a cold",
    "my baby is 5 months old and has fever",
    "my chest feels a bit congested with phlegm",
  ];
  for (const text of calm) assert.equal(flagged(text), null, text);
});
