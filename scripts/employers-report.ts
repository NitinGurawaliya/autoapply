// Employers report (docs/employers/TDD.md 4.11). Read-only.
//   npx tsx scripts/employers-report.ts --coverage     per board: rows, rows with an open job, how many have a domain, by basis
// W3 adds the employer totals and the lists for the owner's review below the coverage block.
import { db } from "../src/lib/db";

async function coverage() {
  // "Listing": the row has a stored open job, the rows that become pages (lastFetchCount also counts abroad jobs we do not store).
  const rows = await db.$queryRaw<
    Array<{ source: string; rows: number; active: number; checked: number; listing: number; listing_domain: number; with_domain: number; board: number; redirect: number; job_links: number; name_evidence: number; owner: number; generic: number }>
  >`
    WITH o AS (SELECT DISTINCT "companyId" FROM "Job" WHERE "closedAt" IS NULL)
    SELECT source,
      count(*)::int AS rows,
      count(*) FILTER (WHERE active)::int AS active,
      count(*) FILTER (WHERE "domainCheckedAt" IS NOT NULL)::int AS checked,
      count(o."companyId")::int AS listing,
      count(o."companyId") FILTER (WHERE domain IS NOT NULL)::int AS listing_domain,
      count(*) FILTER (WHERE domain IS NOT NULL)::int AS with_domain,
      count(*) FILTER (WHERE "domainBasis" = 'board')::int AS board,
      count(*) FILTER (WHERE "domainBasis" = 'redirect')::int AS redirect,
      count(*) FILTER (WHERE "domainBasis" = 'job_links')::int AS job_links,
      count(*) FILTER (WHERE "domainBasis" = 'name_evidence')::int AS name_evidence,
      count(*) FILTER (WHERE "domainBasis" = 'owner')::int AS owner,
      count(*) FILTER (WHERE lower(trim(name)) IN ('careers', 'career', 'jobs', 'job', 'career portal', 'careers page', 'job openings', 'current openings', 'openings', 'home', 'join us', ''))::int AS generic
    FROM "Company" c LEFT JOIN o ON o."companyId" = c.id GROUP BY source ORDER BY rows DESC`;
  const pct = (part: number, whole: number) => (whole === 0 ? "-" : `${Math.round((part / whole) * 100)}%`);
  console.log("COVERAGE (listing = the row has a stored open job)");
  console.table(
    rows.map((r) => ({
      board: r.source,
      rows: r.rows,
      checked: r.checked,
      listing: r.listing,
      "listing with domain": `${r.listing_domain} (${pct(r.listing_domain, r.listing)})`,
      "all with domain": `${r.with_domain} (${pct(r.with_domain, r.rows)})`,
      board_field: r.board,
      redirect: r.redirect,
      job_links: r.job_links,
      name_evidence: r.name_evidence,
      owner: r.owner,
      "generic names": r.generic,
    })),
  );
  const total = rows.reduce((sum, r) => ({ listing: sum.listing + r.listing, listing_domain: sum.listing_domain + r.listing_domain, checked: sum.checked + r.checked, rows: sum.rows + r.rows, generic: sum.generic + r.generic }), { listing: 0, listing_domain: 0, checked: 0, rows: 0, generic: 0 });
  console.log(`TOTAL rows ${total.rows}, checked ${total.checked}, listing ${total.listing}, listing with a domain ${total.listing_domain} (${pct(total.listing_domain, total.listing)}), generic names ${total.generic}`);
}

async function main() {
  const onlyCoverage = process.argv.includes("--coverage");
  await coverage();
  if (!onlyCoverage) console.log("(employer totals and review lists arrive with W3)");
  await db.$disconnect();
}

main().catch(async (error: unknown) => {
  console.error(error instanceof Error ? error.message : "report failed");
  await db.$disconnect();
  process.exit(1);
});
