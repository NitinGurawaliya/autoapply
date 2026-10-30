import { hostname } from "node:os";
import { db } from "@/lib/db";
import { getBoss, HANDOFF_QUEUE, PERSON_QUEUE, UNPROTECTED_QUEUE } from "@/lib/queue";
import { autoSubmitAshby, canShowWindow } from "@/modules/apply/browser";
import { runDiscovery } from "@/modules/jobs/discovery";
import { handleApply } from "./handlers/apply";
import { handleIngest } from "./handlers/ingest";
import { handlePrescan } from "./handlers/prescan";
import { expirePersonHandoffs, housekeeping, reapStaleRuns } from "./reaper";
import { registerSchedules } from "./schedule";
import { claimWorkerLock } from "./single";

async function main() {
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
  await boss.work("ingest", handleIngest);
  await boss.work("prescan", handlePrescan);
  await boss.work("discover", async () => {
    await runDiscovery();
  });
  const auto = autoSubmitAshby() ? ", auto submit" : "";
  console.log(`worker listening for apply (x${concurrency})${unprotected ? `, ${UNPROTECTED_QUEUE} (x${concurrency}${auto})` : ""}${handoff ? `, ${HANDOFF_QUEUE} (x${concurrency}${auto}), ${PERSON_QUEUE}` : ", no screen: no protected Ashby"} and ingest`);

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
  console.log(`ingest scheduled: "${ingest.cron}" ${ingest.timezone}, last ${ingest.days} days; discovery "${ingest.discoverCron}"`);

  // Heartbeat for /api/health: a worker that has not beaten for a few minutes is down.
  const host = process.env.WORKER_NAME?.trim() || hostname();
  const startedAt = new Date();
  const beat = async () => {
    await db.workerBeat.upsert({ where: { id: host }, create: { id: host, beatAt: new Date(), startedAt }, update: { beatAt: new Date(), startedAt } }).catch(() => undefined);
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
