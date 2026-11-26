// The public company pages over HTTP, signed out (src/app/companies, docs/employers/TDD.md 4.9, W6). Throwaway employers
// and jobs (names carry a stamp), deleted at the end. Start the app first, then:
//   BASE=http://localhost:3000 npx tsx scripts/company-pages-smoke.ts
import { db } from "../src/lib/db";
import { companyPagesEnabled } from "../src/lib/company-pages-gate";
import { refreshEmployerCounts } from "../src/modules/jobs/employers";

const BASE = (process.env.BASE ?? "http://localhost:3000").replace(/\/$/, "");
let failed = 0;
function ok(name: string, pass: boolean, detail = "") {
  if (!pass) failed += 1;
  console.log(`${pass ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}
async function get(path: string, manual = false) {
  const response = await fetch(`${BASE}${path}`, { redirect: manual ? "manual" : "follow", headers: { "user-agent": "company-pages-smoke" } });
  return { status: response.status, location: response.headers.get("location"), body: await response.text() };
}

async function main() {
  const stamp = Date.now();
  const now = new Date();
  const ids = { employers: [] as string[], companies: [] as string[], jobs: [] as string[] };
  const employer = async (key: string, domain: string | null) => {
    const row = await db.employer.create({ data: { slug: `w6-${key}-${stamp}`, name: `W6 ${key} ${stamp}`, nameKey: `w6${key}${stamp}`, domain } });
    ids.employers.push(row.id);
    return row;
  };
  const company = async (tag: string, employerId: string, source = "mock") => {
    const row = await db.company.create({ data: { source, slug: `w6-${stamp}-${tag}`, name: `W6 Co ${tag} ${stamp}`, active: false, employerId, lastFetchedAt: now } });
    ids.companies.push(row.id);
    return row;
  };
  const job = async (companyId: string, tag: string, source: string, title: string, eligibility = "india") => {
    const row = await db.job.create({
      data: { source, externalId: `w6-${stamp}-${tag}`, companyId, title, location: "Bengaluru", country: eligibility === "india" ? "IN" : "US", remoteType: "onsite", description: "Fixture", applyUrl: `https://${source}.example.com/${tag}`, postedAt: now, fetchedAt: now, eligibility, raw: {} },
    });
    ids.jobs.push(row.id);
    return row;
  };
  try {
    const multi = await employer("multi", `w6multi${stamp}.example.com`);
    const gh = await company("gh", multi.id);
    const lever = await company("lever", multi.id);
    const naukriCo = await company("nk", multi.id, "naukri");
    await job(gh.id, "g1", "greenhouse", `W6 Greenhouse Role ${stamp}`);
    await job(lever.id, "l1", "lever", `W6 Lever Role ${stamp}`);
    await job(lever.id, "l2", "lever", `W6 Abroad Role ${stamp}`, "abroad");
    await job(naukriCo.id, "n1", "naukri", `W6 NAUKRI ONLY JOB ${stamp}`);
    const naukriOnly = await employer("naukrionly", null);
    const nk2 = await company("nk2", naukriOnly.id, "naukri");
    await job(nk2.id, "n2", "naukri", `W6 Naukri Alone ${stamp}`);
    const merged = await employer("merged", null);
    await db.employerAlias.create({ data: { slug: `w6-old-${stamp}`, employerId: multi.id } });
    ids.employers.push(merged.id);
    await refreshEmployerCounts();

    const index = await get("/companies");
    ok("/companies answers 200 with letter links", index.status === 200 && index.body.includes("/companies/browse/"), String(index.status));
    ok("/companies/browse/w answers 200 and lists the employer", (await get("/companies/browse/w")).body.includes(`W6 multi ${stamp}`));
    ok("/companies/browse/%2E is a 404", (await get("/companies/browse/%2E")).status === 404);
    ok("/companies/browse/ab is a 404", (await get("/companies/browse/ab")).status === 404);

    const page = await get(`/companies/w6-multi-${stamp}`);
    ok("the multi-board employer's page answers 200", page.status === 200, String(page.status));
    ok("it lists a job from each of two boards", page.body.includes(`W6 Greenhouse Role ${stamp}`) && page.body.includes(`W6 Lever Role ${stamp}`));
    ok("it names both boards", /Hires through (Greenhouse and Lever|Lever and Greenhouse)/.test(page.body.replace(/<!-- -->/g, "")), "board line");
    ok("the job outside India is listed apart", page.body.includes(`W6 Abroad Role ${stamp}`) && page.body.includes("Outside India"));
    ok("a Naukri job of the same employer is not on it", !page.body.includes("NAUKRI ONLY JOB"));
    ok("it carries Organization data", page.body.includes('"@type":"Organization"') && page.body.includes(`https://w6multi${stamp}.example.com`));
    ok("its jobs link to their own pages with ?s=co (share pages on)", /href="\/j\/[^"]*\?s=co"/.test(page.body));

    ok("a Naukri-only employer is a 404", (await get(`/companies/w6-naukrionly-${stamp}`)).status === 404);
    const everything = [index, page, await get("/companies/browse/w")].map((r) => r.body).join("\n");
    ok("no response mentions naukri.com", !/naukri\.com/i.test(everything));

    const alias = await get(`/companies/w6-old-${stamp}`, true);
    ok("an old slug answers 308 to the live one", alias.status === 308 && (alias.location ?? "").endsWith(`/companies/w6-multi-${stamp}`), `${alias.status} ${alias.location}`);
    ok("an unknown slug is a 404", (await get("/companies/no-such-company-w6")).status === 404);
    ok("a slug with a dot never reaches a page", (await get("/companies/x.y")).status === 404);
    ok("an employer with no open public job is a 404", (await get(`/companies/w6-merged-${stamp}`)).status === 404);

    // The gate (unit check): COMPANY_PAGES wins; unset follows NODE_ENV.
    const env = process.env as Record<string, string | undefined>;
    const saved = { pages: env.COMPANY_PAGES, node: env.NODE_ENV };
    env.COMPANY_PAGES = "0";
    const off = companyPagesEnabled();
    env.COMPANY_PAGES = "1";
    const on = companyPagesEnabled();
    delete env.COMPANY_PAGES;
    env.NODE_ENV = "production";
    const prod = companyPagesEnabled();
    env.NODE_ENV = "development";
    const dev = companyPagesEnabled();
    env.COMPANY_PAGES = saved.pages;
    env.NODE_ENV = saved.node;
    if (saved.pages === undefined) delete env.COMPANY_PAGES;
    ok("the gate: 0 is off, 1 is on, unset is off in production and on in development", !off && on && !prod && dev, `${off} ${on} ${prod} ${dev}`);
  } finally {
    await db.job.deleteMany({ where: { id: { in: ids.jobs } } });
    await db.company.deleteMany({ where: { id: { in: ids.companies } } });
    await db.employer.deleteMany({ where: { id: { in: ids.employers } } });
  }
  console.log(failed === 0 ? "PASS company-pages-smoke" : `FAIL company-pages-smoke (${failed})`);
  await db.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
