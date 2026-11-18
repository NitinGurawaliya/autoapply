import type { Job } from "pg-boss";
import { ingestJobs } from "@/modules/jobs";

/** Run mode (INGEST_MODE=run): every company, then the shared tail (after-ingest.ts), which warms the feeds itself. */
export async function handleIngest(jobs: Job<{ days: number }>[]) {
  for (const job of jobs) {
    const days = Number(job.data.days);
    if (!Number.isFinite(days) || days < 1) throw new Error("ingest days must be a positive number");
    await ingestJobs(days);
  }
}
