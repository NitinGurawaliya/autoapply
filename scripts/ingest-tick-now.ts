// Phase M, M2: read every company that is due now, the way tick mode does, without the worker: the same per-company
// read (ingest.ts ingestOne), at most 8 at once and 4 of one board, recorded as one IngestRun. Then looks for missing
// logos. Embedding, skills labels, job reading, warming and cleanup are the shared tail (modules/jobs/after-ingest.ts),
// which the workflow runs as its own job after this one (scripts/after-ingest-now.ts). Prints per board: companies read,
// unchanged, failed, new jobs, tiers after. The scheduled ingest on GitHub Actions runs this (M21, .github/workflows/jobs.yml).
//   npx tsx scripts/ingest-tick-now.ts [--all] [--board greenhouse] [--limit 500] [--logos 300] [--facts 600]
//   --all reads every active company, due or not.
import { db } from "../src/lib/db";
import { guardUndiciParserAssertions } from "../src/lib/undici-guard";
import { ingestOne, startTickRun } from "../src/modules/jobs/ingest";
import { refreshCompanyFacts } from "../src/modules/jobs/company-facts";
import { linkPending, relinkDomains } from "../src/modules/jobs/employers";
import { refreshLogos } from "../src/modules/jobs/logos";

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
  const logos = Number(arg("--logos") ?? 300);
  if (logos > 0) {
    const found = await refreshLogos({ limit: logos, write: true }).catch(() => null);
    if (found) console.log(`logos: ${found.found} found of ${found.checked} looked at`);
  }
  // Employers (Phase W, docs/employers/TDD.md 4.6): each new company's own website and name from its board page (three
  // sweeps at once, a share of the rows each), then every company with no employer, or with a domain its employer lacks,
  // is put under the right one. The set-based pass first, the per-row pass for what is left.
  const facts = Number(arg("--facts") ?? 600);
  if (facts > 0) {
    const shares = await Promise.all([0, 1, 2].map((index) => refreshCompanyFacts({ limit: Math.ceil(facts / 3), write: true, shard: { of: 3, index } }).catch(() => null)));
    const checked = shares.reduce((sum, share) => sum + (share?.checked ?? 0), 0);
    const withDomain = shares.reduce((sum, share) => sum + (share?.withDomain ?? 0), 0);
    console.log(`facts: ${withDomain} with a domain of ${checked} looked at`);
    const bulk = await relinkDomains().catch(() => null);
    const rest = await linkPending(500).catch(() => null);
    console.log(`employers: ${bulk ? `${bulk.domainSet} took a domain, ${bulk.joined} joined` : "bulk relink failed"}; ${rest ? `${rest.linked} linked, ${rest.created} new, ${rest.merged} merged` : "link failed"}`);
  }
}
main().finally(() => db.$disconnect());
