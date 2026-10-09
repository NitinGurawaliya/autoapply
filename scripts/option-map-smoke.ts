// T53 end to end on the mock form with the test profile (the only profile allowed there): work authorization is saved as
// "Yes, I am authorized to work", which is not one of the mock's options ("Authorized" / "Need sponsorship"). A real run
// must re-word it onto "Authorized", say why, and submit without asking. The test profile's answers are restored.
// npx tsx scripts/option-map-smoke.ts   (needs `npm run dev` for the mock form)
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
  const keys = ["work_authorization", customQuestionKey("Work authorization")];
  const saved = await db.answer.findMany({ where: { userId: user.id, key: { in: keys } } });
  let appId = "";
  try {
    await db.answer.deleteMany({ where: { userId: user.id, key: { in: keys } } });
    await upsert(user.id, { key: "work_authorization", question: "Are you authorized to work?", answer: "Yes, I am authorized to work", source: "user" });
    const app = await db.application.create({ data: { userId: user.id, jobId: job.id, status: "queued", fields: [], pendingQuestions: [] } });
    appId = app.id;
    await runApplication(app.id);
    const done = await db.application.findUniqueOrThrow({ where: { id: app.id } });
    check("the run submits without asking", done.status === "submitted", `${done.status} ${done.error ?? ""} ${JSON.stringify(done.pendingQuestions).slice(0, 160)}`);
    const auth = (done.fields as Array<{ key: string; value: string; source: string; basis?: string }>).find((field) => field.key === "work_authorization");
    check("work authorization is re-worded onto the form's option, still the user's answer", auth?.value === "Authorized" && auth.source === "user", JSON.stringify(auth));
    check("the field records why", /Yes, I am authorized to work/.test(auth?.basis ?? ""), auth?.basis);
    const event = await db.applicationEvent.findFirst({ where: { applicationId: app.id, message: { contains: "to this form's options" } } });
    check("the audit log says answers were matched to the options", Boolean(event), event?.message);
  } finally {
    if (appId) await db.application.delete({ where: { id: appId } }).catch(() => undefined);
    await db.answer.deleteMany({ where: { userId: user.id, key: { in: keys } } });
    for (const row of saved) await db.answer.create({ data: { userId: row.userId, key: row.key, question: row.question, answer: row.answer, source: row.source } });
  }
  console.log(failed ? `FAIL option-map-smoke (${failed})` : "PASS option-map-smoke");
  process.exit(failed ? 1 : 0);
}

main().finally(() => db.$disconnect());
