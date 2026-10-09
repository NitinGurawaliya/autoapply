// T56: ask before the run, fill in one go. Offline: Greenhouse API questions become form fields. End to end on the
// mock form with the test profile (the only profile allowed there):
// - with the notice period unknown, the run asks BEFORE opening the form (no browser: no "inspect" event);
// - a second application waiting on the same question is released by one answer through the real answers route;
// - after answering, the run fills the form straight through, with no pause;
// - the feed pre-scan reports the gap, and full coverage once it is answered.
// The test profile's answers are restored. npx tsx scripts/precheck-smoke.ts   (needs `npm run dev`)
process.env.DEMO_HEADED = "0";
import { randomBytes } from "node:crypto";
import { db } from "../src/lib/db";
import { customQuestionKey } from "../src/modules/answers";
import { runApplication } from "../src/modules/apply";
import { scanJobs } from "../src/modules/apply/prescan";
import { fromGreenhouse } from "../src/modules/apply/questions";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

const SAMPLE = {
  questions: [
    { label: "First Name", required: true, fields: [{ name: "first_name", type: "input_text", values: [] }] },
    { label: "Resume/CV", required: true, fields: [{ name: "resume", type: "input_file", values: [] }, { name: "resume_text", type: "textarea", values: [] }] },
    { label: "Are you authorized to work in the country you are applying to?", required: true, fields: [{ name: "question_1", type: "multi_value_single_select", values: [{ label: "Yes", value: 1 }, { label: "No", value: 0 }] }] },
    { label: "Personal Information Policy", required: true, fields: [{ name: "question_2[]", type: "multi_value_multi_select", values: [{ label: "I acknowledge", value: 1 }] }] },
    { label: "LinkedIn Profile", required: false, fields: [{ name: "question_3", type: "input_text", values: [] }] },
  ],
  location_questions: [{ label: "Location", required: true, fields: [{ name: "latitude", type: "input_hidden" }, { name: "location", type: "input_text" }] }],
};

async function main() {
  const fields = fromGreenhouse(SAMPLE);
  const by = (label: string) => fields.find((field) => field.label === label);
  check("API questions become fields with the form's labels", fields.length === 6 && by("First Name")?.selector === "#first_name" && by("Resume/CV")?.type === "file");
  check("a single select keeps its options; a one-box multi select is a checkbox group", by("Are you authorized to work in the country you are applying to?")?.options?.join("|") === "Yes|No" && by("Personal Information Policy")?.type === "checkbox-group");
  check("required flags and the visible location box come through", by("LinkedIn Profile")?.required === false && by("Location")?.type === "combobox");

  const user = await db.user.findUniqueOrThrow({ where: { email: "t12-check@swipeapply.local" }, include: { profile: true } });
  if (!user.profile?.isTest) throw new Error("t12-check must be a test profile");
  const job = await db.job.findFirstOrThrow({ where: { source: "mock" } });
  const keys = ["notice_period", customQuestionKey("Notice period")];
  const saved = await db.answer.findMany({ where: { userId: user.id, key: { in: keys } } });
  const apps: string[] = [];
  const sessionToken = randomBytes(16).toString("hex");
  try {
    await db.answer.deleteMany({ where: { userId: user.id, key: { in: keys } } });
    const make = async () => {
      const app = await db.application.create({ data: { userId: user.id, jobId: job.id, status: "queued", fields: [], pendingQuestions: [] } });
      apps.push(app.id);
      return app.id;
    };
    const a = await make();
    const b = await make();
    await runApplication(a);
    await runApplication(b);
    const [first, second] = await Promise.all([db.application.findUniqueOrThrow({ where: { id: a } }), db.application.findUniqueOrThrow({ where: { id: b } })]);
    const asked = (first.pendingQuestions as Array<{ key: string; label: string }>) ?? [];
    check("with the notice period unknown, the run asks", first.status === "needs_input" && asked.some((q) => q.label === "Notice period"), `${first.status} ${JSON.stringify(asked.map((q) => q.label))}`);
    const events = await db.applicationEvent.findMany({ where: { applicationId: a }, select: { type: true, message: true } });
    check("it asked before opening the form: no browser, no inspect event", events.some((e) => e.type === "ask_user" && /before opening the form/.test(e.message)) && !events.some((e) => e.type === "inspect"), events.map((e) => e.type).join(","));

    const scan = await scanJobs(user.id, [job.id]);
    const gap = await db.feedGap.findFirst({ where: { userId: user.id, label: "Notice period" } });
    check("the pre-scan reports the missing fact and the job as not covered", scan.scanned === 1 && scan.covered === 0 && Boolean(gap), JSON.stringify(scan));

    // Answer once, for application A, through the real route.
    await db.session.create({ data: { sessionToken, userId: user.id, expires: new Date(Date.now() + 600_000) } });
    const noticeKey = asked.find((q) => q.label === "Notice period")!.key;
    const response = await fetch(`http://localhost:3000/api/applications/${a}/answers`, {
      method: "POST",
      headers: { cookie: `authjs.session-token=${sessionToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ answers: [{ key: noticeKey, question: "Notice period", answer: "30" }] }),
    });
    const body = (await response.json()) as { released?: number };
    const bAfter = await db.application.findUniqueOrThrow({ where: { id: b } });
    check("one answer releases the other application waiting on the same question", response.ok && body.released === 1 && bAfter.status === "queued" && second.status === "needs_input", `${response.status} ${JSON.stringify(body)} ${bAfter.status}`);

    // The route queued A. If a worker is running it takes A; otherwise run it here (never both at once).
    const settle = async () => {
      for (let i = 0; i < 90; i += 1) {
        const row = await db.application.findUniqueOrThrow({ where: { id: a } });
        if (!["queued", "inspecting", "filling"].includes(row.status)) return row;
        if (i === 5 && row.status === "queued") await runApplication(a);
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      return db.application.findUniqueOrThrow({ where: { id: a } });
    };
    const done = await settle();
    const askedAgain = await db.applicationEvent.count({ where: { applicationId: a, type: "ask_user" } });
    check("after answering, the run fills the form straight through", done.status === "submitted" && askedAgain === 1, `${done.status} ${done.error ?? ""} asks=${askedAgain}`);
    if (done.status !== "submitted") for (const e of await db.applicationEvent.findMany({ where: { applicationId: a }, orderBy: { createdAt: "asc" } })) console.log(`     ${e.type} ${e.message.slice(0, 140)}`);

    const rescan = await scanJobs(user.id, [job.id]);
    check("after answering, the pre-scan covers the job", rescan.covered === rescan.scanned && !(await db.feedGap.findFirst({ where: { userId: user.id, label: "Notice period" } })), JSON.stringify(rescan));
  } finally {
    await db.session.deleteMany({ where: { sessionToken } });
    for (const id of apps) await db.application.delete({ where: { id } }).catch(() => undefined);
    await db.answer.deleteMany({ where: { userId: user.id, key: { in: keys } } });
    for (const row of saved) await db.answer.create({ data: { userId: row.userId, key: row.key, question: row.question, answer: row.answer, source: row.source } });
    await db.feedGap.deleteMany({ where: { userId: user.id } });
    await db.feedScan.deleteMany({ where: { userId: user.id } });
  }
  console.log(failed ? `FAIL precheck-smoke (${failed})` : "PASS precheck-smoke");
  process.exit(failed ? 1 : 0);
}

main().finally(() => db.$disconnect());
