// Board rows named by their board address, not a name (27 Nov): a discovered Workday tenant whose site named no hiring
// organisation kept its slug as its name ("mrisoftware.wd501/External_CareerSite"), and so did its employer, on the feed's
// All jobs cards and the company pages. Each such Company row gets a real name, then its employer is named again from its
// rows (refreshEmployer; an owner-named employer and its rows are left alone; slugs never change). The name, in order:
// the board's own (Zoho's org_info, Workday's hiring organisation when its site answers), the company Clearbit names for
// the row's or employer's domain, the owner's reading of the site id below, the tenant itself as a last resort.
// Dry run by default; --write stores.
//   npx tsx scripts/employers-board-names.ts [--write] [--all]   (--all: also employers with no open jobs)
import { db } from "../src/lib/db";
import { boardPageName } from "../src/modules/jobs/company-facts";
import { isBoardIdName } from "../src/modules/jobs/domains";
import { refreshEmployer } from "../src/modules/jobs/employers";
import { workdayName } from "../src/modules/jobs/fetchers/workday";
import { nameByDomain, nameByLabel, plainName } from "../src/modules/jobs/logos";

// Tenants whose site id names the business where neither the board nor a domain does (RTX's sites sit on tenant
// "globalhr"; Kaplan's on Graham Holdings' "ghc", whose stored domain ghc.health is another business).
const SITE_ID_NAMES: Record<string, string> = {
  "globalhr.wd5/rec_rtx_ext_gateway": "RTX",
  "globalhr.wd5/private_posting_no_tmp": "RTX",
  "ghc.wd1/kaplan_careers": "Kaplan",
  "epiqsystems.wd503/epiq_careers": "Epiq Systems",
};

const capital = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

async function main() {
  const write = process.argv.includes("--write");
  const rows = await db.company.findMany({
    where: { OR: [{ name: { contains: ".wd" } }, { name: { contains: "zohorecruit" } }, { name: { contains: "External_", mode: "insensitive" } }] },
    select: { id: true, source: true, slug: true, name: true, domain: true, employer: { select: { id: true, slug: true, name: true, nameBasis: true, domain: true, openJobs: true } } },
  });
  const everyWrong = rows.filter((row) => isBoardIdName(row.name));
  // Employers with open jobs are the ones shown; the rest (mostly Zoho portals with nothing listed) only with --all.
  const wrong = process.argv.includes("--all") ? everyWrong : everyWrong.filter((row) => (row.employer?.openJobs ?? 0) > 0);
  const employersBefore = new Set(wrong.filter((row) => row.employer && isBoardIdName(row.employer.name)).map((row) => row.employer!.id));
  const counts = { companiesWrongInDb: everyWrong.length, companiesInScope: wrong.length, employersWrong: employersBefore.size, ownerSkipped: 0, renamed: 0, byBoard: 0, byDomain: 0, bySiteId: 0, byTenant: 0 };
  const touched = new Set<string>();
  for (const row of wrong) {
    if (row.employer?.nameBasis === "owner") {
      counts.ownerSkipped += 1;
      continue;
    }
    let name: string | null = null;
    let basis = "";
    const board = row.source === "workday" ? await workdayName(row.slug).catch(() => null) : await boardPageName(row.source, row.slug);
    const cleaned = board ? plainName(board) || board : null;
    if (cleaned && !isBoardIdName(cleaned)) [name, basis] = [cleaned, "board"];
    for (const domain of [row.domain, row.employer?.domain]) {
      if (name || !domain) continue;
      const found = await nameByDomain(domain).catch(() => null);
      if (found && !isBoardIdName(found)) [name, basis] = [found, `domain ${domain}`];
    }
    const siteId = SITE_ID_NAMES[row.slug.toLowerCase()];
    if (siteId && (!name || basis !== "board")) [name, basis] = [siteId, "site id"];
    if (!name) {
      const byTenant = await nameByLabel(row.slug.split(/[./]/)[0] ?? "").catch(() => null);
      if (byTenant && !isBoardIdName(byTenant)) [name, basis] = [byTenant, "tenant name"];
    }
    if (!name) [name, basis] = [capital(row.slug.split(/[./]/)[0] ?? row.slug), "tenant"];
    counts.renamed += 1;
    if (basis === "board") counts.byBoard += 1;
    else if (basis === "site id") counts.bySiteId += 1;
    else if (basis === "tenant" || basis === "tenant name") counts.byTenant += 1;
    else counts.byDomain += 1;
    console.log(`${row.source}/${row.slug}  "${row.name}" -> "${name}"  (${basis}; employer ${row.employer?.slug ?? "-"}, ${row.employer?.openJobs ?? 0} open)`);
    if (write) {
      await db.company.update({ where: { id: row.id }, data: { name } });
      if (row.employer) touched.add(row.employer.id);
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  if (write) {
    // Employers still carrying a board address whose rows have names already (a stale name): named again from their rows.
    const stale = await db.employer.findMany({ where: { ...(process.argv.includes("--all") ? {} : { openJobs: { gt: 0 } }), OR: [{ name: { contains: ".wd" } }, { name: { contains: "zohorecruit" } }, { name: { contains: "External_", mode: "insensitive" } }] }, select: { id: true, name: true, nameBasis: true } });
    for (const employer of stale) {
      if (employer.nameBasis === "owner" || !isBoardIdName(employer.name)) continue;
      touched.add(employer.id);
      employersBefore.add(employer.id);
    }
    for (const id of touched) await refreshEmployer(id);
    const after = await db.employer.findMany({ where: { id: { in: [...employersBefore] } }, select: { slug: true, name: true } });
    for (const employer of after) console.log(`employer ${employer.slug} -> "${employer.name}"`);
    console.log(`employers still named by a board address: ${after.filter((employer) => isBoardIdName(employer.name)).length}`);
  }
  console.log(`${write ? "written" : "dry run"}: ${JSON.stringify(counts)}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
