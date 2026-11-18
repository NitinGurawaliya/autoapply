// Phase M, M2: read every company that is due now, the way tick mode does, without the worker: the same per-company
// read (ingest.ts ingestOne), at most 8 at once and 4 of one board, recorded as one IngestRun. Then embeds the new jobs.
// Then what the worker's tick does after its reads (handlers/ingest-tick.ts): warms the feeds and sends new-match pushes
// when there were new jobs, deletes old closed jobs, and looks for missing logos. Prints per board: companies read,
// unchanged, failed, new jobs, tiers after. The scheduled ingest on GitHub Actions runs this (M21, .github/workflows/jobs.yml).
//   npx tsx scripts/ingest-tick-now.ts [--all] [--board greenhouse] [--limit 500] [--logos 300]
//   --all reads every active company, due or not.
import { db } from "../src/lib/db";
import { guardUndiciParserAssertions } from "../src/lib/undici-guard";
import { warmFeeds } from "../src/modules/jobs";
import { deleteOldClosedJobs, ingestOne, startTickRun } from "../src/modules/jobs/ingest";
import { refreshLogos } from "../src/modules/jobs/logos";
import { embedPendingJobs } from "../src/modules/jobs/semantic";

function arg(name: string) {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

const CONCURRENCY = 8;
const PER_BOARD = 4;

async function main() {
  guardUndiciParserAssertions();
  const board = arg("--board");
  const limit = Number(arg("--limit")) || 100000;
  const all = process.argv.includes("--all");
  const companies = await db.company.findMany({
    where: { active: true, ...(board ? { source: board } : {}), ...(all ? {} : { nextFetchAt: { lte: new Date() } }) },
    orderBy: { nextFetchAt: "asc" },
    take: limit,
    select: { id: true, source: true },
  });
  const runId = await startTickRun(companies.length);
  console.log(`ingest-tick-now: ${companies.length} companies (${runId})`);
  const started = Date.now();
  const perBoard = new Map<string, number>();
  const stats = new Map<string, { read: number; unchanged: number; failed: number; created: number; createdIndia: number; tiers: Record<string, number> }>();
  const queue = [...companies];
  let done = 0;
  const worker = async () => {
    while (queue.length) {
      const index = queue.findIndex((company) => (perBoard.get(company.source) ?? 0) < PER_BOARD);
      if (index < 0) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        continue;
      }
      const [company] = queue.splice(index, 1);
      perBoard.set(company.source, (perBoard.get(company.source) ?? 0) + 1);
      try {
        const result = await ingestOne(company.id, { runId });
        const stat = stats.get(company.source) ?? { read: 0, unchanged: 0, failed: 0, created: 0, createdIndia: 0, tiers: {} };
        if (result) {
          stat.read += 1;
          if (result.unchanged) stat.unchanged += 1;
          if (result.error) stat.failed += 1;
          stat.created += result.created;
          stat.createdIndia += result.createdEligible;
          stat.tiers[result.tier] = (stat.tiers[result.tier] ?? 0) + 1;
        }
        stats.set(company.source, stat);
      } finally {
        perBoard.set(company.source, (perBoard.get(company.source) ?? 1) - 1);
        done += 1;
        if (done % 100 === 0) console.log(`  ${done}/${companies.length} read, ${Math.round((Date.now() - started) / 1000)} s`);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const seconds = Math.round((Date.now() - started) / 1000);
  console.log(`read ${done} companies in ${seconds} s`);
  console.table([...stats.entries()].map(([source, s]) => ({ source, ...s, tiers: Object.entries(s.tiers).map(([tier, n]) => `${tier} ${n}`).join(", ") })));
  const embedded = await embedPendingJobs().catch((error) => {
    console.error(`embedding failed: ${error instanceof Error ? error.message.slice(0, 80) : "error"}`);
    return 0;
  });
  console.log(`embedded ${embedded} jobs`);
  if (embedded > 0) {
    const warm = await warmFeeds().catch(() => null);
    if (warm) console.log(`warmed ${warm.warmed} of ${warm.active} feeds, new-match push to ${warm.alerted}`);
  }
  console.log(`deleted ${await deleteOldClosedJobs().catch(() => 0)} old closed jobs`);
  const logos = Number(arg("--logos") ?? 300);
  if (logos > 0) {
    const found = await refreshLogos({ limit: logos, write: true }).catch(() => null);
    if (found) console.log(`logos: ${found.found} found of ${found.checked} looked at`);
  }
}
main().finally(() => db.$disconnect());
