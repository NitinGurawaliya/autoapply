// T52: retrieve-then-verify. Offline checks of the code-side rules, then a live run (embeddings + one verify call per
// form) for a throwaway user: paraphrases are reused, look-alike traps are not, a country-specific answer is reused only
// for a job in that country. Removes its user at the end.
// npx tsx scripts/recall-test.ts
import { db } from "../src/lib/db";
import { customQuestionKey, detectConcept, grounded, sameParam, upsert } from "../src/modules/answers";
import type { FormField } from "../src/modules/apply";
import { answerFromMemory } from "../src/modules/apply/recall";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

// Offline: the rules the code enforces whatever the model says.
check("work authorization, office, worked-at and EEO questions are detected as risky", detectConcept("Are you legally authorized to work in the country where this job is located?") === "work_authorization" && detectConcept("Are you able to work from our London office three days per week?") === "office_attendance" && detectConcept("Have you ever worked for Thoughtworks before?") === "previously_employed_by" && detectConcept("What is your gender?") === "eeo");
check("residence and 'authorized to lawfully work' are risky too", detectConcept("Do you reside in the United States or Canada?") === "residence" && detectConcept("Are you authorized to lawfully work for Roku in the country to which you applied?") === "work_authorization");
check("ordinary questions are general", detectConcept("How did you hear about this job?") === null && detectConcept("What is your home Zip Code?") === null);
check("countries match across spellings", sameParam("United States", "US") && sameParam("USA", "u.s.") && !sameParam("UK", "US"));
check("a parameter must be written somewhere, not guessed", grounded("United States", ["San Francisco, CA", "US"]) && !grounded("Germany", ["London, UK", "OTHER"]) && grounded("London", ["Are you able to work from our London office?"]));
check("a country code is not found inside another word", !grounded("US", ["Business Analyst", "Austin"]));

const field = (label: string): FormField => ({ selector: `#${customQuestionKey(label)}`, label, type: "text", required: true });

async function main() {
  const user = await db.user.create({ data: { email: `recall-${Date.now()}@swipeapply.local`, name: "Recall" } });
  try {
    const save = (question: string, answer: string, context: { company: string; location: string; country: string; title: string } | null) =>
      upsert(user.id, { key: customQuestionKey(question), question, answer, source: "user", context });
    const openai = { company: "OpenAI", location: "San Francisco, CA", country: "US", title: "Engineer" };
    await save("How did you hear about this job?", "LinkedIn", openai);
    await save("Are you able to work from our US office three days per week?", "No", openai);
    await save("Are you legally authorized to work in the country where this job is located?", "Yes", { company: "Stripe", location: "New York, NY", country: "US", title: "Engineer" });
    await save("Have you ever worked at MongoDB before?", "No", { company: "MongoDB", location: "New York, NY", country: "US", title: "Engineer" });
    await save("What are your salary expectations?", "30 LPA", null);
    await save("What is your home Zip Code?", "160062", null);

    const london = { company: "Monzo", title: "Engineer", location: "London, UK", country: "OTHER" };
    const asked = {
      heard: "How did you learn about this opportunity?",
      office: "Are you able to work from our London office three days per week?",
      auth: "Are you legally authorized to work in the country in which this role is located?",
      worked: "Have you ever worked for Thoughtworks before?",
      pay: "What is your expected compensation for this role?",
      zip: "What is the zip code of your primary residence?",
    };
    const uk = await answerFromMemory({ userId: user.id, job: london, fields: Object.values(asked).map(field) });
    const got = (label: string) => uk.answers.get(label)?.answer;
    check("a paraphrase of 'how did you hear' reuses the saved answer", got(asked.heard) === "LinkedIn", uk.answers.get(asked.heard)?.basis);
    check("a paraphrase of the zip code question reuses it", got(asked.zip) === "160062");
    check("expected compensation reuses the user's own salary answer", got(asked.pay) === "30 LPA");
    check("the London office question does NOT reuse the US office answer", got(asked.office) === undefined);
    check("work authorization for a UK job does NOT reuse an answer given for a US job", got(asked.auth) === undefined);
    check("'worked for Thoughtworks' does NOT reuse 'worked at MongoDB'", got(asked.worked) === undefined);
    console.log(`     refused: ${uk.rejected.join(" | ") || "(none: the model declined them itself)"}`);

    // Cases the replay showed going wrong: related but different facts, and answers of the wrong shape.
    await save("End date month", "August", null);
    await save("Are you currently enrolled in a university?", "Yes", null);
    await save("Which term(s) are you available to intern?", "Winter/Spring (January - May 2027)", null);
    await save("Do you currently live in India?", "Yes", null);
    const related = {
      year: "End date year",
      degree: "What degree are you currently pursuing?",
      available: "Are you available for a 12-week full-time internship?",
      reside: "Do you reside in the United States or Canada?",
    };
    const near = await answerFromMemory({ userId: user.id, job: london, fields: Object.values(related).map(field) });
    check("'End date year' does NOT reuse the end month", near.answers.get(related.year) === undefined, near.answers.get(related.year)?.answer);
    check("'What degree' does NOT take a yes/no answer", near.answers.get(related.degree) === undefined, near.answers.get(related.degree)?.answer);
    check("'Available for a 12-week internship?' does NOT take a list of terms", near.answers.get(related.available) === undefined, near.answers.get(related.available)?.answer);
    check("'Reside in the US or Canada?' does NOT reuse 'live in India'", near.answers.get(related.reside) === undefined, near.answers.get(related.reside)?.answer);

    const us = await answerFromMemory({ userId: user.id, job: { company: "Airbnb", title: "Engineer", location: "San Francisco, CA", country: "US" }, fields: [field(asked.auth)] });
    check("work authorization for a US job reuses the answer given for another US job", us.answers.get(asked.auth)?.answer === "Yes", us.rejected.join(" | "));
  } finally {
    await db.user.delete({ where: { id: user.id } });
  }
  console.log(failed ? `FAIL recall (${failed})` : "PASS recall");
  process.exit(failed ? 1 : 0);
}

main().finally(() => db.$disconnect());
