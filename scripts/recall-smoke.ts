// T52 end to end on the mock form with the test profile (the only profile allowed there): the notice period is saved
// only under ANOTHER wording ("What is your notice period in days?"); a real run must fill the mock form's "Notice period"
// from memory (source "matched", with its basis), submit without asking, and the mock receives the value. The test
// profile's answers are restored afterwards.
// npx tsx scripts/recall-smoke.ts   (needs `npm run dev` for the mock form)
process.env.DEMO_HEADED = "0";
import { db } from "../src/lib/db";
import { customQuestionKey, upsert } from "../src/modules/answers";
import { runApplication } from "../src/modules/apply";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

async function main() {
  const user = await db.user.findUniqueOrThrow({ where: { email: "t12-check@swipeapply.local" }, include: { profile: true } });
  if (!user.profile?.isTest) throw new Error("t12-check must be a test profile");
  const job = await db.job.findFirstOrThrow({ where: { source: "mock" } });
  const otherWording = "What is your notice period in days?";
  const keys = ["notice_period", customQuestionKey("Notice period"), customQuestionKey(otherWording)];
  const saved = await db.answer.findMany({ where: { userId: user.id, key: { in: keys } } });
  let appId = "";
  try {
    await db.answer.deleteMany({ where: { userId: user.id, key: { in: keys } } });
    await upsert(user.id, { key: customQuestionKey(otherWording), question: otherWording, answer: "45", source: "user" });
    const before = await db.mockSubmission.count();
    const app = await db.application.create({ data: { userId: user.id, jobId: job.id, status: "queued", fields: [], pendingQuestions: [] } });
    appId = app.id;
    await runApplication(app.id);

    const done = await db.application.findUniqueOrThrow({ where: { id: app.id } });
    check("the run submits without asking", done.status === "submitted", `${done.status} ${done.error ?? ""} ${JSON.stringify(done.pendingQuestions).slice(0, 120)}`);
    const notice = (done.fields as Array<{ key: string; value: string; source: string; basis?: string }>).find((field) => field.key === "notice_period");
    check("'Notice period' is filled from the answer to the other wording", notice?.value === "45" && notice.source === "matched", JSON.stringify(notice));
    check("the field records why: the original question", (notice?.basis ?? "").includes(otherWording), notice?.basis);
    const event = await db.applicationEvent.findFirst({ where: { applicationId: app.id, type: "resolve", message: { contains: "from your saved answers" } } });
    check("the audit log says how many answers came from memory", Boolean(event), event?.message);
    const submission = await db.mockSubmission.findFirst({ orderBy: { createdAt: "desc" } });
    check("the mock form received the value", (await db.mockSubmission.count()) > before && JSON.stringify(submission?.payload ?? {}).includes('"45"'));
  } finally {
    if (appId) await db.application.delete({ where: { id: appId } }).catch(() => undefined);
    await db.answer.deleteMany({ where: { userId: user.id, key: { in: keys } } });
    for (const row of saved) await db.answer.create({ data: { userId: row.userId, key: row.key, question: row.question, answer: row.answer, source: row.source } });
  }
  console.log(failed ? `FAIL recall-smoke (${failed})` : "PASS recall-smoke");
  process.exit(failed ? 1 : 0);
}

main().finally(() => db.$disconnect());
