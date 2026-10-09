// T56 "fill your gaps": questions about the job's country are grouped by that country across wordings, answered once
// through /api/gaps with the country attached, and then reused by memory for another job in that country but not for
// a job elsewhere. Reads real Greenhouse jobs' public question lists (no browser, nothing submitted); uses a throwaway
// user, removed at the end. npx tsx scripts/gaps-test.ts   (needs `npm run dev`)
import { randomBytes } from "node:crypto";
import { db } from "../src/lib/db";
import { detectConcept } from "../src/modules/answers";
import type { FormField } from "../src/modules/apply";
import { scanJobs } from "../src/modules/apply/prescan";
import { jobQuestions } from "../src/modules/apply/questions";
import { answerFromMemory } from "../src/modules/apply/recall";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

async function main() {
  // US Greenhouse jobs whose forms ask a work-authorization question about "the country where the job is".
  const candidates = await db.job.findMany({ where: { source: "greenhouse", country: "US", closedAt: null }, orderBy: { postedAt: "desc" }, take: 40, include: { company: { select: { slug: true, name: true } } } });
  const picked: Array<{ id: string; question: FormField }> = [];
  for (const job of candidates) {
    const fields = (await jobQuestions(job)) ?? [];
    const auth = fields.find((field) => field.required && detectConcept(field.label) === "work_authorization" && /country|this (job|role|position)|you are applying/i.test(field.label));
    if (auth && !picked.some((p) => p.question.label === auth.label)) picked.push({ id: job.id, question: auth });
    if (picked.length === 3) break;
  }
  if (picked.length < 3) {
    console.log(`only ${picked.length} suitable US jobs found; cannot run`);
    process.exit(1);
  }

  const user = await db.user.create({ data: { email: `gaps-${Date.now()}@swipeapply.local`, name: "Gaps" } });
  const token = randomBytes(16).toString("hex");
  try {
    await db.profile.create({ data: { userId: user.id, isTest: false, resumeKey: "x", resumeText: "Engineer", fullName: "Gap Tester", email: user.email, country: "India", city: "Pune", yearsExperience: 2, currentTitle: "Engineer", skills: [], experience: [], education: [], rawJson: {} } });
    const scan = await scanJobs(user.id, picked.slice(0, 2).map((p) => p.id));
    const grouped = await db.feedGap.findMany({ where: { userId: user.id, label: { contains: "the United States" } } });
    const authGap = grouped.find((gap) => detectConcept(gap.label) === "work_authorization");
    check("the jobs' work-authorization questions become one gap for the United States", scan.scanned === 2 && authGap?.label === "Are you legally authorized to work in the United States?" && authGap.jobs === 2, `${grouped.map((g) => `${g.jobs}x ${g.label.slice(0, 60)}`).join(" | ")}`);
    check("the gap keeps its country", (authGap?.context as { country?: string } | null)?.country === "US");

    await db.session.create({ data: { sessionToken: token, userId: user.id, expires: new Date(Date.now() + 600_000) } });
    const response = await fetch("http://localhost:3000/api/gaps", { method: "POST", headers: { cookie: `authjs.session-token=${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ key: authGap?.key, answer: "Yes" }) });
    const saved = await db.answer.findFirst({ where: { userId: user.id, key: authGap?.key ?? "" } });
    check("answering it saves the answer with the country attached", response.ok && saved?.answer === "Yes" && (saved.context as { country?: string } | null)?.country === "US", `${response.status} ${JSON.stringify(saved)}`);

    const third = picked[2];
    const usJob = await db.job.findUniqueOrThrow({ where: { id: third.id }, include: { company: { select: { name: true } } } });
    const reuseUs = await answerFromMemory({ userId: user.id, job: { company: usJob.company.name, title: usJob.title, location: usJob.location, country: usJob.country }, fields: [third.question] });
    check("another US job's wording of the question reuses it", reuseUs.answers.get(third.question.label)?.answer === "Yes", `${third.question.label.slice(0, 60)} | ${reuseUs.rejected.join(" | ")}`);
    const reuseUk = await answerFromMemory({ userId: user.id, job: { company: "Monzo", title: "Engineer", location: "London, UK", country: "OTHER" }, fields: [third.question] });
    check("a UK job's question does NOT reuse it", reuseUk.answers.get(third.question.label) === undefined, reuseUk.rejected.join(" | "));
  } finally {
    await db.session.deleteMany({ where: { sessionToken: token } });
    await db.feedGap.deleteMany({ where: { userId: user.id } });
    await db.feedScan.deleteMany({ where: { userId: user.id } });
    await db.user.delete({ where: { id: user.id } });
  }
  console.log(failed ? `FAIL gaps (${failed})` : "PASS gaps");
  process.exit(failed ? 1 : 0);
}

main().finally(() => db.$disconnect());
