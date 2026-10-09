// T55 end to end on the mock form with the test profile (the only profile allowed there): with the essay permission
// set and no saved answer, the required "Why this role?" is drafted (source "ai_draft", with its basis), the run
// submits without asking, and the mock receives the draft. Without the permission, the run asks for it once.
// The test profile's answers are restored. npx tsx scripts/essay-smoke.ts   (needs `npm run dev` for the mock form)
process.env.DEMO_HEADED = "0";
import { db } from "../src/lib/db";
import { customQuestionKey } from "../src/modules/answers";
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
  const keys = ["free_text", customQuestionKey("Why this role?"), "accept_ai_essays"];
  const saved = await db.answer.findMany({ where: { userId: user.id, key: { in: keys } } });
  const apps: string[] = [];
  const run = async () => {
    const app = await db.application.create({ data: { userId: user.id, jobId: job.id, status: "queued", fields: [], pendingQuestions: [] } });
    apps.push(app.id);
    await runApplication(app.id);
    return db.application.findUniqueOrThrow({ where: { id: app.id } });
  };
  try {
    await db.answer.deleteMany({ where: { userId: user.id, key: { in: keys } } });
    const first = await run();
    const asked = (first.pendingQuestions as Array<{ key: string }>) ?? [];
    check("without permission the run asks for it once", first.status === "needs_input" && asked.some((q) => q.key === "accept_ai_essays"), `${first.status} ${JSON.stringify(asked.map((q) => q.key))}`);

    await db.answer.create({ data: { userId: user.id, key: "accept_ai_essays", question: "May SwipeApply draft essay answers?", answer: "Yes", source: "user" } });
    const before = await db.mockSubmission.count();
    const done = await run();
    check("with permission the run submits without asking", done.status === "submitted", `${done.status} ${done.error ?? ""} ${JSON.stringify(done.pendingQuestions).slice(0, 160)}`);
    const essay = (done.fields as Array<{ label: string; value: string; source: string; basis?: string }>).find((field) => field.label === "Why this role?");
    check("'Why this role?' is an AI draft with its basis", essay?.source === "ai_draft" && (essay.value?.length ?? 0) > 40 && /AI draft/.test(essay.basis ?? ""), `${essay?.source} ${essay?.value?.slice(0, 80)}`);
    const event = await db.applicationEvent.findFirst({ where: { applicationId: done.id, message: { contains: "essay answers (AI draft)" } } });
    check("the audit log records the draft", Boolean(event), event?.message);
    const submission = await db.mockSubmission.findFirst({ orderBy: { createdAt: "desc" } });
    check("the mock form received the draft", (await db.mockSubmission.count()) > before && JSON.stringify(submission?.payload ?? {}).includes((essay?.value ?? "@@").slice(0, 30)));
  } finally {
    for (const id of apps) await db.application.delete({ where: { id } }).catch(() => undefined);
    await db.answer.deleteMany({ where: { userId: user.id, key: { in: keys } } });
    for (const row of saved) await db.answer.create({ data: { userId: row.userId, key: row.key, question: row.question, answer: row.answer, source: row.source } });
  }
  console.log(failed ? `FAIL essay-smoke (${failed})` : "PASS essay-smoke");
  process.exit(failed ? 1 : 0);
}

main().finally(() => db.$disconnect());
