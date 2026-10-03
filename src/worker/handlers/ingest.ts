import type { Job } from "pg-boss";
import { ingestJobs } from "@/modules/jobs";

export async function handleIngest(jobs: Job<{ days: number }>[]) {
  for (const job of jobs) {
    const days = Number(job.data.days);
    if (!Number.isFinite(days) || days < 1) throw new Error("ingest days must be a positive number");
    await ingestJobs(days);
  }
}
