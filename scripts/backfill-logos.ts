// Company logos from their public job board pages (modules/jobs/logos.ts). Dry run by default: reads the pages and
// counts; --write saves them (Company.logoUrl, logoCheckedAt).
//   npx tsx scripts/backfill-logos.ts [--limit 600] [--boards greenhouse,lever,ashby] [--write]
import { db } from "../src/lib/db";
import { refreshLogos } from "../src/modules/jobs/logos";

function arg(name: string) {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
}

async function main() {
  const write = process.argv.includes("--write");
  const limit = Number(arg("--limit")) || 600;
  const sources = arg("--boards")?.split(",");
  console.log(`${write ? "WRITE" : "DRY RUN (nothing is written)"}: up to ${limit} companies${sources ? ` on ${sources.join(", ")}` : ""}`);
  const t = Date.now();
  const { examples, ...counts } = await refreshLogos({ limit, write, sources });
  console.log(`LOGOS ${JSON.stringify(counts)} ${Math.round((Date.now() - t) / 1000)} s`);
  for (const line of examples) console.log(`  ${line}`);
  await db.$disconnect();
}

main().catch(async (error: unknown) => {
  console.error(error instanceof Error ? error.message : "logos failed");
  await db.$disconnect();
  process.exit(1);
});
