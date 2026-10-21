import { test } from "node:test";
import assert from "node:assert/strict";
import { redact, restore, createRedactionMap } from "../src/pii.js";

test("hides emails and phone numbers", () => {
  const { text, found } = redact("Mail me at asha.k@example.com or call 98765 43210 about my fever");
  assert.ok(!text.includes("asha.k@example.com"));
  assert.ok(!text.includes("98765"));
  assert.match(text, /\[EMAIL_1\]/);
  assert.match(text, /\[PHONE_1\]/);
  assert.equal(found.length, 2);
});

test("handles +91 and 0-prefixed Indian mobile numbers", () => {
  assert.match(redact("+91 98765-43210").text, /\[PHONE_1\]/);
  assert.match(redact("09876543210").text, /\[PHONE_1\]/);
  assert.match(redact("my number is 9876543210.").text, /\[PHONE_1\]/);
});

test("hides long ID numbers such as Aadhaar but not short medical numbers", () => {
  assert.match(redact("Aadhaar 1234 5678 9012").text, /\[ID_1\]/);
  assert.equal(redact("fever of 102 for 3 days, BP 140/90").text, "fever of 102 for 3 days, BP 140/90");
  assert.equal(redact("took 500 mg twice and 650 mg once").text, "took 500 mg twice and 650 mg once");
});

test("hides names after cue phrases and the user's never-send list", () => {
  const cued = redact("My name is Asha Kumar and I have a cough");
  assert.ok(!cued.text.includes("Asha"));
  assert.match(cued.text, /\[NAME_1\] and I have a cough/);

  const listed = redact("Rahul has a rash, Rahul is 6", { neverSend: ["Rahul"] });
  assert.equal(listed.text, "[NAME_1] has a rash, [NAME_1] is 6");
});

test("restores real values only on the device", () => {
  const map = createRedactionMap();
  const { text } = redact("call 9876543210", { map });
  assert.equal(restore(`Please call ${text.slice(5)} soon`, map), "Please call 9876543210 soon");
  assert.equal(restore("nothing to restore", map), "nothing to restore");
});

test("never reports original values in the found list", () => {
  const { found } = redact("asha@example.com 9876543210");
  for (const item of found) {
    assert.deepEqual(Object.keys(item).sort(), ["placeholder", "type"]);
  }
});

test("a full name is hidden whole even when its first name was also introduced by a cue", () => {
  const out = redact("My name is Asha and Asha Kulkarni has a headache", { neverSend: ["Asha Kulkarni"] });
  assert.doesNotMatch(out.text, /Asha|Kulkarni/);
});

test("bug review 2026-10-20: a name cue takes the name, not the symptoms after it", () => {
  assert.equal(redact("my name is Ravi having chest pain since morning").text, "my name is [NAME_1] having chest pain since morning");
  assert.equal(redact("my name is Meena with fever and rash").text, "my name is [NAME_1] with fever and rash");
  assert.equal(redact("मेरा नाम सीता है सीने में दर्द है").text, "मेरा नाम [NAME_1] है सीने में दर्द है");
  assert.equal(redact("mera naam ravi hai, pet dard").text, "mera naam [NAME_1] hai, pet dard");
  assert.doesNotMatch(redact("My name is Asha Kumar Rao and I have a cough").text, /Asha|Kumar|Rao/);
});

test("bug review 2026-10-20: readings typed with spaces reach the AI; real IDs and landlines are still hidden", () => {
  assert.equal(redact("my fasting sugars this week: 110 120 135 140").text, "my fasting sugars this week: 110 120 135 140");
  assert.equal(redact("BP readings 140 90 138 88").text, "BP readings 140 90 138 88");
  assert.equal(redact("steps 10000 12000 9000").text, "steps 10000 12000 9000");
  assert.equal(redact("readings 2026-10-19 120, 2026-10-20 130").text, "readings 2026-10-19 120, 2026-10-20 130");
  assert.match(redact("Aadhaar 1234 5678 9012").text, /\[ID_1\]/);
  assert.match(redact("ABHA 12-3456-7890-1234").text, /\[ID_1\]/);
  assert.match(redact("account 123456789012").text, /\[ID_1\]/);
  assert.match(redact("clinic 011 2345 6789").text, /\[PHONE_1\]/);
  assert.match(redact("call 080-23456789").text, /\[PHONE_1\]/);
  assert.match(redact("call 98765 43210").text, /\[PHONE_1\]/);
});
