// Builds the employers from the companies' domains (modules/jobs/employers.ts, docs/employers/TDD.md W3). Dry run by
// default. With --write: the first build when no employer exists (the bigger employer of a domain keeps the bare slug),
// else links the rows that still have no employer or were looked at again, until none is left.
//   npx tsx scripts/employers-link.ts [--write]
import { db } from "../src/lib/db";
import { buildAllEmployers, linkPending } from "../src/modules/jobs/employers";

async function main() {
  const write = process.argv.includes("--write");
  console.log(write ? "WRITE" : "DRY RUN (nothing is written)");
  const existing = await db.employer.count();
  if (existing === 0) {
    const started = Date.now();
    const summary = await buildAllEmployers({ write });
    console.log(`BUILD ${JSON.stringify(summary)} ${Math.round((Date.now() - started) / 1000)} s`);
  } else if (!write) {
    const [row] = await db.$queryRaw<Array<{ pending: number }>>`SELECT count(*)::int AS pending FROM "Company" WHERE "employerId" IS NULL OR "linkedAt" IS NULL OR "linkedAt" < "domainCheckedAt"`;
    console.log(`${existing} employers exist; ${row?.pending ?? 0} companies are waiting to be linked`);
  } else {
    let total = { linked: 0, created: 0, merged: 0 };
    for (let round = 0; round < 500; round += 1) {
      const done = await linkPending(500);
      total = { linked: total.linked + done.linked, created: total.created + done.created, merged: total.merged + done.merged };
      console.log(`round ${round + 1}: ${done.linked} linked (${done.created} created, ${done.merged} merged)`);
      if (done.linked === 0) break;
    }
    console.log(`LINK ${JSON.stringify(total)}`);
  }
  const [left] = await db.$queryRaw<Array<{ unlinked: number }>>`SELECT count(*)::int AS unlinked FROM "Company" WHERE "employerId" IS NULL`;
  console.log(`companies without an employer: ${left?.unlinked ?? 0}`);
  await db.$disconnect();
}

main().catch(async (error: unknown) => {
  console.error(error instanceof Error ? error.message : "link failed");
  await db.$disconnect();
  process.exit(1);
});
