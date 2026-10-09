import type { Job } from "pg-boss";
import { prescanFeed } from "@/modules/apply/prescan";

export async function handlePrescan(jobs: Job<{ userId: string }>[]) {
  for (const job of jobs) {
    if (!job.data?.userId) continue;
    const result = await prescanFeed(job.data.userId);
    console.log(`prescan user ...${job.data.userId.slice(-6)}: ${result.covered}/${result.scanned} jobs answerable, ${result.gaps} gaps`);
  }
}
