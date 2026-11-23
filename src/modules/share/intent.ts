import { jobPath } from "@/lib/job-slug";
import { readShareIntent } from "@/lib/share-intent";
import { publicJob } from "@/modules/jobs";

export type IntentJob = { id: string; title: string; company: string; logoUrl: string | null; path: string };

/**
 * The job behind the share intent cookie, for the onboarding screens: its strip and where Save goes back to. Null
 * without an intent or when the job is gone. A job that closed since the tap still returns to its page, which says so.
 */
export async function intentJob(): Promise<IntentJob | null> {
  const id = await readShareIntent();
  const job = id ? await publicJob(id) : null;
  if (!job) return null;
  return { id: job.id, title: job.title, company: job.company.name, logoUrl: job.company.logoUrl, path: jobPath(job) };
}
