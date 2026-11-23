// Phase U6: open jobs like a shared job (src/modules/jobs/similar.ts). Read-only, on the real database: for a closed
// job, a Workday job and an open one, every pick is open, on a board the agent applies on, open to India, from another
// company, one per company, never the job itself; a job without an embedding gets none.
// npx tsx scripts/similar-jobs-test.ts
import { db } from "../src/lib/db";
import { APPLY_BOARDS, similarJobs } from "../src/modules/jobs";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

async function main() {
  const withEmbedding = async (where: string) =>
    (await db.$queryRawUnsafe<Array<{ id: string; title: string; companyId: string }>>(`SELECT id, title, "companyId" FROM "Job" WHERE embedding IS NOT NULL AND ${where} ORDER BY "postedAt" DESC LIMIT 1`))[0];
  const sources = (APPLY_BOARDS as readonly string[]).map((board) => `'${board}'`).join(",");
  const cases = [
    ["closed", await withEmbedding(`"closedAt" IS NOT NULL AND source IN (${sources})`)],
    ["workday", await withEmbedding(`"closedAt" IS NULL AND source = 'workday'`)],
    ["open", await withEmbedding(`"closedAt" IS NULL AND source IN (${sources}) AND eligibility = 'india'`)],
  ] as const;

  for (const [label, job] of cases) {
    if (!job) {
      check(`${label}: a job to test with`, false);
      continue;
    }
    const started = Date.now();
    const similar = await similarJobs(job.id, 3);
    const ms = Date.now() - started;
    const rows = await db.job.findMany({ where: { id: { in: similar.map((item) => item.id) } }, select: { id: true, closedAt: true, source: true, eligibility: true, companyId: true } });
    check(`${label}: three found`, similar.length === 3, `${job.title}: ${similar.map((item) => `${item.company.name} · ${item.title}`).join(" | ")} in ${ms} ms`);
    check(`${label}: all open`, rows.every((row) => row.closedAt === null));
    check(`${label}: all on boards the agent applies on`, rows.every((row) => (APPLY_BOARDS as readonly string[]).includes(row.source)));
    check(`${label}: all open to India`, rows.every((row) => row.eligibility === "india" || row.eligibility === "remote_india"));
    check(`${label}: none from the job's company, one per company`, rows.every((row) => row.companyId !== job.companyId) && new Set(rows.map((row) => row.companyId)).size === rows.length);
    check(`${label}: not the job itself`, similar.every((item) => item.id !== job.id));
  }

  const bare = await db.job.findFirst({ where: { closedAt: null }, select: { id: true } });
  const unembedded = (await db.$queryRaw<Array<{ id: string }>>`SELECT id FROM "Job" WHERE embedding IS NULL LIMIT 1`)[0] ?? null;
  if (unembedded) check("a job without an embedding gets none", (await similarJobs(unembedded.id)).length === 0);
  check("an unknown id gets none", (await similarJobs("cmzzzzzzzzzzzzzzzzzzzzzzz")).length === 0 && Boolean(bare));

  await db.$disconnect();
  console.log(failed === 0 ? "PASS similar-jobs-test" : `FAIL similar-jobs-test (${failed})`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
