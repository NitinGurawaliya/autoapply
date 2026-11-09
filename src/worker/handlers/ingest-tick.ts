import type { Job } from "pg-boss";
import { enqueueIngestCompany } from "@/lib/queue";
import { dueCompanies, startTickRun, warmFeeds } from "@/modules/jobs";
import { deleteOldClosedJobs } from "@/modules/jobs/ingest";
import { embedPendingJobs } from "@/modules/jobs/semantic";

// How many due companies one tick sends at most: 2,000 every 5 minutes reads 20,000 newly seeded companies within an
// hour (scripts/ingest-scale-smoke.ts: 54 min cold, 5 min overdue at most in steady state).
const BATCH = () => Math.min(Math.max(Number(process.env.INGEST_TICK_BATCH) || 2000, 1), 10000);
// Old closed jobs are cleared once an hour, not every tick.
let lastCleanup = 0;

/**
 * The `ingest-tick` queue (INGEST_MODE=tick, Phase M, M2). Every tick: first the housekeeping a run used to do at its
 * end, for the reads the last ticks finished (embed new jobs, warm the feeds when there were any, hourly delete old
 * closed jobs); then each company due for a read gets its own `ingest-company` job, most overdue first.
 */
export async function handleIngestTick(jobs: Job<object>[]) {
  for (const _job of jobs) {
    void _job;
    const embedded = await embedPendingJobs().catch((error) => {
      console.error(`ingest-tick: embedding failed (${error instanceof Error ? error.message.slice(0, 80) : "error"}); the next tick retries`);
      return 0;
    });
    if (embedded > 0) {
      const warm = await warmFeeds().catch(() => null);
      console.log(`ingest-tick: embedded ${embedded} jobs${warm ? `; warmed ${warm.warmed} of ${warm.active} feeds, new-match push to ${warm.alerted}` : ""}`);
    }
    if (Date.now() - lastCleanup > 60 * 60 * 1000) {
      lastCleanup = Date.now();
      const deleted = await deleteOldClosedJobs().catch(() => 0);
      if (deleted) console.log(`ingest-tick: deleted ${deleted} old closed jobs`);
    }
    const due = await dueCompanies(BATCH());
    if (due.length === 0) continue;
    const runId = await startTickRun(due.length);
    let sent = 0;
    for (const company of due) if (await enqueueIngestCompany(company.id, company.source, runId)) sent += 1;
    // A company already waiting or running is not sent twice (the queue's exclusive policy): `sent` counts the new ones.
    console.log(`ingest-tick: ${due.length} due, ${sent} sent (${runId})`);
  }
}
