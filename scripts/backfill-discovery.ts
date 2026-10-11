// One-off (T89): record in DiscoveryCandidate every company the manual batches checked (scripts/greenhouse-candidates*.ts
// and docs/greenhouse-review*.csv), so daily discovery never checks them again. npx tsx scripts/backfill-discovery.ts
import { readFileSync } from "node:fs";
import { db } from "../src/lib/db";
import { normalName } from "../src/modules/jobs/discovery";
import { CANDIDATES } from "./greenhouse-candidates";
import { CANDIDATES_2 } from "./greenhouse-candidates-2";
import { CANDIDATES_3 } from "./greenhouse-candidates-3";

async function main() {
  const found = new Map<string, { name: string; slug: string; stage: string; open: number; india: number }>();
  for (const file of ["docs/greenhouse-review.csv", "docs/greenhouse-review-2.csv", "docs/greenhouse-review-3.csv"]) {
    const [header, ...lines] = readFileSync(file, "utf8").trim().split(/\r?\n/);
    const cols = header.split(",");
    for (const line of lines) {
      const cells = line.match(/("([^"]*)"|[^,]*)(,|$)/g)!.map((cell) => cell.replace(/,$/, "").replace(/^"|"$/g, ""));
      const row = Object.fromEntries(cols.map((col, i) => [col, cells[i]]));
      found.set(normalName(row.name), { name: row.name, slug: row.slug, stage: row.stage, open: Number(row.open_jobs) || 0, india: (Number(row.india_jobs) || 0) + (Number(row.remote_india_jobs) || 0) });
    }
  }
  const onList = new Set((await db.company.findMany({ where: { source: "greenhouse" }, select: { slug: true } })).map((c) => c.slug));
  const rows = new Map<string, { name: string; slug: string | null; stage: string | null; status: string; openJobs: number; indiaJobs: number }>();
  for (const [name, stage] of [...CANDIDATES, ...CANDIDATES_2, ...CANDIDATES_3]) {
    const hit = found.get(normalName(name));
    rows.set(normalName(name), hit
      ? { name, slug: hit.slug, stage, status: onList.has(hit.slug) ? "added" : "few_india_jobs", openJobs: hit.open, indiaJobs: hit.india }
      : { name, slug: null, stage, status: "not_on_board", openJobs: 0, indiaJobs: 0 });
  }
  for (const [key, hit] of found) if (!rows.has(key)) rows.set(key, { name: hit.name, slug: hit.slug, stage: hit.stage, status: onList.has(hit.slug) ? "added" : "few_india_jobs", openJobs: hit.open, indiaJobs: hit.india });
  const result = await db.discoveryCandidate.createMany({ data: [...rows.values()].map((row) => ({ ...row, from: "list" })), skipDuplicates: true });
  const counts = await db.discoveryCandidate.groupBy({ by: ["status"], _count: true });
  console.log(`recorded ${result.count} of ${rows.size} checked names; by status: ${JSON.stringify(Object.fromEntries(counts.map((c) => [c.status, c._count])))}`);
}
main().finally(() => db.$disconnect());
