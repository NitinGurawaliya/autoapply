// K2 (docs/naukri/TASKS.md#k2): Naukri's own search and job JSON → our Job fields, offline.
// Fixtures: tests/fixtures/naukri/{search,job}.json, Naukri's real responses as its public pages fetched them.
// npx tsx scripts/naukri-listing-test.ts
import { readFileSync } from "node:fs";
import { adapterBoardOfHost } from "../src/modules/jobs/boards";
import { fromSearch, planSearches, searchUrl, withDetail } from "../src/modules/jobs/fetchers/naukri";
import { requiredYears, tagPosting } from "../src/modules/jobs/tagging";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

const search = JSON.parse(readFileSync("tests/fixtures/naukri/search.json", "utf8"));
const detail = JSON.parse(readFileSync("tests/fixtures/naukri/job.json", "utf8"));

// 1. Search page → listings, with how each is applied to.
const page = fromSearch(search, adapterBoardOfHost);
check("three listings read, none skipped", page.listings.length === 3 && page.skipped === 0, `${page.listings.length}/${page.skipped}`);
check("Naukri's own total kept", page.total === 364);
const [infosys, broadridge, cisco] = page.listings;
check("Naukri's own Apply", infosys.applyKind === "naukri" && infosys.applyVia === null);
check("apply URL is Naukri's job page", infosys.applyUrl === "https://www.naukri.com/job-listings-women-s-hiring-for-full-stack-developers-infosys-bpm-bengaluru-2-to-3-years-301026015262");
check("Workday redirect is not appliable (not stored)", cisco.applyKind === "none", cisco.applyKind);

// The same Cisco listing sent to a Greenhouse form instead: stored, applied by the Greenhouse adapter.
const toGreenhouse = structuredClone(search);
toGreenhouse.jobDetails[2].applyRedirectUrl = "https://job-boards.greenhouse.io/cisco/jobs/123456";
const viaGreenhouse = fromSearch(toGreenhouse, adapterBoardOfHost).listings[2];
check("Greenhouse redirect carries applyVia greenhouse", viaGreenhouse.applyKind === "board" && viaGreenhouse.applyVia === "greenhouse", `${viaGreenhouse.applyKind}/${viaGreenhouse.applyVia}`);
check("its apply URL is the Greenhouse form", viaGreenhouse.applyUrl === "https://job-boards.greenhouse.io/cisco/jobs/123456");
const toLookalike = structuredClone(search);
toLookalike.jobDetails[2].applyRedirectUrl = "https://greenhouse.io.evil.example/cisco";
check("a look-alike host is not a board", fromSearch(toLookalike, adapterBoardOfHost).listings[2].applyKind === "none");
const toHttp = structuredClone(search);
toHttp.jobDetails[2].applyRedirectUrl = "http://job-boards.greenhouse.io/cisco/jobs/1";
check("plain http is not followed", fromSearch(toHttp, adapterBoardOfHost).listings[2].applyKind === "none");

// 2. Fields.
check("externalId is Naukri's job id", infosys.externalId === "301026015262");
check("posted date from createdDate (UTC ms)", infosys.postedAt.toISOString() === new Date(1793342941298).toISOString());
check("company from Naukri's group", infosys.company.slug === "191386" && infosys.company.name === "Infosys BPM" && infosys.company.logoUrl?.startsWith("https://img.naukimg.com/") === true);
check("skills and years reach the description", infosys.description.includes("Key skills: Hiring, Angular, Full Stack") && infosys.description.includes("2-3 years of experience"));
check("no markup left in the description", !/<[a-z/][^>]*>/i.test(infosys.description));
check("raw keeps listing fields only", infosys.raw.questionnaireIdPresent === true && !("ambitionBoxData" in infosys.raw));

// 3. Tags the feed reads.
const infosysTags = tagPosting(infosys);
check("Bengaluru is India-eligible", infosysTags.eligibility === "india" && infosysTags.country === "IN", `${infosysTags.eligibility}/${infosysTags.country}`);
const broadridgeTags = tagPosting(broadridge);
check("'Hybrid - Bengaluru' is hybrid in India", broadridgeTags.remoteType === "hybrid" && broadridgeTags.eligibility === "india", `${broadridgeTags.remoteType}/${broadridgeTags.eligibility}`);
check("years required read from Naukri's range", requiredYears(broadridge.title, broadridge.description) === 1, String(requiredYears(broadridge.title, broadridge.description)));

// 4. Detail page → full description, every place.
const listingForDetail = { ...infosys, externalId: "301026011205" };
const detailed = withDetail(listingForDetail, detail);
check("full description from the job page", detailed.description.includes("Assist in the design, development") && detailed.description.includes("Key skills: Java, C++, Python"));
check("every location from the job page", (detailed.offices ?? []).join("|") === "Hyderabad|Chennai|Bengaluru");
check("a detail for another job is ignored", withDetail(infosys, detail) === infosys);

// 5. Searches: from the user's tracks, title, city and years; the page a person would open.
const plan = planSearches({ tracks: ["backend", "fullstack"], currentTitle: "Software Engineer II", city: "Bengaluru", yearsExperience: 2.4 }, 3);
check("searches from tracks then title", plan.map((s) => s.keyword).join("|") === "backend developer|full stack developer|software engineer ii", plan.map((s) => s.keyword).join("|"));
check("limited to the run's budget", planSearches({ tracks: ["backend", "frontend", "devops", "qa"], currentTitle: null, city: null, yearsExperience: null }, 2).length === 2);
check("page 1 URL", searchUrl(plan[0], 1) === "https://www.naukri.com/backend-developer-jobs-in-bengaluru?experience=2&jobAge=7", searchUrl(plan[0], 1));
check("page 2 URL", searchUrl(plan[0], 2) === "https://www.naukri.com/backend-developer-jobs-in-bengaluru-2?experience=2&jobAge=7");
check("no city: all of India", searchUrl({ keyword: "data engineer", location: null, experience: null }, 1) === "https://www.naukri.com/data-engineer-jobs?jobAge=7");

// 6. Nothing guessed from a bad listing.
const broken = fromSearch({ jobDetails: [{ title: "No id" }, search.jobDetails[0]] }, adapterBoardOfHost);
check("a malformed listing is skipped, the rest kept", broken.listings.length === 1 && broken.skipped === 1);
check("not a search response: nothing", fromSearch({ message: "recaptcha required" }, adapterBoardOfHost).listings.length === 0);

console.log(failed === 0 ? "PASS naukri-listing-test" : `FAIL naukri-listing-test (${failed})`);
process.exitCode = failed === 0 ? 0 : 1;
