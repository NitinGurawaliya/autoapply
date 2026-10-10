// T78: find which candidate companies have a public Greenhouse job board, and how many India-eligible jobs each has
// right now (the same rules ingest uses: modules/jobs/tagging.ts). Reads only Greenhouse's public boards API and our
// own Company table; writes nothing to the database. Polite: 4 boards at a time, 300 ms between requests.
// Writes docs/greenhouse-review.csv for the owner to approve (keep / drop / stage).
// npx tsx scripts/discover-greenhouse.ts [--batch 2]   (batch 2 writes docs/greenhouse-review-2.csv and leaves out the
// companies already on our list)
import { writeFileSync } from "node:fs";
import { db } from "../src/lib/db";
import { fetchGreenhouse } from "../src/modules/jobs/fetchers/greenhouse";
import { tagPosting } from "../src/modules/jobs/tagging";
import { CANDIDATES, type Stage } from "./greenhouse-candidates";
import { CANDIDATES_2 } from "./greenhouse-candidates-2";

type Row = { name: string; stage: Stage; slug: string | null; open: number; india: number; remoteIndia: number; onList: boolean; error?: string };

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const base = (name: string) => name.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");

/** The first of the slugs that is a live Greenhouse board, or null. */
async function findBoard(slugs: string[]) {
  for (const slug of slugs) {
    const response = await fetch(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}`, { signal: AbortSignal.timeout(15000) }).catch(() => null);
    await pause(300);
    if (response?.ok) return slug;
  }
  return null;
}

async function check(name: string, stage: Stage, slugs: string[], onList: Set<string>): Promise<Row> {
  const slug = await findBoard(slugs);
  if (!slug) return { name, stage, slug: null, open: 0, india: 0, remoteIndia: 0, onList: false };
  try {
    const jobs = await fetchGreenhouse(slug);
    await pause(300);
    let india = 0;
    let remoteIndia = 0;
    for (const job of jobs) {
      const tags = tagPosting(job);
      if (tags.eligibility === "india") india += 1;
      if (tags.eligibility === "remote_india") remoteIndia += 1;
    }
    return { name, stage, slug, open: jobs.length, india, remoteIndia, onList: onList.has(slug) };
  } catch (error) {
    return { name, stage, slug, open: 0, india: 0, remoteIndia: 0, onList: onList.has(slug), error: error instanceof Error ? error.message : String(error) };
  }
}

async function main() {
  const existing = await db.company.findMany({ where: { source: "greenhouse" }, select: { slug: true, name: true } });
  const onList = new Set(existing.map((company) => company.slug));
  // Every candidate plus every company already on our list (found again, so the review has one place for all).
  const queue: Array<{ name: string; stage: Stage; slugs: string[] }> = [];
  const seen = new Set<string>();
  const batchTwo = process.argv.includes("--batch") && process.argv[process.argv.indexOf("--batch") + 1] === "2";
  if (batchTwo) existing.forEach((company) => seen.add(company.slug));
  for (const [name, stage, ...extra] of batchTwo ? CANDIDATES_2 : CANDIDATES) {
    const slugs = [...new Set([...extra, base(name)])];
    if (slugs.every((slug) => seen.has(slug))) continue;
    slugs.forEach((slug) => seen.add(slug));
    queue.push({ name, stage, slugs });
  }
  if (!batchTwo) for (const company of existing) if (!seen.has(company.slug)) queue.push({ name: company.name, stage: "mnc", slugs: [company.slug] });

  const rows: Row[] = [];
  let next = 0;
  const worker = async () => {
    while (next < queue.length) {
      const item = queue[next++];
      rows.push(await check(item.name, item.stage, item.slugs, onList));
      if (rows.length % 25 === 0) console.log(`  checked ${rows.length}/${queue.length}`);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);

  const found = rows.filter((row) => row.slug);
  const eligible = found.filter((row) => row.india + row.remoteIndia > 0).sort((a, b) => b.india + b.remoteIndia - (a.india + a.remoteIndia));
  const csv = [
    "keep,name,slug,stage,open_jobs,india_jobs,remote_india_jobs,already_on_list,note",
    ...found
      .sort((a, b) => b.india + b.remoteIndia - (a.india + a.remoteIndia) || b.open - a.open)
      .map((row) => [row.india + row.remoteIndia > 0 ? "yes" : "no", `"${row.name}"`, row.slug, row.stage, row.open, row.india, row.remoteIndia, row.onList ? "yes" : "no", row.error ? `"${row.error}"` : ""].join(",")),
  ].join("\n");
  const out = batchTwo ? "docs/greenhouse-review-2.csv" : "docs/greenhouse-review.csv";
  writeFileSync(out, csv + "\n");

  const total = (key: "india" | "remoteIndia" | "open") => eligible.reduce((sum, row) => sum + row[key], 0);
  console.log(`candidates checked: ${queue.length}; on Greenhouse: ${found.length}; with India-eligible jobs: ${eligible.length}`);
  console.log(`India-eligible open jobs at those companies: ${total("india") + total("remoteIndia")} (in India ${total("india")}, remote from India ${total("remoteIndia")}); their open jobs in all: ${total("open")}`);
  console.log(`already on our list: ${found.filter((row) => row.onList).length}; new with India jobs: ${eligible.filter((row) => !row.onList).length}`);
  console.log("top 25:", eligible.slice(0, 25).map((row) => `${row.name} ${row.india + row.remoteIndia}`).join(", "));
  console.log(`wrote ${out}`);
}

main().finally(() => db.$disconnect());
