// K14 (docs/naukri/TASKS.md#k14): the owner's company list as company buckets for the shared Naukri reader.
//
// npx tsx scripts/naukri-company-buckets.ts <naukri-companies.csv>            counts only, nothing written
// npx tsx scripts/naukri-company-buckets.ts <naukri-companies.csv> --write    one bucket per name, due at once
//
// Names only (owner, 24 Nov 2026, slugSources/lists.ts "myjobb-company-names"): the file must be exactly the one the owner
// approved (its sha256 prefix is checked), and nothing of it but each company's name is read or kept. Needs the
// migration 20261127090000_reader_buckets applied.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { db } from "../src/lib/db";
import { readerRules } from "../src/modules/governance";
import { SLUG_LISTS } from "../src/modules/jobs/slugSources/lists";
import { seedCompanyBuckets } from "../src/modules/sources";

async function main() {
  const file = process.argv[2];
  if (!file || file.startsWith("--")) throw new Error("usage: naukri-company-buckets.ts <naukri-companies.csv> [--write]");
  const bytes = readFileSync(file);
  const list = SLUG_LISTS.find((item) => item.name === "myjobb-company-names");
  const hash = `sha256:${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}`;
  if (!list || list.version !== hash) throw new Error(`${file} is not the approved list (${hash}, expected ${list?.version ?? "a registered list"})`);
  const rules = readerRules("naukri");
  if (!rules) throw new Error("config/rules.json has no shared_readers.naukri");
  // The first column is the name; the rest of each row (myjobb's slug, URL and counts) is not read.
  const names = bytes.toString("utf8").split(/\r?\n/).slice(1).map((line) => line.split(",")[0].trim()).filter(Boolean);
  if (!process.argv.includes("--write")) {
    console.log(`${names.length} names (${hash}); nothing written. Run again with --write.`);
    return;
  }
  const result = await seedCompanyBuckets("naukri", names, rules.company_every_hours);
  console.log(`${names.length} names -> ${result.buckets} company buckets: ${result.added} added, ${result.known} already there`);
}

main().finally(() => db.$disconnect()).then(() => process.exit(0)).catch((error) => {
  console.error(String(error instanceof Error ? error.message : error).slice(0, 300));
  process.exit(1);
});
