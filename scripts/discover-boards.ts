// Board discovery from free sources only: the Common Crawl index, or a URL list collected by hand. Dry run by default
// (reads the index and the boards' public job feeds, writes nothing); --write records the checked boards and adds the
// companies that pass, through the daily discovery's own path (modules/jobs/discovery.ts recordChecked).
//
//   npx tsx scripts/discover-boards.ts                                  # crawl, Greenhouse then Lever, 100 new each, dry
//   npx tsx scripts/discover-boards.ts --boards ashby --limit 300 --crawls 2
//   npx tsx scripts/discover-boards.ts --import urls.csv                # any CSV or text file with board URLs
//   npx tsx scripts/discover-boards.ts --import slugs.txt --boards lever # bare identifiers, one per line, for one ATS
//   npx tsx scripts/discover-boards.ts --recheck --boards ashby        # boards that had too few India jobs, again
//   ... --write                                                         # record and add (production data)
import { readFileSync } from "node:fs";
import { db } from "../src/lib/db";
import { SEED_SOURCES, seedsFromCrawl, seedsFromText, verifySeeds, type SeedSource, type SeedYield } from "../src/modules/jobs/boardSeeds";

function arg(name: string) {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
}

async function main() {
  const write = process.argv.includes("--write");
  const limit = Number(arg("--limit")) || 100;
  const crawls = Number(arg("--crawls")) || 6;
  const file = arg("--import");
  const recheck = process.argv.includes("--recheck");
  // Greenhouse and Lever first: the crawl has barely been worked through for them (Ashby: ~4,000 checked by 24 Oct).
  const boards = (arg("--boards")?.split(",") ?? ["greenhouse", "lever"]).filter((item): item is SeedSource => SEED_SOURCES.includes(item as SeedSource));
  if (boards.length === 0) throw new Error(`--boards takes ${SEED_SOURCES.join(", ")}`);
  console.log(`${write ? "WRITE" : "DRY RUN (nothing is written)"}: ${recheck ? "recheck of boards with too few India jobs" : file ? `import ${file}` : `crawl index, ${crawls} crawls`}; ${boards.join(", ")}; up to ${limit} new boards each`);

  const imported = file ? seedsFromText(readFileSync(file, "utf8"), boards.length === 1 ? boards[0] : undefined) : null;
  if (imported) console.log(`import: ${imported.urls} board URLs read, ${imported.seeds.length} board identifiers`);

  const results: SeedYield[] = [];
  for (const source of boards) {
    const t = Date.now();
    const slugs = recheck
      ? (await db.discoveryCandidate.findMany({ where: { source, status: "few_india_jobs", slug: { not: null } }, orderBy: { checkedAt: "asc" }, select: { slug: true } })).map((row) => row.slug!)
      : imported
        ? imported.seeds.filter((seed) => seed.source === source).map((seed) => seed.slug)
        : await seedsFromCrawl(source, crawls, (line) => console.log(line));
    // A recheck keeps each board's original "from" when it is written (recordChecked updates the row in place).
    const result = await verifySeeds(source, slugs, { limit, write, recheck, from: imported ? "import" : recheck ? "list" : "crawl", log: (line) => console.log(line) });
    results.push(result);
    const { examples, ...counts } = result;
    console.log(`YIELD ${JSON.stringify(counts)} ${Math.round((Date.now() - t) / 1000)} s`);
    if (examples.length > 0) console.log(`  passing: ${examples.join(", ")}`);
  }
  await db.$disconnect();
}

main().catch(async (error: unknown) => {
  console.error(error instanceof Error ? error.message : "discovery failed");
  await db.$disconnect();
  process.exit(1);
});
