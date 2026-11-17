// Board discovery from free sources only: the Common Crawl index, or a URL list collected by hand. Dry run by default
// (reads the index and the boards' public job feeds, writes nothing); --write records the checked boards and adds the
// companies that pass, through the daily discovery's own path (modules/jobs/discovery.ts recordChecked).
//
//   npx tsx scripts/discover-boards.ts                                  # crawl, Greenhouse then Lever, 100 new each, dry
//   npx tsx scripts/discover-boards.ts --boards ashby --limit 300 --crawls 2
//   npx tsx scripts/discover-boards.ts --import urls.csv                # any CSV or text file with board URLs
//   npx tsx scripts/discover-boards.ts --import slugs.txt --boards lever # bare identifiers, one per line, for one ATS
//   npx tsx scripts/discover-boards.ts --recheck --boards ashby        # boards that had too few India jobs, again
//   npx tsx scripts/discover-boards.ts --import list.csv --boards greenhouse,ashby --from list:ats-scrapers --watch-all --limit 20000
//                                                                       # M3: watch every board that answers, India jobs or not
//   ... --write                                                         # record and add (production data)
//   ... --shard 2/6                                                     # only shard 2 of 6 (parallel runs never share a board)
//   ... --pause-minutes 10                                              # auto-pause length when the board pushes back
//   ... --lanes 1                                                       # parallel checks in this run (Workable rate-limits)
import { readFileSync } from "node:fs";
import { db } from "../src/lib/db";
import { SEED_SOURCES, seedsFromCrawl, seedsFromText, verifySeeds, type SeedSource, type SeedYield } from "../src/modules/jobs/boardSeeds";
import { allowedList } from "../src/modules/jobs/slugSources/lists";

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
  const watchAll = process.argv.includes("--watch-all");
  const from = arg("--from");
  const shardArg = arg("--shard")?.match(/^(\d+)\/(\d+)$/);
  const shard = shardArg ? { index: Number(shardArg[1]), count: Number(shardArg[2]) } : undefined;
  if (arg("--shard") && (!shard || shard.count < 1 || shard.index >= shard.count)) throw new Error("--shard takes i/n with 0 <= i < n");
  const pauseMinutes = Number(arg("--pause-minutes")) || 10;
  const lanes = Number(arg("--lanes")) || undefined;
  // An open list is imported only when it is registered with a licence we may use (slugSources/lists.ts).
  if (from?.startsWith("list:")) console.log(`list ${allowedList(from.slice(5)).name}: ${allowedList(from.slice(5)).licence}`);
  // Greenhouse and Lever first: the crawl has barely been worked through for them (Ashby: ~4,000 checked by 24 Oct).
  const boards = (arg("--boards")?.split(",") ?? ["greenhouse", "lever"]).filter((item): item is SeedSource => SEED_SOURCES.includes(item as SeedSource));
  if (boards.length === 0) throw new Error(`--boards takes ${SEED_SOURCES.join(", ")}`);
  console.log(`${write ? "WRITE" : "DRY RUN (nothing is written)"}: ${recheck ? "recheck of boards with too few India jobs" : file ? `import ${file}` : `crawl index, ${crawls} crawls`}; ${boards.join(", ")}; up to ${limit} new boards each${watchAll ? "; every board that answers is watched" : ""}${shard ? `; shard ${shard.index}/${shard.count}` : ""}`);

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
    const result = await verifySeeds(source, slugs, { limit, write, recheck, watchAll, from: from ?? (imported ? "import" : recheck ? "list" : "crawl"), log: (line) => console.log(line), shard, pauseMinutes, lanes });
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
