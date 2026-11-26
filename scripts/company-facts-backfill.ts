// Each board account's own website and real name (modules/jobs/company-facts.ts, docs/employers/TDD.md W2). Dry run by
// default: one batch per board, read and counted, nothing written. --write loops every board (in parallel: they are
// different hosts) until no company is left to look at, and resumes where it stopped (domainCheckedAt IS NULL).
//   npx tsx scripts/company-facts-backfill.ts [--write] [--limit 200] [--source greenhouse,lever] [--pause 300]
import { db } from "../src/lib/db";
import { refreshCompanyFacts } from "../src/modules/jobs/company-facts";
import { LOGO_SOURCES } from "../src/modules/jobs/logos";
import { SITES } from "../src/modules/sources/sites";

function arg(name: string) {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
}

async function main() {
  const write = process.argv.includes("--write");
  const batch = Number(arg("--limit")) || 200;
  const pauseMs = Number(arg("--pause")) || undefined;
  const sources = arg("--source")?.split(",") ?? [...LOGO_SOURCES, ...SITES];
  console.log(`${write ? "WRITE" : "DRY RUN (nothing is written)"}: batches of ${batch} on ${sources.join(", ")}`);
  const started = Date.now();
  const totals: Record<string, { checked: number; withDomain: number; renamed: number }> = {};
  const run = (source: string) =>
    (async () => {
      const total = (totals[source] = { checked: 0, withDomain: 0, renamed: 0 });
      for (;;) {
        const done = await refreshCompanyFacts({ limit: batch, write, sources: [source], pauseMs }).catch((error: unknown) => {
          console.error(`${source}: ${error instanceof Error ? error.message : "failed"}`);
          return null;
        });
        if (!done || done.checked === 0) break;
        total.checked += done.checked;
        total.withDomain += done.withDomain;
        total.renamed += done.renamed;
        console.log(`${source}: +${done.checked} (${done.withDomain} with a domain, ${done.renamed} renamed), ${total.checked} so far, ${Math.round((Date.now() - started) / 1000)} s`);
        if (!write) break;
      }
    })();
  // The board accounts first, in parallel (different hosts); signed-in listings last: their only evidence is a board
  // row's domain (a Naukri job that redirects to a board we read), so those rows must have been looked at.
  const isSite = (source: string) => (SITES as readonly string[]).includes(source);
  await Promise.all(sources.filter((source) => !isSite(source)).map(run));
  for (const source of sources.filter(isSite)) await run(source);
  console.log("FACTS", JSON.stringify(totals));
  await db.$disconnect();
}

main().catch(async (error: unknown) => {
  console.error(error instanceof Error ? error.message : "facts failed");
  await db.$disconnect();
  process.exit(1);
});
