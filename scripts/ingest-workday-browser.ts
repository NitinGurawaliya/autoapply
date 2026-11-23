// Workday ingest through the stealthy Chrome (23 Nov): the same per-company read as the worker's tick (ingest.ts
// ingestOne), but every API request runs as a fetch inside the SeleniumBase Chrome on the tenant's own career site
// (modules/apply/board-reader.ts), the way past Cloudflare's refusal of this server's reads since 17 Nov. One Chrome,
// one company at a time, recorded as one IngestRun; each company's tier and next read are recorded as in tick mode.
// Needs a screen (the Chrome is a visible window) and Python with seleniumbase (docs/STEALTHY-BROWSER.md).
//   npx tsx scripts/ingest-workday-browser.ts [--all] [--added-by import] [--slug nvidia.wd5/NVIDIAExternalCareerSite] [--limit 500] [--days 60]
//     [--file workday.csv] [--shard 0/2] [--skip-read-since 2026-11-23T16:40:00Z]
//   Default: the active Workday companies due now, most overdue first. --all: every active one. --file: the companies
//   of a career-site CSV (scripts/import-workday-companies.ts), due or not. --shard k/n: every n-th company from the
//   k-th, so n runs (n Chromes) split one list without overlap. --skip-read-since: leave out companies read without an
//   error since then (a run restarted, or one that already read them).
import { readFileSync } from "node:fs";
import { db } from "../src/lib/db";
import { guardUndiciParserAssertions } from "../src/lib/undici-guard";
import { openStealthyBoardReader } from "../src/modules/apply/board-reader";
import { ingestOne, startTickRun } from "../src/modules/jobs/ingest";
import { companiesFromCsv } from "./import-workday-companies";

function arg(name: string) {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

async function main() {
  guardUndiciParserAssertions();
  const all = process.argv.includes("--all");
  const addedBy = arg("--added-by");
  const slug = arg("--slug");
  const limit = Number(arg("--limit")) || 100000;
  const days = Number(arg("--days")) || undefined;
  const file = arg("--file");
  const slugs = file ? companiesFromCsv(readFileSync(file, "utf8")).companies.map((company) => company.slug) : null;
  const shard = arg("--shard")?.match(/^(\d+)\/(\d+)$/);
  const [part, parts] = shard ? [Number(shard[1]), Number(shard[2])] : [0, 1];
  if (part >= parts) throw new Error(`--shard ${part}/${parts}: k must be below n`);
  const since = arg("--skip-read-since") ? new Date(arg("--skip-read-since")!) : null;
  if (since && Number.isNaN(since.getTime())) throw new Error("--skip-read-since: not a date");
  const chosen = await db.company.findMany({
    where: {
      source: "workday",
      active: true,
      ...(addedBy ? { addedBy } : {}),
      ...(slug ? { slug } : {}),
      ...(slugs ? { slug: { in: slugs, mode: "insensitive" as const } } : {}),
      ...(all || slug || slugs ? {} : { nextFetchAt: { lte: new Date() } }),
      // Not read since, or read with an error (spelled out: a NOT over nullable columns drops the never-read rows).
      ...(since ? { OR: [{ lastFetchedAt: null }, { lastFetchedAt: { lt: since } }, { lastError: { not: null } }] } : {}),
    },
    // A fixed order (by id) when sharded, so every run splits the same list the same way.
    orderBy: shard ? { id: "asc" } : { nextFetchAt: "asc" },
    select: { id: true, slug: true, name: true },
  });
  // One row per CSV site: a site stored twice in different case ("External_Careers", "external_careers") is read once,
  // as the row spelled like the CSV when there is one.
  const pick = slugs
    ? new Set(
        slugs.flatMap((wanted) => {
          const row = chosen.find((company) => company.slug === wanted) ?? chosen.find((company) => company.slug.toLowerCase() === wanted.toLowerCase());
          return row ? [row.id] : [];
        }),
      )
    : null;
  const companies = chosen.filter((company) => !pick || pick.has(company.id)).filter((_, index) => index % parts === part).slice(0, limit);
  if (!companies.length) {
    console.log("ingest-workday-browser: no company to read");
    return;
  }
  const reader = await openStealthyBoardReader(shard ? `workday-ingest-${part}of${parts}` : "workday-ingest", {
    // The tenant's career site page: "/wday/cxs/{tenant}/{site}/…" → "https://{tenant}.{wdN}.myworkdayjobs.com/{site}".
    landing: (url) => {
      const site = url.pathname.match(/^\/wday\/cxs\/[^/]+\/([^/]+)/)?.[1];
      return site ? `${url.origin}/${site}` : `${url.origin}/`;
    },
  });
  if (!reader) {
    console.log("FAIL: the stealthy Chrome did not start (stealthy-browser.log says why)");
    process.exitCode = 1;
    return;
  }
  const runId = await startTickRun(companies.length);
  console.log(`ingest-workday-browser: ${companies.length} companies (${runId})`);
  const started = Date.now();
  const stats = { read: 0, unchanged: 0, failed: 0, refused: 0, fetched: 0, created: 0, createdIndia: 0, tiers: {} as Record<string, number> };
  const failures: string[] = [];
  try {
    for (const [index, company] of companies.entries()) {
      const at = Date.now();
      const result = await ingestOne(company.id, { runId, days, http: reader.http });
      if (!result) continue;
      stats.read += 1;
      stats.tiers[result.tier] = (stats.tiers[result.tier] ?? 0) + 1;
      const seconds = Math.round((Date.now() - at) / 1000);
      if (result.error) {
        stats.failed += 1;
        if (/\brefused\b/.test(result.error)) stats.refused += 1;
        failures.push(`${company.slug}: ${result.error.slice(0, 160)}`);
        console.log(`${index + 1}/${companies.length} ${company.slug} | FAILED ${result.error.slice(0, 120)} | ${result.tier} | ${seconds} s`);
        continue;
      }
      if (result.unchanged) stats.unchanged += 1;
      stats.fetched += result.fetched;
      stats.created += result.created;
      stats.createdIndia += result.createdEligible;
      console.log(`${index + 1}/${companies.length} ${company.slug} | ${result.fetched} listed | ${result.created} new | ${result.updated} changed${result.closed ? ` | ${result.closed} closed` : ""} | ${result.tier} | ${seconds} s`);
    }
  } finally {
    await reader.close();
  }
  const seconds = Math.round((Date.now() - started) / 1000);
  console.log(`read ${stats.read} companies in ${seconds} s: ${stats.fetched} listed, ${stats.created} new (${stats.createdIndia} India-eligible), ${stats.unchanged} unchanged, ${stats.failed} failed (${stats.refused} refused)`);
  console.log(`tiers after: ${Object.entries(stats.tiers).map(([tier, n]) => `${tier} ${n}`).join(", ")}`);
  console.log(`browser: ${reader.stats.origins} sites opened, ${reader.stats.requests} requests, ${reader.stats.refused} refused`);
  if (failures.length) console.log(`failures:\n  ${failures.join("\n  ")}`);
}

main()
  .catch((error) => {
    console.error("FAIL", error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
