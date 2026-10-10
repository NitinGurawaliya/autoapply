// Embeds every open job that has no vector yet (modules/jobs/semantic.ts); ingest does this after each run.
// npx tsx scripts/embed-jobs.ts [max]
import { db } from "../src/lib/db";
import { embedPendingJobs } from "../src/modules/jobs/semantic";

async function main() {
  const t = Date.now();
  const done = await embedPendingJobs(Number(process.argv[2]) || 20000);
  const left = await db.job.count({ where: { closedAt: null, source: { not: "mock" } } });
  const rows = await db.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM "Job" WHERE embedding IS NOT NULL`;
  console.log(`embedded ${done} jobs in ${Math.round((Date.now() - t) / 1000)} s; jobs with a vector: ${rows[0].n} of ${left} open`);
}
main().finally(() => db.$disconnect());
