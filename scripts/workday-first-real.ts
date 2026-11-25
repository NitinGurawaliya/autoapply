// Phase V, V4: the first real Workday application (owner, 23 Nov: "Yes, send to Cotality" for Nitin). A right swipe
// through swipeRight (every governance rule), then that one application run here by the real runner, in the stealthy
// Chrome, through Submit. Workday is allowed for this process only (it is not in APPLY_BOARDS until this passes), and
// the application is not put on the shared queue, so a worker on older code cannot take it. A question the run asks is
// answered with --answer (the user's own answer, given in chat), saved as theirs, as the needs-you card would.
//   npx tsx scripts/workday-first-real.ts --email <email> --url <workday posting url> [--answer "<words>=<answer>"]
import type { Prisma } from "@prisma/client";
import { db } from "../src/lib/db";
import { APPLY_BOARDS } from "../src/modules/jobs/pool";
import { upsert } from "../src/modules/answers";
import { swipeRight } from "../src/modules/apply/lifecycle";
import { runApplication } from "../src/modules/apply/runner";

function arg(name: string) {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

async function report(applicationId: string) {
  const app = await db.application.findUnique({ where: { id: applicationId }, select: { status: true, error: true, pendingQuestions: true } });
  const events = await db.applicationEvent.findMany({ where: { applicationId }, orderBy: { createdAt: "asc" }, select: { type: true, message: true } });
  for (const event of events.filter((e) => e.type !== "fill")) console.log(`  ${event.type}: ${(event.message ?? "").slice(0, 160)}`);
  console.log(`STATUS ${applicationId}: ${app?.status} ${app?.error ?? ""}`);
  return app;
}

async function main() {
  const email = arg("--email");
  const url = arg("--url");
  if (!email || !url) throw new Error("usage: --email <email> --url <posting url> [--answer \"<question words>=<answer>\"]");
  const user = await db.user.findUnique({ where: { email }, select: { id: true } });
  const job = await db.job.findFirst({ where: { applyUrl: url, source: "workday" }, select: { id: true, title: true } });
  if (!user || !job) throw new Error("user or job not found");
  (APPLY_BOARDS as string[]).push("workday");

  // Already swiped, and blocked only because a worker on older code had no Workday (board_not_supported, 23 Nov): the
  // same application runs again here; the runner checks every rule again before it opens anything.
  const existing = await db.application.findFirst({ where: { userId: user.id, jobId: job.id }, select: { id: true, status: true, error: true } });
  let swiped: Awaited<ReturnType<typeof swipeRight>>;
  if (existing && existing.status === "blocked" && existing.error === "board_not_supported") {
    await db.application.update({ where: { id: existing.id }, data: { status: "queued", error: null } });
    swiped = { ok: true, applicationId: existing.id };
  } else swiped = await swipeRight(user.id, job.id, async () => "local-run");
  console.log(`swipe: ${JSON.stringify(swiped)}`);
  if (!swiped.ok) return;
  await runApplication(swiped.applicationId);
  let app = await report(swiped.applicationId);

  const answer = arg("--answer");
  for (let round = 0; app?.status === "needs_input" && answer && round < 2; round += 1) {
    const [words, value] = [answer.slice(0, answer.indexOf("=")), answer.slice(answer.indexOf("=") + 1)];
    const pending = (app.pendingQuestions as Array<{ key: string; label: string }> | null) ?? [];
    const question = pending.find((item) => item.label.toLowerCase().includes(words.toLowerCase()));
    if (!question || pending.length !== 1) {
      console.log(`asked something else: ${pending.map((item) => item.label.slice(0, 80)).join(" | ")}`);
      return;
    }
    await upsert(user.id, { key: question.key, question: question.label, answer: value, source: "user" });
    await db.application.update({ where: { id: swiped.applicationId }, data: { status: "queued", pendingQuestions: [] as Prisma.InputJsonValue, error: null } });
    console.log(`\nsaved the user's answer to "${question.label.slice(0, 70)}": ${value}; running again`);
    await runApplication(swiped.applicationId);
    app = await report(swiped.applicationId);
  }
}
main().finally(() => db.$disconnect());
