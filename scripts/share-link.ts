// The share link for a job, for the owner's posts (Phase U9): its public page on APP_URL with the post's source, so the
// funnel (scripts/share-funnel.ts) tells LinkedIn from X. Says when the job is closed or the agent can't apply on it.
// npx tsx scripts/share-link.ts <jobId> [--s li|x|wa|copy]
import { db } from "../src/lib/db";
import { funnelSource } from "../src/lib/funnel";
import { absoluteUrl, jobPath } from "../src/lib/job-slug";
import { publicJob } from "../src/modules/jobs";

async function main() {
  const jobId = process.argv[2];
  const at = process.argv.indexOf("--s");
  const source = at >= 0 ? funnelSource(process.argv[at + 1]) : null;
  if (!jobId || (at >= 0 && !source)) {
    console.log("usage: npx tsx scripts/share-link.ts <jobId> [--s li|x|wa|copy]");
    process.exitCode = 1;
    return;
  }
  const job = await publicJob(jobId);
  if (!job) {
    console.log(`no job ${jobId}`);
    process.exitCode = 1;
    return;
  }
  console.log(absoluteUrl(`${jobPath(job)}${source ? `?s=${source}` : ""}`));
  if (job.closedAt) console.log("note: this job is closed; the page shows open jobs like it");
  else if (!job.applyable) console.log("note: the agent can't apply on this board; the page shows open jobs like it");
  if (!process.env.APP_URL) console.log("note: APP_URL is not set, so this is a localhost link");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
