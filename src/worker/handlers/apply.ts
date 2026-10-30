import type { Job } from "pg-boss";
import { runApplication } from "@/modules/apply";

export async function handleApply(jobs: Job<{ applicationId: string; person?: boolean }>[]) {
  for (const job of jobs) {
    const applicationId = job.data.applicationId;
    console.log(`apply ${applicationId}`);
    await runApplication(applicationId, { person: job.data.person === true });
  }
}
