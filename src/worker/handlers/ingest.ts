import type { Job } from "pg-boss";
import { ingestJobs, warmFeeds } from "@/modules/jobs";

export async function handleIngest(jobs: Job<{ days: number }>[]) {
  for (const job of jobs) {
    const days = Number(job.data.days);
    if (!Number.isFinite(days) || days < 1) throw new Error("ingest days must be a positive number");
    const totals = await ingestJobs(days);
    // The new jobs are judged for active users now, so their next feed opens without waiting (warm.ts).
    if (totals) {
      const warm = await warmFeeds().catch(() => null);
      if (warm) console.log(`ingest: warmed the feeds of ${warm.warmed} of ${warm.active} users; new-match push to ${warm.alerted}`);
    }
  }
}
