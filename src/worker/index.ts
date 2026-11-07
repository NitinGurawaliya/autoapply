import { hostname } from "node:os";
import { db } from "@/lib/db";
import { getBoss, HANDOFF_QUEUE, INGEST_SOURCE_QUEUE, PERSON_QUEUE, SOURCE_CONNECT_QUEUE, SOURCE_INGEST_TICK, UNPROTECTED_QUEUE } from "@/lib/queue";
import { autoSubmitAshby, canShowWindow } from "@/modules/apply/browser";
import { handleApply } from "./handlers/apply";
import { handleDiscover } from "./handlers/discover";
import { handleIngest } from "./handlers/ingest";
import { handlePrescan } from "./handlers/prescan";
import { handleSourceConnect } from "./handlers/sourceConnect";
import { handleSourceIngest, handleSourceIngestTick } from "./handlers/sourceIngest";
import { expirePersonHandoffs, housekeeping, reapStaleRuns } from "./reaper";
import { registerSchedules } from "./schedule";
import { claimWorkerLock } from "./single";

// `--only=sources` (or WORKER_ONLY=sources): a worker for the user's own job-site accounts only (Naukri sign-in and job
// runs, docs/naukri/TDD.md 4.2), beside a normal worker or with none: it takes no applications, schedules or reaping,
// so trying Naukri on a laptop never picks up real applications from the shared queues.
const ONLY_SOURCES = process.argv.includes("--only=sources") || process.env.WORKER_ONLY === "sources";

async function sourcesOnly() {
  claimWorkerLock();
  if (!canShowWindow()) throw new Error("--only=sources needs a screen: the sign-in and the job runs open a visible Chrome window");
  const boss = await getBoss();
  await boss.work(SOURCE_CONNECT_QUEUE, { localConcurrency: 2 }, handleSourceConnect);
  await boss.work(INGEST_SOURCE_QUEUE, { localConcurrency: 1 }, handleSourceIngest);
  console.log(`worker (sources only) listening for ${SOURCE_CONNECT_QUEUE} and ${INGEST_SOURCE_QUEUE}; no applications, schedules or reaping`);
  let stopping = false;
  const stop = (signal: string) => {
    if (stopping) process.exit(1);
    stopping = true;
    console.log(`worker: ${signal}: finishing the run in progress (signal again to stop now)`);
    void boss.stop({ graceful: true, timeout: 12 * 60 * 1000 }).finally(() => process.exit(0));
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));
  // The web app offers Connect only while a worker with a screen beats (modules/sources screenWorkerAlive).
  const host = `${process.env.WORKER_NAME?.trim() || hostname()}:sources`;
  const startedAt = new Date();
  const beat = async () => {
    await db.workerBeat.upsert({ where: { id: host }, create: { id: host, beatAt: new Date(), startedAt, hasScreen: true }, update: { beatAt: new Date(), startedAt, hasScreen: true } }).catch(() => undefined);
  };
  void beat();
  setInterval(() => void beat(), 60_000);
}

async function main() {
  if (ONLY_SOURCES) return sourcesOnly();
  claimWorkerLock();
  const boss = await getBoss();
  // Runs share one Chromium, each in its own context (modules/apply/browser.ts), so concurrency is bounded by RAM
  // (a context is a fraction of a browser) and by how many simultaneous submissions from one IP the ATS tolerates.
  // A run waiting on a security code holds one slot for up to 10 minutes.
  const concurrency = Math.min(Math.max(Number(process.env.APPLY_CONCURRENCY) || 3, 1), 24);
  await boss.work("apply", { localConcurrency: concurrency }, handleApply);
  // Ashby applications by the company's spam protection (lib/queue.ts queueFor). "none": a Docker worker (Linux, no display)
  // with ASHBY_AUTO_SUBMIT=1 presses Submit itself, as does a worker with a screen. Low, medium, high or unread: only a
  // worker with a screen, in a visible Chrome window, since a headless Submit there was challenged every time.
  const unprotected = canShowWindow() || autoSubmitAshby();
  if (unprotected) await boss.work(UNPROTECTED_QUEUE, { localConcurrency: concurrency }, handleApply);
  const handoff = canShowWindow();
  if (handoff) await boss.work(HANDOFF_QUEUE, { localConcurrency: concurrency }, handleApply);
  // The applications Ashby asked a person for: a window a person can see, so a screen is needed whatever the settings.
  if (canShowWindow()) await boss.work(PERSON_QUEUE, { localConcurrency: concurrency }, handleApply);
  // Signing in to a user's own job-site account (Naukri): a window the person sees, so a screen is needed (docs/naukri/TDD.md 4.2).
  if (canShowWindow()) await boss.work(SOURCE_CONNECT_QUEUE, { localConcurrency: 2 }, handleSourceConnect);
  // A user's run on their signed-in site, in their window: one at a time per worker (docs/naukri/TDD.md 4.2).
  if (canShowWindow()) await boss.work(INGEST_SOURCE_QUEUE, { localConcurrency: 1 }, handleSourceIngest);
  await boss.work(SOURCE_INGEST_TICK, handleSourceIngestTick);
  await boss.work("ingest", handleIngest);
  await boss.work("prescan", handlePrescan);
  // The daily run hands each board its own job; this takes them one at a time (handlers/discover.ts).
  await boss.work("discover", handleDiscover);
  const auto = autoSubmitAshby() ? ", auto submit" : "";
  console.log(`worker listening for apply (x${concurrency})${unprotected ? `, ${UNPROTECTED_QUEUE} (x${concurrency}${auto})` : ""}${handoff ? `, ${HANDOFF_QUEUE} (x${concurrency}${auto}), ${PERSON_QUEUE}, ${SOURCE_CONNECT_QUEUE}, ${INGEST_SOURCE_QUEUE}` : ", no screen: no protected Ashby, no job-site sign-in"} and ingest`);

  // Graceful stop (Ctrl+C, `docker stop -t 960`): take no new jobs and let the runs in progress finish, up to a handoff's
  // 15-minute wait, so a restart never cuts off a run after its Submit (21 Oct: a restart seconds after Rubrik's Submit
  // left it "check your email"). A second signal stops at once; the reaper then handles what was cut off.
  let stopping = false;
  const stop = (signal: string) => {
    if (stopping) process.exit(1);
    stopping = true;
    console.log(`worker: ${signal}: finishing the runs in progress, taking no new ones (signal again to stop now)`);
    void boss.stop({ graceful: true, timeout: 16 * 60 * 1000 }).finally(() => process.exit(0));
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));
  const ingest = await registerSchedules(boss);
  console.log(`ingest scheduled: "${ingest.cron}" ${ingest.timezone}, last ${ingest.days} days; discovery "${ingest.discoverCron}"; signed-in sites "${ingest.sourceCron}"`);

  // Heartbeat for /api/health: a worker that has not beaten for a few minutes is down.
  const host = process.env.WORKER_NAME?.trim() || hostname();
  const startedAt = new Date();
  const beat = async () => {
    await db.workerBeat.upsert({ where: { id: host }, create: { id: host, beatAt: new Date(), startedAt, hasScreen: canShowWindow() }, update: { beatAt: new Date(), startedAt, hasScreen: canShowWindow() } }).catch(() => undefined);
  };
  void beat();
  setInterval(() => void beat(), 60_000);

  // Runs whose worker died stay "active" forever otherwise. Every worker checks; the reaper is idempotent.
  const reap = async () => {
    try {
      const count = await reapStaleRuns();
      if (count > 0) console.log(`reaped ${count} stale application(s)`);
      const expired = await expirePersonHandoffs();
      if (expired > 0) console.log(`${expired} person handoff(s) waited too long for a screen`);
    } catch (error) {
      console.error("reaper failed:", error instanceof Error ? error.message : error);
    }
  };
  void reap();
  setInterval(() => void reap(), 60_000);

  const tidy = async () => {
    try {
      const removed = await housekeeping();
      if (removed > 0) console.log(`removed ${removed} browser profile folder(s) of deleted accounts`);
    } catch (error) {
      console.error("housekeeping failed:", error instanceof Error ? error.message : error);
    }
  };
  void tidy();
  setInterval(() => void tidy(), 10 * 60_000);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "worker failed");
  process.exit(1);
});
