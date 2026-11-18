// Phase M5: pay for jobs stored before ingest read it. Runs the real ingestCompany for every active Ashby and Lever
// company (the boards that publish structured pay; Greenhouse's public API leaves it empty, 18 Nov), which writes pay
// columns only where they changed. Then counts open jobs with pay per board. npx tsx scripts/backfill-job-salary.ts
import { db } from "../src/lib/db";
import { ingestCompany } from "../src/modules/jobs/ingest";

const DAYS = 60;
const CONCURRENCY = 4;

async function main() {
  // Only companies with open jobs the feed shows by default (in India or remote from India): 6,883 Ashby and Lever
  // boards in all was hours of fetching for pay nobody sees; the rest get pay at their next regular ingest.
  const companies = await db.company.findMany({
    where: { active: true, source: { in: ["ashby", "lever"] }, jobs: { some: { closedAt: null, eligibility: { in: ["india", "remote_india"] } } } },
    select: { id: true, source: true, slug: true },
    orderBy: { slug: "asc" },
  });
  console.log(`  ${companies.length} companies with open India jobs`);
  const cutoff = Date.now() - DAYS * 24 * 60 * 60 * 1000;
  let failed = 0;
  let next = 0;
  const worker = async () => {
    while (next < companies.length) {
      const i = next++;
      const result = await ingestCompany(companies[i], cutoff);
      if (result.error) failed += 1;
      if ((i + 1) % 50 === 0) console.log(`  ${i + 1}/${companies.length} companies`);
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const counts = await db.$queryRaw<Array<{ source: string; open: bigint; paid: bigint; inr: bigint }>>`
    SELECT source, count(*) AS open, count(*) FILTER (WHERE "salaryCurrency" IS NOT NULL) AS paid,
      count(*) FILTER (WHERE "salaryCurrency" = 'INR') AS inr
    FROM "Job" WHERE "closedAt" IS NULL GROUP BY source ORDER BY source`;
  for (const row of counts) console.log(`${row.source.padEnd(12)} open ${row.open}, with pay ${row.paid} (INR ${row.inr})`);
  console.log(`backfill-job-salary: ${companies.length} companies, ${failed} failed`);
  await db.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
