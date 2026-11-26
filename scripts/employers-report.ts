// Employers report (docs/employers/TDD.md 4.11). Read-only.
//   npx tsx scripts/employers-report.ts --coverage     per board: rows, rows with an open job, how many have a domain, by basis
//   npx tsx scripts/employers-report.ts                the coverage block, then employer totals and the lists for the owner's review
import { db } from "../src/lib/db";
import { plainName } from "../src/modules/jobs/logos";

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

const wordsOf = (name: string) => new Set(plainName(name).toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 2));
const squash = (name: string) => plainName(name).toLowerCase().replace(/[^a-z0-9]/g, "");
/** Whether two names share a word, or one contains the other ("razorpay" in "razorpaysoftware"). */
function related(a: string, b: string) {
  const wa = wordsOf(a);
  if ([...wordsOf(b)].some((word) => wa.has(word))) return true;
  const ka = squash(a);
  const kb = squash(b);
  return ka.length >= 3 && kb.length >= 3 && (ka.includes(kb) || kb.includes(ka));
}
const show = (lines: string[], max = 30) => {
  for (const line of lines.slice(0, max)) console.log(`  ${line}`);
  if (lines.length > max) console.log(`  ... and ${lines.length - max} more`);
  if (lines.length === 0) console.log("  (none)");
};

async function employers() {
  const [totals] = await db.$queryRaw<Array<{ employers: number; multi: number; with_domain: number; listed: number; open_jobs: number; open_india: number; aliases: number }>>`
    SELECT (SELECT count(*) FROM "Employer")::int AS employers,
      (SELECT count(*) FROM (SELECT "employerId" FROM "Company" WHERE "employerId" IS NOT NULL GROUP BY 1 HAVING count(*) > 1) m)::int AS multi,
      (SELECT count(*) FROM "Employer" WHERE domain IS NOT NULL)::int AS with_domain,
      (SELECT count(*) FROM "Employer" WHERE "openJobs" > 0)::int AS listed,
      (SELECT coalesce(sum("openJobs"), 0) FROM "Employer")::int AS open_jobs,
      (SELECT coalesce(sum("openIndia"), 0) FROM "Employer")::int AS open_india,
      (SELECT count(*) FROM "EmployerAlias")::int AS aliases`;
  console.log(`
EMPLOYERS ${JSON.stringify(totals)}`);
  const [unlinked] = await db.$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS n FROM "Company" WHERE "employerId" IS NULL`;
  console.log(`companies without an employer: ${unlinked?.n ?? 0}`);

  const rows = await db.$queryRaw<Array<{ employerId: string; ename: string; edomain: string | null; eslug: string; source: string; slug: string; name: string; domainBasis: string | null }>>`
    SELECT c."employerId", e.name AS ename, e.domain AS edomain, e.slug AS eslug, c.source, c.slug, c.name, c."domainBasis"
    FROM "Company" c JOIN "Employer" e ON e.id = c."employerId"
    WHERE c."employerId" IN (SELECT "employerId" FROM "Company" WHERE "employerId" IS NOT NULL GROUP BY 1 HAVING count(*) > 1)
    ORDER BY e.name, c.source`;
  const disagree: string[] = [];
  const byEmployer = new Map<string, typeof rows>();
  for (const row of rows) byEmployer.set(row.employerId, [...(byEmployer.get(row.employerId) ?? []), row]);
  for (const group of byEmployer.values()) {
    const odd = group.filter((row) => !related(row.name, group[0]!.ename) && !group.some((other) => other !== row && related(other.name, row.name)));
    if (odd.length > 0) disagree.push(`${group[0]!.edomain ?? "-"} "${group[0]!.ename}": ${odd.map((row) => `${row.source}/${row.slug} "${row.name}" (${row.domainBasis ?? "-"})`).join("; ")}`);
  }
  console.log(`
NAMES DISAGREE: rows joined by a domain whose name shares nothing with the employer's or its other rows (${disagree.length})`);
  show(disagree);

  const same = await db.$queryRaw<Array<{ nameKey: string; n: number; list: string }>>`
    SELECT "nameKey", count(*)::int AS n, string_agg(coalesce(domain, '(no domain)') || ' /' || slug, '  |  ' ORDER BY slug) AS list
    FROM "Employer" GROUP BY "nameKey" HAVING count(*) > 1 AND count(DISTINCT coalesce(domain, id)) > 1 ORDER BY count(*) DESC, "nameKey" LIMIT 200`;
  console.log(`
SAME NAME, OTHER DOMAIN: employers with one name key and different domains (${same.length}, first 200)`);
  show(same.map((row) => `${row.nameKey} x${row.n}: ${row.list}`));

  const lone = await db.$queryRaw<Array<{ name: string; slug: string; domain_employer: string; domain: string }>>`
    SELECT l.name, l.slug, d.slug AS domain_employer, d.domain
    FROM "Employer" l JOIN "Employer" d ON d."nameKey" = l."nameKey" AND d.domain IS NOT NULL
    WHERE l.domain IS NULL ORDER BY l.name LIMIT 200`;
  console.log(`
ONE-ROW EMPLOYERS WITH NO DOMAIN whose name equals a domain employer's (${lone.length}, first 200): candidates for employer-set.ts`);
  show(lone.map((row) => `${row.slug} (no domain) ~ ${row.domain_employer} ${row.domain}`));

  const naukri = await db.$queryRaw<Array<{ name: string; slug: string; domain: string | null; rows_in_employer: number }>>`
    SELECT c.name, c.slug, c.domain, (SELECT count(*)::int FROM "Company" o WHERE o."employerId" = c."employerId") AS rows_in_employer
    FROM "Company" c WHERE c.source = 'naukri' AND c."domainBasis" = 'redirect' ORDER BY c.name`;
  console.log(`
NAUKRI ROWS JOINED BY A REDIRECT (${naukri.length})`);
  show(naukri.map((row) => `${row.name} (${row.slug}) → ${row.domain}, ${row.rows_in_employer} rows in that employer`));

  const generic = await db.$queryRaw<Array<{ source: string; slug: string; name: string }>>`
    SELECT source, slug, name FROM "Company" WHERE lower(trim(name)) IN ('careers', 'career', 'jobs', 'job', 'career portal', 'careers page', 'job openings', 'current openings', 'openings', 'home', 'join us', '') ORDER BY source, slug`;
  console.log(`
GENERIC NAMES LEFT (${generic.length})`);
  show(generic.map((row) => `${row.source}/${row.slug} "${row.name}"`), 15);
}

async function main() {
  await coverage();
  if (!process.argv.includes("--coverage")) await employers();
  await db.$disconnect();
}

main().catch(async (error: unknown) => {
  console.error(error instanceof Error ? error.message : "report failed");
  await db.$disconnect();
  process.exit(1);
});
