// Ad hoc (21 Nov, M13b, the owner's yes): one real Zoho Recruit application whose CAPTCHA the worker reads, run in this
// process on this checkout's code while the live worker (another checkout, older code) keeps serving the queue.
// Makes the owner's right swipe through lifecycle.ts swipeRight (every swipe rule) and runs the application here instead
// of queueing it. A CAPTCHA Zoho refuses makes the runner
// queue a rerun 3 s later (runner.ts, CaptchaRejectedError); this script cancels that queue job before the live worker can
// take it and runs it here instead, so every read is this code's. Refuses to run twice for one user and job.
//   npx tsx scripts/_zoho-real-run.ts --user <end of user id> --job <end of the Zoho job id in the URL> --go
import { db } from "../src/lib/db";
import { APPLY_QUEUE, getBoss } from "../src/lib/queue";
import { swipeRight } from "../src/modules/apply/lifecycle";
import { runApplication } from "../src/modules/apply/runner";

const arg = (name: string) => {
  const index = process.argv.indexOf(name);
  return index > 0 ? process.argv[index + 1] : undefined;
};
// Event lines are shown without anything that looks like an email or a phone number.
const safe = (text: string) => text.replace(/\S+@\S+/g, "<email>").replace(/\+?\d[\d\s-]{8,}\d/g, "<number>").slice(0, 200);

async function main() {
  const userEnd = arg("--user");
  const jobEnd = arg("--job");
  if (!userEnd || !jobEnd || !process.argv.includes("--go")) throw new Error("pass --user, --job and --go");
  const profile = await db.profile.findFirstOrThrow({ where: { isTest: false, userId: { endsWith: userEnd } }, select: { userId: true } });
  const jobs = await db.job.findMany({ where: { source: "zohorecruit", closedAt: null, applyUrl: { contains: `/${jobEnd}/` } }, select: { id: true, title: true, applyUrl: true } });
  if (jobs.length !== 1) throw new Error(`--job ${jobEnd} matched ${jobs.length} open Zoho jobs`);
  const job = jobs[0];
  const existing = await db.application.findFirst({ where: { userId: profile.userId, jobId: job.id } });
  if (existing) {
    // Only this script's own first try, blocked before any browser opened while Zoho was out of APPLY_BOARDS (21 Nov),
    // is taken away so the swipe can be made again; anything else stops here.
    const events = await db.applicationEvent.findMany({ where: { applicationId: existing.id }, select: { type: true } });
    const firstTry = existing.status === "blocked" && existing.error === "board_not_supported" && events.every((event) => ["block", "rule_check"].includes(event.type));
    if (!firstTry) throw new Error(`an application already exists for this user and job (${existing.id}, ${existing.status}); not running again`);
    await db.applicationEvent.deleteMany({ where: { applicationId: existing.id } });
    await db.application.delete({ where: { id: existing.id } });
    await db.swipe.deleteMany({ where: { userId: profile.userId, jobId: job.id } });
    console.log(`removed the first try ${existing.id} (blocked: board_not_supported, nothing sent)`);
  }

  // The product's own right swipe (lifecycle.ts swipeRight: the board list, the in-flight cap and the swipe_right rule
  // check), with the queue step replaced so the run happens here, on this code.
  const swiped = await swipeRight(profile.userId, job.id, async () => "local");
  if (!swiped.ok) throw new Error(`the swipe was refused: ${swiped.reason}${"rule" in swiped && swiped.rule ? ` (${swiped.rule})` : ""}`);
  const app = { id: swiped.applicationId };
  console.log(`application ${app.id} for ${job.title} (${job.applyUrl})`);

  const boss = await getBoss();
  for (let run = 1; run <= 5; run += 1) {
    console.log(`--- run ${run} at ${new Date().toISOString()}`);
    await runApplication(app.id);
    const now = await db.application.findUniqueOrThrow({ where: { id: app.id }, select: { status: true, error: true } });
    if (now.status !== "queued") break;
    // The runner queued a rerun (a refused CAPTCHA): taken back from the queue and run here.
    const queued = await db.$queryRaw<Array<{ id: string; state: string }>>`
      SELECT id::text, state::text FROM pgboss.job WHERE name = ${APPLY_QUEUE} AND data->>'applicationId' = ${app.id} AND state IN ('created', 'retry', 'active')`;
    const active = queued.filter((row) => row.state === "active");
    if (active.length > 0) {
      console.log(`the live worker already took the rerun (${active.map((row) => row.id).join(", ")}); stopping here`);
      break;
    }
    if (queued.length > 0) await boss.cancel(APPLY_QUEUE, queued.map((row) => row.id));
    console.log(`rerun taken back from the queue (${queued.length} job${queued.length === 1 ? "" : "s"})`);
  }

  const final = await db.application.findUniqueOrThrow({ where: { id: app.id }, select: { status: true, error: true, submittedAt: true } });
  const events = await db.applicationEvent.findMany({ where: { applicationId: app.id }, orderBy: { createdAt: "asc" }, select: { type: true, message: true, createdAt: true } });
  for (const event of events) console.log(`${event.createdAt.toISOString().slice(11, 19)} ${event.type}: ${safe(event.message)}`);
  console.log(`FINAL ${final.status}${final.submittedAt ? ` at ${final.submittedAt.toISOString()}` : ""}${final.error ? ` | ${safe(final.error)}` : ""}`);
  await boss.stop({ graceful: false }).catch(() => undefined);
  await db.$disconnect();
  process.exit(0);
}

main().catch(async (error) => {
  console.error("ERROR", error instanceof Error ? error.message : error);
  await db.$disconnect().catch(() => undefined);
  process.exit(1);
});
