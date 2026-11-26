// Linking board accounts to employers (modules/jobs/employers.ts, docs/employers/TDD.md 4.6 and W3). Throwaway rows
// (names carry a stamp), deleted at the end. npx tsx scripts/employer-link-test.ts
import { db } from "../src/lib/db";
import { redirectDomain } from "../src/modules/jobs/company-facts";
import { displayName, linkCompany, refreshEmployer, refreshEmployerCounts, relinkDomains, setEmployerName, splitCompany } from "../src/modules/jobs/employers";

let failed = 0;
function ok(name: string, pass: boolean, detail = "") {
  if (!pass) failed += 1;
  console.log(`${pass ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

const stamp = Date.now();
const made: string[] = [];
let n = 0;
async function company(name: string, domain: string | null, extra: { source?: string; basis?: string; fetched?: Date | null; slug?: string } = {}) {
  n += 1;
  const row = await db.company.create({
    data: { source: extra.source ?? "mock", slug: extra.slug ?? `w3-${stamp}-${n}`, name, active: false, domain, domainBasis: domain ? (extra.basis ?? "board") : null, domainCheckedAt: new Date(), lastFetchedAt: extra.fetched === undefined ? new Date() : extra.fetched },
  });
  made.push(row.id);
  return row;
}
const employerOf = async (companyId: string) => {
  const row = await db.company.findUnique({ where: { id: companyId }, select: { employerId: true } });
  return row?.employerId ? db.employer.findUnique({ where: { id: row.employerId } }) : null;
};
const D = (label: string) => `${label}${stamp}.example.com`;

async function main() {
  try {
    // 1. Two rows, one domain: one employer, whatever the names.
    const a1 = await company(`W3T${stamp} Acme`, D("acme"), { source: "greenhouse" });
    const a2 = await company(`W3T${stamp} Acme Software Private Limited`, D("acme"), { source: "lever" });
    await linkCompany(a1.id);
    await linkCompany(a2.id);
    const e1 = await employerOf(a1.id);
    const e2 = await employerOf(a2.id);
    ok("1. two rows with one domain are one employer", Boolean(e1) && e1?.id === e2?.id);
    ok("1. its name is the plain one", e1?.name === `W3T${stamp} Acme`, e1?.name);

    // 2. Two Glides on different domains: two employers, both slugs free.
    const g1 = await company(`W3T${stamp} Glide`, D("glideapps"), { source: "ashby" });
    const g2 = await company(`W3T${stamp} Glide`, D("glide"), { source: "lever" });
    await linkCompany(g1.id);
    await linkCompany(g2.id);
    const ge1 = await employerOf(g1.id);
    const ge2 = await employerOf(g2.id);
    ok("2. same name, different domains: two employers", Boolean(ge1) && Boolean(ge2) && ge1?.id !== ge2?.id);
    ok("2. their slugs differ", ge1?.slug !== ge2?.slug, `${ge1?.slug} / ${ge2?.slug}`);

    // 3. No domain: a one-row employer, linking again keeps it.
    const lone = await company(`W3T${stamp} Lone`, null);
    ok("3. no domain creates a one-row employer", (await linkCompany(lone.id)) === "created");
    const loneEmployer = await employerOf(lone.id);
    ok("3. it has no domain", loneEmployer?.domain === null);
    ok("3. linking again keeps it", (await linkCompany(lone.id)) === "kept");

    // 4. That row finds a domain held by another employer: it joins, its old slug is an alias, its old employer is gone.
    const target = await company(`W3T${stamp} Target`, D("target"));
    await linkCompany(target.id);
    const targetEmployer = await employerOf(target.id);
    const wasAlone = await company(`W3T${stamp} Target Eng`, null);
    await linkCompany(wasAlone.id);
    const oldEmployer = await employerOf(wasAlone.id);
    await db.company.update({ where: { id: wasAlone.id }, data: { domain: D("target"), domainBasis: "board", domainCheckedAt: new Date() } });
    const outcome = await linkCompany(wasAlone.id);
    const nowEmployer = await employerOf(wasAlone.id);
    ok("4. the row joins the domain's employer", nowEmployer?.id === targetEmployer?.id, outcome);
    ok("4. its old employer is gone", (await db.employer.findUnique({ where: { id: oldEmployer?.id ?? "" } })) === null);
    const alias = await db.employerAlias.findUnique({ where: { slug: oldEmployer?.slug ?? "" } });
    ok("4. its old slug is an alias of the employer it joined", alias?.employerId === targetEmployer?.id);

    // 5. A one-row employer whose row gets a domain no one holds: same employer, slug unchanged.
    const grow = await company(`W3T${stamp} Grow`, null);
    await linkCompany(grow.id);
    const before = await employerOf(grow.id);
    await db.company.update({ where: { id: grow.id }, data: { domain: D("grow"), domainBasis: "job_links", domainCheckedAt: new Date() } });
    ok("5. a new domain is set on the lone employer", (await linkCompany(grow.id)) === "domain_set");
    const after = await employerOf(grow.id);
    ok("5. same employer and slug, now with the domain", after?.id === before?.id && after?.slug === before?.slug && after?.domain === D("grow") && after?.domainBasis === "job_links");

    // 6. A split survives a later link.
    const s1 = await company(`W3T${stamp} Split A`, D("split"));
    const s2 = await company(`W3T${stamp} Split B`, D("split"));
    await linkCompany(s1.id);
    await linkCompany(s2.id);
    const shared = await employerOf(s1.id);
    await splitCompany(s2.id);
    const apart = await employerOf(s2.id);
    ok("6. the split row has its own employer", Boolean(apart) && apart?.id !== shared?.id && apart?.domain === null);
    ok("6. the other row keeps the shared one", (await employerOf(s1.id))?.id === shared?.id);
    ok("6. linking the split row again keeps it apart", (await linkCompany(s2.id)) === "kept" && (await employerOf(s2.id))?.id === apart?.id);

    // 7. A Naukri row whose job redirects to a board we read joins that board's employer.
    // Greenhouse slugs are stored without hyphens (boardFromUrl normalises the address the same way).
    const gh = await company(`W3T${stamp} Redirected`, D("redirected"), { source: "greenhouse", slug: `w3${stamp}redirected` });
    await linkCompany(gh.id);
    const ghEmployer = await employerOf(gh.id);
    const naukri = await company(`W3T${stamp} Redirected Pvt Ltd`, null, { source: "naukri" });
    const now = new Date();
    await db.job.create({
      data: { source: "naukri", externalId: `w3-${stamp}-n`, companyId: naukri.id, title: "W3 job", location: "Pune", country: "IN", remoteType: "onsite", description: "x", applyUrl: `https://boards.greenhouse.io/${gh.slug}/jobs/1`, applyVia: "greenhouse", postedAt: now, fetchedAt: now, eligibility: "india", raw: {} },
    });
    // The apply link names the throwaway Greenhouse row's slug as its board, so the redirect finds that row.
    const viaRedirect = await redirectDomain(naukri.id);
    ok("7. redirectDomain reads the board row's domain", viaRedirect === D("redirected"), String(viaRedirect));
    await db.company.update({ where: { id: naukri.id }, data: { domain: viaRedirect, domainBasis: "redirect" } });
    await linkCompany(naukri.id);
    ok("7. the Naukri row is under the board's employer", (await employerOf(naukri.id))?.id === ghEmployer?.id);

    // 8. Counts: a fresh open public job counts; a Naukri job and a job of a company read 4 days ago do not.
    const open = await company(`W3T${stamp} Counted`, D("counted"));
    const stale = await company(`W3T${stamp} Stale`, D("stale"), { fetched: new Date(Date.now() - 4 * 24 * 3600 * 1000) });
    await linkCompany(open.id);
    await linkCompany(stale.id);
    const jobBase = { location: "Pune", country: "IN", remoteType: "onsite", description: "x", postedAt: now, fetchedAt: now, eligibility: "india", raw: {}, applyUrl: "https://example.com/j" };
    await db.job.createMany({
      data: [
        { ...jobBase, source: "greenhouse", externalId: `w3-${stamp}-o1`, companyId: open.id, title: "Open one" },
        { ...jobBase, source: "naukri", externalId: `w3-${stamp}-o2`, companyId: open.id, title: "Naukri one" },
        { ...jobBase, source: "greenhouse", externalId: `w3-${stamp}-o3`, companyId: stale.id, title: "Stale one" },
        { ...jobBase, source: "greenhouse", externalId: `w3-${stamp}-o4`, companyId: open.id, title: "Closed one", closedAt: now },
      ],
    });
    await refreshEmployerCounts();
    const counted = await employerOf(open.id);
    const staleEmployer = await employerOf(stale.id);
    ok("8. one open public job counts (not the Naukri or the closed one)", counted?.openJobs === 1 && counted?.openIndia === 1, `${counted?.openJobs}/${counted?.openIndia}`);
    ok("8. a company read 4 days ago counts none", staleEmployer?.openJobs === 0);

    // 10. relinkDomains, in bulk: one-row employers whose rows have since found a domain.
    const holder = await company(`W3T${stamp} Holder`, D("holder"));
    await linkCompany(holder.id);
    const holderEmployer = await employerOf(holder.id);
    const r1 = await company(`W3T${stamp} Later One`, null);
    const r2 = await company(`W3T${stamp} Later Two`, null);
    const r3 = await company(`W3T${stamp} Later Three`, null);
    for (const row of [r1, r2, r3]) await linkCompany(row.id);
    const oldSlugs = await Promise.all([r1, r2, r3].map(async (row) => (await employerOf(row.id))?.slug ?? ""));
    await db.company.update({ where: { id: r1.id }, data: { domain: D("later"), domainBasis: "board", domainCheckedAt: new Date() } });
    await db.company.update({ where: { id: r2.id }, data: { domain: D("later"), domainBasis: "job_links", domainCheckedAt: new Date() } });
    await db.company.update({ where: { id: r3.id }, data: { domain: D("holder"), domainBasis: "board", domainCheckedAt: new Date() } });
    const bulk = await relinkDomains();
    const l1 = await employerOf(r1.id);
    const l2 = await employerOf(r2.id);
    const l3 = await employerOf(r3.id);
    ok("10. two rows with a new shared domain end in one employer that holds it", Boolean(l1) && l1?.id === l2?.id && l1?.domain === D("later"), `${bulk.domainSet} set, ${bulk.joined} joined`);
    ok("10. a row whose domain another employer holds joins that employer", l3?.id === holderEmployer?.id);
    const aliasRows = await db.employerAlias.findMany({ where: { slug: { in: oldSlugs } } });
    const kept = oldSlugs.filter((slug) => slug === l1?.slug).length;
    ok("10. every employer a row left leaves its slug as an alias (the one that took the domain keeps its own)", aliasRows.length === oldSlugs.length - kept && aliasRows.every((row) => row.employerId === l1?.id || row.employerId === holderEmployer?.id), `${aliasRows.length} aliases, ${kept} kept`);

    // 9. An owner's name survives refreshEmployer; display names follow the rules.
    const named = await employerOf(a1.id);
    await setEmployerName(named?.slug ?? "", `W3T${stamp} Acme Corporation`);
    await refreshEmployer(named?.id ?? "");
    ok("9. an owner's name survives refreshEmployer", (await employerOf(a1.id))?.name === `W3T${stamp} Acme Corporation`);
    ok("displayName: the most common plain name", displayName([{ name: "Zeta Pvt Ltd", source: "lever" }, { name: "Zeta", source: "greenhouse" }, { name: "Zeta Inc", source: "ashby" }], "zeta.com") === "Zeta");
    ok("displayName: a tie goes to a self-named board, then the shortest", displayName([{ name: "Alpha Beta", source: "greenhouse" }, { name: "Alpha", source: "workable" }], null) === "Alpha");
    ok("displayName: generic names are dropped", displayName([{ name: "Careers", source: "zohorecruit" }, { name: "Orbit Labs", source: "lever" }], null) === "Orbit Labs");
    ok("displayName: nothing left, the domain's label", displayName([{ name: "Careers", source: "zohorecruit" }], "orbit.com") === "Orbit");
    ok("displayName: names that all differ but start with one word give that word", displayName([{ name: "Deloitte East Africa", source: "workable" }, { name: "DeloitteNZ", source: "smartrecruiters" }, { name: "DeloitteNordic", source: "smartrecruiters" }], "deloitte.com") === "Deloitte");
    ok("displayName: a shared start that cuts a word is not used", displayName([{ name: "Alphabet", source: "lever" }, { name: "Alphanumeric", source: "ashby" }], null) !== "Alpha");
    ok("displayName: a generic name with no domain falls back to the board slug's label", displayName([{ name: "Careers", source: "zohorecruit", slug: "abbott.zohorecruit.com" }], null) === "Abbott");
  } finally {
    await db.company.deleteMany({ where: { id: { in: made } } });
    const leftovers = await db.employer.findMany({ where: { OR: [{ slug: { contains: String(stamp) } }, { name: { contains: String(stamp) } }, { domain: { contains: String(stamp) } }] }, select: { id: true } });
    await db.employer.deleteMany({ where: { id: { in: leftovers.map((row) => row.id) } } });
  }
  console.log(failed === 0 ? "PASS employer-link-test" : `FAIL employer-link-test (${failed})`);
  await db.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
