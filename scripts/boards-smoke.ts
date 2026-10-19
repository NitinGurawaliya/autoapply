// T99: Workday and Zoho Recruit. Pure checks (slugs from addresses, dates, form hosts), then one live Workday tenant and
// one live Zoho Recruit portal fetched and ingested into Postgres. Both boards stay out of APPLY_BOARDS (hidden).
// npx tsx scripts/boards-smoke.ts [workdaySlug] [zohoSlug]
import { db } from "../src/lib/db";
import { formUrlAllowed } from "../src/modules/apply/urls";
import { APPLY_BOARDS, boardOf } from "../src/modules/jobs";
import { postedOnDate, workdaySlugOf } from "../src/modules/jobs/fetchers/workday";
import { zohoSlugOf } from "../src/modules/jobs/fetchers/zohorecruit";
import { ingestCompany } from "../src/modules/jobs/ingest";
import { indiaEligible } from "../src/modules/jobs/boards";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

const LIVE = [
  { source: "workday", slug: process.argv[2] || "browserstack.wd3/External", name: "BrowserStack" },
  { source: "zohorecruit", slug: process.argv[3] || "artingdigital.zohorecruit.in", name: "Arting Digital" },
];

async function main() {
  check("workday slug from a crawled address", workdaySlugOf(new URL("https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/US-CA/X_JR1")) === "nvidia.wd5/NVIDIAExternalCareerSite");
  check("workday slug without locale", workdaySlugOf(new URL("https://browserstack.wd3.myworkdayjobs.com/External")) === "browserstack.wd3/External");
  check("workday: not a career site", workdaySlugOf(new URL("https://www.myworkday.com/x")) === null && workdaySlugOf(new URL("https://acme.wd1.myworkdayjobs.com/wday/cxs/acme/x/jobs")) === null);
  check("zoho slug from a job address", zohoSlugOf(new URL("https://artingdigital.zohorecruit.in/jobs/Careers/1074/French")) === "artingdigital.zohorecruit.in");
  check("zoho slug of a portal not named Careers", zohoSlugOf(new URL("https://acme.zohorecruit.com/jobs/Openings")) === "acme.zohorecruit.com/Openings");
  const now = new Date("2026-10-18T10:00:00Z");
  check("Posted 3 Days Ago", postedOnDate("Posted 3 Days Ago", now)?.toISOString() === "2026-10-15T00:00:00.000Z");
  check("Posted 30+ Days Ago is older than 30 days", postedOnDate("Posted 30+ Days Ago", now)?.toISOString() === "2026-09-17T00:00:00.000Z");
  check("form hosts", formUrlAllowed("https://sprinklr.wd1.myworkdayjobs.com/careers/job/x", "workday") && formUrlAllowed("https://acme.zohorecruit.in/jobs/Careers/1/x", "zohorecruit") && !formUrlAllowed("https://evil.example.com/x", "workday") && !formUrlAllowed("https://acme.zohorecruit.in.evil.com/x", "zohorecruit"));
  check("neither board is applied to", !APPLY_BOARDS.includes("workday") && !APPLY_BOARDS.includes("zohorecruit"));

  for (const live of LIVE) {
    const board = boardOf(live.source)!;
    const t = Date.now();
    const fetched = await board.fetch(live.slug);
    const india = fetched.filter(indiaEligible);
    console.log(`${live.source} ${live.slug}: ${fetched.length} fetched, ${india.length} India-eligible, ${Math.round((Date.now() - t) / 1000)} s; e.g. ${india[0] ? `"${india[0].title}" | ${india[0].location} | ${india[0].postedAt.toISOString().slice(0, 10)} | ${india[0].description.length} chars | ${india[0].applyUrl}` : "none"}`);
    check(`${live.source}: live jobs with descriptions`, fetched.length > 0 && fetched.some((job) => job.description.length > 200));
    check(`${live.source}: apply addresses on the board's host`, fetched.every((job) => formUrlAllowed(job.applyUrl, live.source)));
    const discovered = await board.discovery!.open(live.slug);
    check(`${live.source}: discovery sees the board`, !!discovered && discovered.filter(board.discovery!.counts).length >= 1, `${discovered?.filter(board.discovery!.counts).length ?? 0} India jobs`);

    const company = await db.company.upsert({
      where: { source_slug: { source: live.source, slug: live.slug } },
      create: { source: live.source, slug: live.slug, name: live.name },
      update: {},
      select: { id: true, source: true, slug: true },
    });
    const result = await ingestCompany(company, Date.now() - 365 * 24 * 60 * 60 * 1000);
    const stored = await db.job.count({ where: { companyId: company.id, source: live.source, closedAt: null } });
    console.log(`${live.source} ingest: ${JSON.stringify(result)}; ${stored} open jobs in Postgres`);
    check(`${live.source}: jobs in Postgres`, !result.error && stored >= 1);
    const sample = await db.job.findFirst({ where: { companyId: company.id, closedAt: null }, select: { title: true, eligibility: true, country: true } });
    check(`${live.source}: stored jobs are India-eligible`, sample?.eligibility === "india" || sample?.eligibility === "remote_india", JSON.stringify(sample));
  }
  console.log(failed === 0 ? "PASS boards-smoke" : `FAIL boards-smoke (${failed})`);
}

main()
  .catch((error) => {
    console.error(error);
    failed += 1;
    console.log("FAIL boards-smoke");
  })
  .finally(() => db.$disconnect().then(() => process.exit(failed === 0 ? 0 : 1)));
