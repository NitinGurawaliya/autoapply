// Phase P, P1: the shared tail after the workflow's company reads (modules/jobs/after-ingest.ts): embeds new jobs,
// labels the skills of the feed's pool, reads pool jobs (modules/jobs/reading.ts) until the day's budget or the
// deadline, warms the feeds and deletes old closed jobs. Its own job in .github/workflows/jobs.yml, after the ingest job,
// so the 2-hour company read never starves it. Logs `after-ingest (run) embedded=N labelled=N read=N ... budget_left=N`.
//   npx tsx scripts/after-ingest-now.ts [--minutes 40]
import { db } from "../src/lib/db";
import { afterIngest, afterIngestDeadline } from "../src/modules/jobs/after-ingest";
import { readingCoverage } from "../src/modules/jobs/reading";

function arg(name: string) {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

async function main() {
  const minutes = Number(arg("--minutes"));
  const deadlineMs = Number.isFinite(minutes) && minutes > 0 ? minutes * 60_000 : afterIngestDeadline("run");
  await afterIngest({ deadlineMs, label: "run" });
  const coverage = await readingCoverage();
  console.log(`reading coverage: ${coverage.current} of ${coverage.pool} pool jobs read, ${coverage.unread} unread (${coverage.noText} wait for a description), ${coverage.failing} failing`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
