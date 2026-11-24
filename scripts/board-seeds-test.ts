// Board identifiers from addresses and hand-made lists (modules/jobs/boardSeeds.ts). No network, no database.
import { boardFromUrl, seedsFromText } from "../src/modules/jobs/boardSeeds";
import { allowedList } from "../src/modules/jobs/slugSources/lists";

const refused = (name: string) => {
  try {
    allowedList(name);
    return false;
  } catch {
    return true;
  }
};

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const checks: Array<[string, boolean]> = [
  ["greenhouse job page", same(boardFromUrl("https://boards.greenhouse.io/acme/jobs/123"), { source: "greenhouse", slug: "acme" })],
  ["greenhouse new host", same(boardFromUrl("https://job-boards.greenhouse.io/acme"), { source: "greenhouse", slug: "acme" })],
  ["greenhouse eu host", same(boardFromUrl("https://job-boards.eu.greenhouse.io/acme/jobs/1"), { source: "greenhouse", slug: "acme" })],
  ["greenhouse embed names the board in 'for'", same(boardFromUrl("https://boards.greenhouse.io/embed/job_board?for=Acme"), { source: "greenhouse", slug: "acme" })],
  ["lever job page, no scheme", same(boardFromUrl("jobs.lever.co/acme-labs/0b1c-uuid"), { source: "lever", slug: "acme-labs" })],
  ["ashby application page", same(boardFromUrl("https://jobs.ashbyhq.com/Acme/123/application"), { source: "ashby", slug: "acme" })],
  ["other hosts are not boards", boardFromUrl("https://example.com/acme") === null],
  ["api path is not a board", boardFromUrl("https://boards.greenhouse.io/v1/boards") === null],
  ["host with no board", boardFromUrl("https://jobs.lever.co/") === null],
  [
    "a CSV with URLs anywhere on the line",
    same(seedsFromText('name,url\nAcme,"https://jobs.lever.co/acme/1"\nBeta, https://jobs.ashbyhq.com/beta ; x\nnothing here').seeds, [
      { source: "lever", slug: "acme" },
      { source: "ashby", slug: "beta" },
    ]),
  ],
  ["bare identifiers count for the one ATS given", same(seedsFromText("acme\nbeta-co\n", "greenhouse").seeds.map((seed) => seed.slug), ["acme", "betaco"])],
  ["bare identifiers are ignored without an ATS", seedsFromText("acme\nbeta\n").seeds.length === 0],
  ["URLs are counted", seedsFromText("https://jobs.lever.co/a https://jobs.lever.co/b").urls === 2],
  // M3: boards known by their host.
  ["a Workday career site is tenant.wdN/site", JSON.stringify(boardFromUrl("https://23andme.wd5.myworkdayjobs.com/23")) === JSON.stringify({ source: "workday", slug: "23andme.wd5/23" })],
  ["a Workday address with a language keeps the site", boardFromUrl("https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/x")?.slug === "nvidia.wd5/NVIDIAExternalCareerSite"],
  ["a Keka careers page is its subdomain", JSON.stringify(boardFromUrl("https://abcoffee.keka.com/careers")) === JSON.stringify({ source: "keka", slug: "abcoffee" })],
  ["a Zoho Recruit portal is its host", boardFromUrl("https://artingdigital.zohorecruit.in/jobs/Careers")?.source === "zohorecruit"],
  ["a CSV row with a Workday URL", same(seedsFromText("23Andme,23andme/23,https://23andme.wd5.myworkdayjobs.com/23").seeds.map((seed) => `${seed.source}:${seed.slug}`), ["workday:23andme.wd5/23"])],
  ["a SmartRecruiters job page is its company identifier", same(seedsFromText("https://jobs.smartrecruiters.com/Freshworks/744000159090559-senior").seeds, [{ source: "smartrecruiters", slug: "Freshworks" }])],
  ["a Workable job page is its account", same(seedsFromText("https://apply.workable.com/zifo/j/6A9E892A52/").seeds, [{ source: "workable", slug: "zifo" }])],
  ["the MIT and CC BY lists are allowed", allowedList("ats-scrapers").licence === "MIT" && allowedList("upstreamit").licence === "MIT" && allowedList("latmay").licence === "CC-BY-4.0"],
  ["an unlicensed list passes only by the owner's recorded approval", allowedList("myjobb-company-names").ownerApproved?.startsWith("owner") === true],
  ["a non-commercial (CC BY-NC) list is refused", refused("feashliaa")],
  ["an unregistered list is refused", refused("some-new-list")],
  ["upstreamit's tenant|wdN|site lines are Workday slugs", same(seedsFromText("2020companies|wd1|external_careers\n23andme|wd5|23").seeds.map((seed) => seed.slug), ["2020companies.wd1/external_careers", "23andme.wd5/23"])],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  if (!ok) failed += 1;
}
console.log(failed === 0 ? "PASS board-seeds" : `FAIL board-seeds (${failed})`);
process.exit(failed === 0 ? 0 : 1);
