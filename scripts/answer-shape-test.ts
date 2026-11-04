// A saved answer that does not have the shape of the standard key it sits under never reaches a form, and is saved under
// its own question instead (4 Nov: a work-status sentence under `country` stopped four Greenhouse forms).
// npx tsx scripts/answer-shape-test.ts
import { db } from "../src/lib/db";
import { deleteAccount } from "../src/modules/account";
import { customQuestionKey, fitsKey, upsert } from "../src/modules/answers";
import { resolveValues } from "../src/modules/apply/valueResolver";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail && !ok ? ` (${detail})` : ""}`);
}

const SENTENCE = "I am a citizen / permanent resident of the country where I plan to live & work from.";

async function main() {
  check("a country name fits country", fitsKey("country", "India") && fitsKey("country", "United States of America"));
  check("a work-status sentence does not fit country", !fitsKey("country", SENTENCE));
  check("Yes / No is not a country or city", !fitsKey("country", "Yes") && !fitsKey("city", "No"));
  check("a city with its state fits city", fitsKey("city", "Bengaluru, Karnataka"));
  check("an email needs an @", fitsKey("email", "a@b.co") && !fitsKey("email", "my email"));
  check("a phone needs digits", fitsKey("phone", "+91 98765 43210") && !fitsKey("phone", "call me"));
  check("other keys take anything", fitsKey("notice_period", "Immediate"));

  // Reading: the sentence under `country` is passed over; the field is asked (and so guessed), not filled with it.
  const profile = { fullName: "A B", email: "a@example.test", phone: null, city: null, country: null, linkedin: null, github: null, portfolio: null, yearsExperience: 1, currentTitle: null, currentCompany: null, resumeKey: "r" };
  const country = { selector: '[id="country"]', label: "Country", type: "combobox", required: true };
  const bad = resolveValues([{ field: country, key: "country" }], profile, [{ key: "country", answer: SENTENCE, source: "user" }]);
  check("a sentence saved under country is not typed into a Country box", bad.values.length === 0 && bad.pending.length === 1, JSON.stringify(bad.values));
  const good = resolveValues([{ field: country, key: "country" }], profile, [{ key: "country", answer: "India", source: "user" }]);
  check("a country saved under country is used", good.values[0]?.value === "India");

  // Saving: the sentence lands under its own question's key, not under `country`.
  const user = await db.user.create({ data: { email: `shape-${Date.now()}@swipeapply.local` } });
  try {
    const question = "If you are eligible, please select the status that allows you to work in the country";
    await upsert(user.id, { key: "country", question, answer: SENTENCE, source: "user" });
    const underCountry = await db.answer.findUnique({ where: { userId_key: { userId: user.id, key: "country" } } });
    const underOwn = await db.answer.findUnique({ where: { userId_key: { userId: user.id, key: customQuestionKey(question) } } });
    check("a misfit answer is saved under its own question, not under country", !underCountry && underOwn?.answer === SENTENCE);
    await upsert(user.id, { key: "country", question: "Country", answer: "India", source: "user" });
    check("a real country is saved under country", (await db.answer.findUnique({ where: { userId_key: { userId: user.id, key: "country" } } }))?.answer === "India");
  } finally {
    await deleteAccount(user.id).catch(() => undefined);
    await db.$disconnect();
  }
  console.log(failed === 0 ? "PASS answer-shape" : `FAIL answer-shape (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}
main();
