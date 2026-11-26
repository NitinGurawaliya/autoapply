import { hostname } from "node:os";
import { db } from "@/lib/db";
import { APPLY_QUEUE, getBoss, INGEST_SOURCE_QUEUE, LEGACY_APPLY_QUEUES, READER_PLAN_QUEUE, READER_RUN_QUEUE, SITE_APPLY_QUEUE, SOURCE_CONNECT_QUEUE, SOURCE_INGEST_TICK } from "@/lib/queue";
import { guardUndiciParserAssertions } from "@/lib/undici-guard";
import { canShowWindow } from "@/modules/apply/browser";
import { relayConfig, startRelay } from "@/modules/apply/sites/relay";
import { sharedReaderOn } from "@/modules/sources";
import { handleApply } from "./handlers/apply";
import { handleBoardDay } from "./handlers/board-day";
import { handleDiscover } from "./handlers/discover";
import { handleIngest } from "./handlers/ingest";
import { handleIngestCompany } from "./handlers/ingest-company";
import { handleIngestTick } from "./handlers/ingest-tick";
import { handlePrescan } from "./handlers/prescan";
import { handleSourceConnect } from "./handlers/sourceConnect";
import { handleSourceIngest, handleSourceIngestTick } from "./handlers/sourceIngest";
import { handleReaderPlan, handleReaderRun } from "./handlers/reader";
import { expirePersonHandoffs, housekeeping, reapStaleRuns } from "./reaper";
import { registerSchedules } from "./schedule";
import { claimWorkerLock } from "./single";

// `--only=sources` (or WORKER_ONLY=sources): a worker for the user's own job-site accounts only (Naukri sign-in and job
// runs, docs/naukri/TDD.md 4.2), beside a normal worker or with none: it takes no applications, schedules or reaping,
// so trying Naukri on a laptop never picks up real applications from the shared queues.
const ONLY_SOURCES = process.argv.includes("--only=sources") || process.env.WORKER_ONLY === "sources";

/**
 * Streamed sign-ins (K8): with SOURCE_STREAM_PORT, SOURCE_STREAM_PUBLIC_URL and SOURCE_STREAM_SECRET set, this worker
 * serves the user's sign-in window to their phone (modules/apply/sites/relay.ts); without them it shows K1's window on
 * its own screen. A configured relay that cannot start is logged and the worker carries on with the window.
 */
async function startSignInRelay() {
  const config = relayConfig();
  if ("error" in config) {
    if (process.env.SOURCE_STREAM_PORT || process.env.SOURCE_STREAM_PUBLIC_URL) console.error(`relay: off (${config.error})`);
    return;
  }
  await startRelay().catch((error) => console.error(`relay: could not start (${error instanceof Error ? error.message.slice(0, 120) : "failed"})`));
}

/**
 * The shared reader (K14, NAUKRI_READER=1): works the plan tick and the reader windows, and keeps the tick scheduled every
 * 20 minutes (pg-boss keeps the schedule in the database, so one worker setting it is enough and a second is harmless).
 */
async function startReader(boss: Awaited<ReturnType<typeof getBoss>>) {
  if (!sharedReaderOn()) return;
  await boss.work(READER_PLAN_QUEUE, handleReaderPlan);
  await boss.work(READER_RUN_QUEUE, { localConcurrency: 1 }, handleReaderRun);
  await boss.schedule(READER_PLAN_QUEUE, "*/20 * * * *", {}, { tz: "UTC", missed: "once", expireInSeconds: 600, retryLimit: 0 });
  console.log(`reader: the shared reader is on (plan every 20 minutes)`);
}

async function sourcesOnly() {
  claimWorkerLock();
  if (!canShowWindow()) throw new Error("--only=sources needs a screen: the sign-in and the job runs open a visible Chrome window");
  const boss = await getBoss();
  await startSignInRelay();
  await boss.work(SOURCE_CONNECT_QUEUE, { localConcurrency: 2 }, handleSourceConnect);
  await boss.work(INGEST_SOURCE_QUEUE, { localConcurrency: 1 }, handleSourceIngest);
  // Applications on the user's own signed-in site (Naukri), one at a time: never the shared apply queue.
  await boss.work(SITE_APPLY_QUEUE, { localConcurrency: 1 }, handleApply);
  await startReader(boss);
  console.log(`worker (sources only) listening for ${SOURCE_CONNECT_QUEUE}, ${INGEST_SOURCE_QUEUE} and ${SITE_APPLY_QUEUE}; no other applications, schedules or reaping`);
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
  guardUndiciParserAssertions();
  const boss = await getBoss("worker");
  // Runs share one Chromium, each in its own context (modules/apply/browser.ts), so concurrency is bounded by RAM
  // (a context is a fraction of a browser) and by how many simultaneous submissions from one IP the ATS tolerates.
  // A run waiting on a security code holds one slot for up to 10 minutes.
  const concurrency = Math.min(Math.max(Number(process.env.APPLY_CONCURRENCY) || 3, 1), 24);
  // Every application runs in the stealthy Chrome, a visible window (lib/queue.ts APPLY_QUEUE), so only a worker with a
  // screen applies; one without (the Docker worker) reads jobs only. The pre-18 Nov queues are emptied here too.
  const applies = canShowWindow();
  if (applies) for (const queue of [APPLY_QUEUE, ...LEGACY_APPLY_QUEUES]) await boss.work(queue, { localConcurrency: concurrency }, handleApply);
  // Naukri applications (lib/queue.ts SITE_APPLY_QUEUE): one at a time per worker, in the user's own window.
  if (applies) await boss.work(SITE_APPLY_QUEUE, { localConcurrency: 1 }, handleApply);
  // Signing in to a user's own job-site account (Naukri): a window the person sees, so a screen is needed (docs/naukri/TDD.md 4.2).
  if (applies) await startSignInRelay();
  if (applies) await boss.work(SOURCE_CONNECT_QUEUE, { localConcurrency: 2 }, handleSourceConnect);
  // A user's run on their signed-in site, in their window: one at a time per worker (docs/naukri/TDD.md 4.2).
  if (applies) await boss.work(INGEST_SOURCE_QUEUE, { localConcurrency: 1 }, handleSourceIngest);
  if (applies) await startReader(boss);
  await boss.work(SOURCE_INGEST_TICK, handleSourceIngestTick);
  await boss.work("ingest", handleIngest);
  await boss.work("prescan", handlePrescan);
  // The daily run hands each board its own job; this takes them one at a time (handlers/discover.ts).
  await boss.work("discover", handleDiscover);
  await boss.work("board-day", handleBoardDay);
  // Tick mode (M2): reads of different boards run side by side; at most INGEST_PER_HOST of one board at once, across
  // every worker (pg-boss group concurrency, the group being the board).
  await boss.work("ingest-tick", handleIngestTick);
  const ingestConcurrency = Math.min(Math.max(Number(process.env.INGEST_CONCURRENCY) || 8, 1), 32);
  const perHost = Math.min(Math.max(Number(process.env.INGEST_PER_HOST) || 4, 1), ingestConcurrency);
  // A gentle board (Workday, modules/jobs/cadence.ts) one company at a time (owner, 18 Nov: its bot check).
  await boss.work("ingest-company", { localConcurrency: ingestConcurrency, groupConcurrency: { default: perHost, tiers: { gentle: 1 } } }, handleIngestCompany);
  console.log(applies ? `worker listening for apply (x${concurrency}), ${SOURCE_CONNECT_QUEUE}, ${INGEST_SOURCE_QUEUE} and ingest` : "worker listening for ingest only (no screen, so no applications)");

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
  console.log(`ingest scheduled (${ingest.mode}): "${ingest.cron}" ${ingest.timezone}, last ${ingest.days} days; discovery "${ingest.discoverCron}"; board day "${ingest.boardDayCron}"; signed-in sites "${ingest.sourceCron}"`);

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
