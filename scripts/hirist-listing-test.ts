// K17 (docs/hirist/TASKS.md#k17): Hirist's own search and job JSON → our Job fields, offline.
// Fixtures: tests/fixtures/hirist/{search,job}.json, the shape Hirist's pages fetched (scripts/hirist-probe.ts, 27 Nov) with invented companies.
// npx tsx scripts/hirist-listing-test.ts
import { readFileSync } from "node:fs";
import { adapterBoardOfHost } from "../src/modules/jobs/boards";
import { companyQuery, fromSearch, jobUrl, planSearches, searchUrl, withDetail } from "../src/modules/jobs/fetchers/hirist";
import { requiredYears, tagPosting } from "../src/modules/jobs/tagging";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

const search = JSON.parse(readFileSync("tests/fixtures/hirist/search.json", "utf8"));
const detail = JSON.parse(readFileSync("tests/fixtures/hirist/job.json", "utf8"));

// 1. A search page → listings, with how each is applied to.
const page = fromSearch(search, adapterBoardOfHost);
check("three listings read, the confidential one skipped", page.listings.length === 3 && page.skipped === 1, `${page.listings.length}/${page.skipped}`);
check("Hirist's own total kept", page.total === 4);
const [backend, data, qa] = page.listings;
check("Hirist's own Apply when no other site is named", backend.applyKind === "site" && backend.applyVia === null);
check("a job that applies on a Greenhouse form carries applyVia greenhouse", qa.applyKind === "board" && qa.applyVia === "greenhouse" && qa.applyUrl === "https://job-boards.greenhouse.io/betalabs/jobs/1", `${qa.applyKind}/${qa.applyVia}`);
const toElsewhere = structuredClone(search);
toElsewhere.data[2].applyUrl = "https://careers.example.test/apply/1";
check("a site we have no adapter for is not appliable (not stored)", fromSearch(toElsewhere, adapterBoardOfHost).listings[2].applyKind === "none");
const toLookalike = structuredClone(search);
toLookalike.data[2].applyUrl = "https://greenhouse.io.evil.example/betalabs";
check("a look-alike host is not a board", fromSearch(toLookalike, adapterBoardOfHost).listings[2].applyKind === "none");
const toHttp = structuredClone(search);
toHttp.data[2].applyUrl = "http://job-boards.greenhouse.io/betalabs/jobs/1";
check("plain http is not followed", fromSearch(toHttp, adapterBoardOfHost).listings[2].applyKind === "none");

// 2. Fields.
check("id, title and company", backend.externalId === "9100001" && backend.title === "Senior Backend Engineer" && backend.company.name === "Acme Software" && backend.company.slug === "7001");
check("the company's logo is kept only over https", backend.company.logoUrl === "https://img.example.test/acme.png" && qa.company.logoUrl === null);
check("the job page is the slug of company and title, then the id", backend.applyUrl === "https://www.hirist.tech/j/acme-software-senior-backend-engineer-9100001", backend.applyUrl);
check("a job-detail path from Hirist is used as given", jobUrl({ id: "1", title: "x", companyName: "y", jobDetailUrl: "/j/real-slug-1" }) === "https://www.hirist.tech/j/real-slug-1");
check("the place, and remote from Hirist's work-from-home flag", backend.location === "Pune" && backend.isRemote === false && data.location === "Bangalore" && data.isRemote === true);
check("posted time from the epoch milliseconds", backend.postedAt.getTime() === 1795753248424);
check("skills and years in the description, worded for the tagger", backend.description.includes("Key skills: Java, Spring Boot") && backend.description.includes("Hirist lists 5-8 years of experience."));
check("the tagger reads the lower bound of the years", requiredYears(backend.title, backend.description) === 5, String(requiredYears(backend.title, backend.description)));
check("pay is kept only when Hirist shows it", backend.raw.salary === null && data.raw.salary === "12-20", `${backend.raw.salary}/${data.raw.salary}`);
check("a malformed listing is skipped, the rest kept", fromSearch({ data: [{ id: 1 }, search.data[0]], totalJobs: 2 }, adapterBoardOfHost).listings.length === 1);
check("not a search response: nothing", fromSearch({ nope: true }, adapterBoardOfHost).listings.length === 0 && fromSearch(null, adapterBoardOfHost).total === null);

// 3. The job page adds the whole posting.
const full = withDetail(backend, detail, adapterBoardOfHost);
check("the whole description, tags as skills and the years", full.description.includes("Build payment APIs in Java.") && full.description.includes("Key skills: Java, Spring Boot, Kafka") && !full.description.includes("<p>"));
check("every place, once", JSON.stringify(full.offices) === JSON.stringify(["Pune", "Mumbai", "Noida"]), JSON.stringify(full.offices));
check("marked as read from the job page", full.raw.detailed === true && full.raw.expired === false);
check("a detail for another job changes nothing", withDetail(backend, { data: { ...detail.data, id: 5 } }, adapterBoardOfHost) === backend);
const detailElsewhere = structuredClone(detail);
detailElsewhere.data.applyUrl = "https://careers.example.test/apply/1";
check("a job page that sends the user to another site makes it unappliable", withDetail(backend, detailElsewhere, adapterBoardOfHost).applyKind === "none");
const tagged = tagPosting(full);
check("eligibility is read from the place", tagged.eligibility === "india", tagged.eligibility);

// 4. Searches and their URLs.
const planned = planSearches({ tracks: ["backend", "fullstack"], currentTitle: "Senior Java Developer", city: "Pune", yearsExperience: 3 }, 10);
check("a search per track phrase and the title, no place (Hirist has no place filter)", planned.length === 3 && planned.every((item) => item.location === null && item.experience === 3), planned.map((item) => item.keyword).join(" ; "));
check("a limit is respected", planSearches({ tracks: ["backend", "fullstack"], currentTitle: null, city: null, yearsExperience: null }, 1).length === 1);
check("page 1 has no number, years go as a window", searchUrl({ keyword: "backend developer", location: null, experience: 3 }, 1) === "https://www.hirist.tech/search/backend%20developer?minexp=2&maxexp=5", searchUrl({ keyword: "backend developer", location: null, experience: 3 }, 1));
check("a later page is numbered", searchUrl({ keyword: "data engineer", location: null, experience: null }, 2) === "https://www.hirist.tech/search/data%20engineer?page=2");
check("a company is searched by its first word, no years", searchUrl({ keyword: "Acme Software", location: null, experience: 3 }, 1, "company") === "https://www.hirist.tech/search/Acme");
check("a short first word takes the second as well", companyQuery("TCS Digital Ltd.") === "TCS Digital" && companyQuery("Cadence Design Systems") === "Cadence" && companyQuery("  ") === "");

console.log(failed === 0 ? "PASS hirist-listing-test" : `FAIL hirist-listing-test (${failed})`);
process.exit(failed === 0 ? 0 : 1);
