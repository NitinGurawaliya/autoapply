// Run today's discovery by hand (the worker runs it daily at DISCOVER_CRON). npx tsx scripts/discover-now.ts [count]
import { db } from "../src/lib/db";
import { runDiscovery } from "../src/modules/jobs/discovery";
const t = Date.now();
runDiscovery({ count: Number(process.argv[2]) || undefined })
  .then((totals) => console.log(`RESULT ${Math.round((Date.now() - t) / 1000)} s ${JSON.stringify(totals)}`))
  .finally(() => db.$disconnect());
