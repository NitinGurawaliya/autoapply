// T56 "fill your gaps", as changed on 10 Oct (abroad answers): a job's "authorized to work in this country?" outside
// the candidate's home country is not its own gap any more. Every such job feeds ONE standing question ("Do you need
// visa sponsorship to work in any country other than India?"), answered once through /api/gaps; with "Yes" the
// work-authorization question is worked out ("No") for any job abroad, with "No" it is still asked. Reads real
// Greenhouse jobs' public question lists (no browser, nothing submitted); uses a throwaway user, removed at the end.
// npx tsx scripts/gaps-test.ts   (needs `npm run dev`)
import { randomBytes } from "node:crypto";
import { db } from "../src/lib/db";
import { detectConcept } from "../src/modules/answers";
import type { FormField } from "../src/modules/apply";
import { scanJobs } from "../src/modules/apply/prescan";
import { jobQuestions } from "../src/modules/apply/questions";
import { SPONSORSHIP_ABROAD_KEY } from "../src/modules/apply/sponsorship";
import { yesNoOf } from "../src/modules/apply/derive";
import { resolveValues } from "../src/modules/apply/valueResolver";

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
    const gaps = await db.feedGap.findMany({ where: { userId: user.id } });
    const standing = gaps.find((gap) => gap.key === SPONSORSHIP_ABROAD_KEY);
    check("the jobs' work-authorization questions become one standing gap: sponsorship outside India", scan.scanned === 2 && standing?.jobs === 2 && /other than India/.test(standing.label), `${standing?.jobs}x ${standing?.label ?? "none"}`);
    const perCountry = gaps.filter((gap) => detectConcept(gap.label) === "work_authorization");
    check("no per-country work-authorization gap is made", perCountry.length === 0, perCountry.map((gap) => gap.label.slice(0, 60)).join(" | "));

    await db.session.create({ data: { sessionToken: token, userId: user.id, expires: new Date(Date.now() + 600_000) } });
    const response = await fetch("http://localhost:3000/api/gaps", { method: "POST", headers: { cookie: `authjs.session-token=${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ key: SPONSORSHIP_ABROAD_KEY, answer: "Yes" }) });
    const saved = await db.answer.findFirst({ where: { userId: user.id, key: SPONSORSHIP_ABROAD_KEY } });
    check("answering it saves the standing answer", response.ok && saved?.answer === "Yes", `${response.status} ${saved?.answer}`);

    // A third US job's own wording, resolved with the saved answers (no browser).
    const third = picked[2];
    const usJob = await db.job.findUniqueOrThrow({ where: { id: third.id }, include: { company: { select: { name: true } } } });
    const profile = await db.profile.findUniqueOrThrow({ where: { userId: user.id } });
    const bank = await db.answer.findMany({ where: { userId: user.id }, select: { key: true, answer: true, source: true, context: true } });
    const facts = { ...profile, resumeKey: profile.resumeKey ?? "x" } as unknown as Parameters<typeof resolveValues>[1];
    const withYes = resolveValues([{ field: third.question, key: null }], facts, bank, undefined, undefined, { company: usJob.company.name, country: usJob.country });
    check("with \"I need sponsorship\", another US job's question is worked out as no (in the form's own wording)", yesNoOf(withYes.values[0]?.value ?? "") === "no" && withYes.values[0]?.source === "derived" && withYes.pending.length === 0, `${third.question.label.slice(0, 60)} -> ${withYes.values[0]?.value} (${withYes.values[0]?.source})`);
    const withNo = resolveValues([{ field: third.question, key: null }], facts, [{ key: SPONSORSHIP_ABROAD_KEY, answer: "No", source: "user" }], undefined, undefined, { company: usJob.company.name, country: usJob.country });
    check("with \"no sponsorship needed\", it is still asked (that does not prove which countries)", withNo.values.length === 0 && withNo.pending.length === 1, withNo.pending.map((q) => q.label.slice(0, 60)).join(" | "));
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
