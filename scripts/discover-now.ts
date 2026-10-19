// Run today's discovery by hand (the worker runs it daily at DISCOVER_CRON).
// npx tsx scripts/discover-now.ts [count] [--boards greenhouse,lever]
import { db } from "../src/lib/db";
import { runDiscovery } from "../src/modules/jobs/discovery";
const t = Date.now();
const at = process.argv.indexOf("--boards");
const boards = at > 0 ? process.argv[at + 1]?.split(",") : undefined;
runDiscovery({ count: Number(process.argv[2]) || undefined, boards })
  .then((totals) => console.log(`RESULT ${Math.round((Date.now() - t) / 1000)} s ${JSON.stringify(totals)}`))
  .finally(() => db.$disconnect());
