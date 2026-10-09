import { getBoss } from "@/lib/queue";
import { handleApply } from "./handlers/apply";
import { handleIngest } from "./handlers/ingest";
import { handlePrescan } from "./handlers/prescan";
import { housekeeping, reapStaleRuns } from "./reaper";
import { registerSchedules } from "./schedule";
import { claimWorkerLock } from "./single";

async function main() {
  claimWorkerLock();
  const boss = await getBoss();
  // Each run owns its own Chromium, so concurrency is bounded by RAM (~0.5 GB per run) and by how many simultaneous
  // submissions from one IP the ATS tolerates. A run waiting on a security code holds one slot for up to 10 minutes.
  const concurrency = Math.min(Math.max(Number(process.env.APPLY_CONCURRENCY) || 3, 1), 8);
  await boss.work("apply", { localConcurrency: concurrency }, handleApply);
  await boss.work("ingest", handleIngest);
  await boss.work("prescan", handlePrescan);
  console.log(`worker listening for apply (x${concurrency}) and ingest`);
  const ingest = await registerSchedules(boss);
  console.log(`ingest scheduled: "${ingest.cron}" ${ingest.timezone}, last ${ingest.days} days`);

  // Runs whose worker died stay "active" forever otherwise. Every worker checks; the reaper is idempotent.
  const reap = async () => {
    try {
      const count = await reapStaleRuns();
      if (count > 0) console.log(`reaped ${count} stale application(s)`);
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
