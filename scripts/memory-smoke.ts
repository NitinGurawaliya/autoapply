// T51: the answer memory. Saves answers for a throwaway user, then recalls new wordings: a true paraphrase comes back
// first, a changed wording is re-embedded, job context is kept, and a look-alike trap is ALSO returned (which is why
// recall only proposes candidates and the verify step decides). Removes its user at the end.
// npx tsx scripts/memory-smoke.ts
import { db } from "../src/lib/db";
import { customQuestionKey, recall, upsert } from "../src/modules/answers";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

async function main() {
  const user = await db.user.create({ data: { email: `memory-${Date.now()}@swipeapply.local`, name: "Memory" } });
  try {
    const usOffice = "Are you able to work from our US office three days per week?";
    const save = (question: string, answer: string, context?: { company: string; country: string }) =>
      upsert(user.id, { key: customQuestionKey(question), question, answer, source: "user", context });
    await save("How did you hear about this job?", "LinkedIn");
    await save("What is your home Zip Code?", "160062");
    await save(usOffice, "No", { company: "OpenAI", country: "US" });
    await save("Have you ever worked at MongoDB before?", "No", { company: "MongoDB", country: "US" });

    const asked = ["How did you learn about this opportunity?", "What is the zip code of your primary residence?", "Are you able to work from our London office three days per week?"];
    const found = await recall(user.id, asked);
    const top = (label: string) => found.get(label)?.[0];
    check("a paraphrase of 'how did you hear' recalls it first", top(asked[0])?.question === "How did you hear about this job?", `${top(asked[0])?.question} ${top(asked[0])?.score.toFixed(3)}`);
    check("a paraphrase of the zip code question recalls it first", top(asked[1])?.question === "What is your home Zip Code?", `${top(asked[1])?.question} ${top(asked[1])?.score.toFixed(3)}`);
    check("the London office question also recalls the US office answer (a trap only verify can catch)", top(asked[2])?.question === usOffice, `${top(asked[2])?.score.toFixed(3)}`);
    check("the job context comes back with the candidate", top(asked[2])?.context?.country === "US" && top(asked[2])?.context?.company === "OpenAI");
    check("every candidate scores at least the cut-off", [...found.values()].flat().every((c) => c.score >= 0.54));

    // A changed wording is re-embedded before the next recall.
    await save("How did you hear about this job?", "LinkedIn");
    await db.answer.update({ where: { userId_key: { userId: user.id, key: customQuestionKey("How did you hear about this job?") } }, data: { question: "Which city do you live in?" } });
    const again = await recall(user.id, ["Where do you currently live?"]);
    check("a changed wording is re-embedded and found by its new meaning", again.get("Where do you currently live?")?.[0]?.question === "Which city do you live in?");
  } finally {
    await db.user.delete({ where: { id: user.id } });
  }
  console.log(failed ? `FAIL memory (${failed})` : "PASS memory");
  process.exit(failed ? 1 : 0);
}

main().finally(() => db.$disconnect());
