// schema.org JobPosting data for a job's public page (src/lib/job-posting.ts, docs/employers/TDD.md 4.2, W7). Pure; no
// network, no database. npx tsx scripts/job-posting-test.ts
import { jobPostingJsonLd, postingIndexable, type PostingInput } from "../src/lib/job-posting";

let failed = 0;
function ok(name: string, pass: boolean, detail = "") {
  if (!pass) failed += 1;
  console.log(`${pass ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

const NOW = Date.parse("2026-11-27T12:00:00Z");
const day = 24 * 3600 * 1000;
const base: PostingInput = {
  title: "Backend Engineer, Payments",
  description: "Build the services that move money.\n\nYou will own services end to end.",
  location: "Bengaluru, Karnataka, India",
  remoteType: "onsite",
  country: "IN",
  eligibility: "india",
  kind: "full_time",
  postedAt: new Date("2026-11-25T08:00:00Z"),
  closedAt: null,
  source: "greenhouse",
  applyable: true,
  companyLastFetchedAt: new Date(NOW - 2 * 3600 * 1000),
  salaryMin: 1800000,
  salaryMax: 2400000,
  salaryCurrency: "INR",
  salaryPeriod: "year",
  company: { name: "Razorpay Software Private Limited", logoUrl: "https://example.com/logo.png" },
  employer: { name: "Razorpay", domain: "razorpay.com", logoUrl: "https://example.com/employer.png" },
};
const make = (patch: Partial<PostingInput>) => jobPostingJsonLd({ ...base, ...patch }, "https://app.example.com/j/razorpay-backend-engineer-abc", NOW);
const asRecord = (value: Record<string, unknown> | null) => value as Record<string, any> | null; // eslint-disable-line @typescript-eslint/no-explicit-any

// 1. An open Greenhouse job in Bengaluru with pay: every property Google requires, and it survives the page's escaping.
const full = asRecord(make({}));
ok("1. an open Greenhouse job has data", full !== null);
ok("1. @type, title, description, datePosted", full?.["@type"] === "JobPosting" && full?.title === base.title && full?.description === base.description.trim() && full?.datePosted === "2026-11-25T08:00:00.000Z");
ok("1. hiringOrganization is the employer, with site and logo", full?.hiringOrganization?.name === "Razorpay" && full?.hiringOrganization?.sameAs === "https://razorpay.com" && full?.hiringOrganization?.logo === "https://example.com/employer.png");
ok("1. jobLocation is a place with locality and country", full?.jobLocation?.address?.addressLocality === "Bengaluru" && full?.jobLocation?.address?.addressCountry === "IN");
ok("1. employmentType and baseSalary from the board's fields", full?.employmentType === "FULL_TIME" && full?.baseSalary?.currency === "INR" && full?.baseSalary?.value?.minValue === 1800000 && full?.baseSalary?.value?.maxValue === 2400000 && full?.baseSalary?.value?.unitText === "YEAR");
const escaped = JSON.stringify(full).replace(/</g, "\\u003c");
ok("1. the escaped script text parses back to the same data", JSON.stringify(JSON.parse(escaped)) === JSON.stringify(full));

// 2. Remote India: telecommute, India as the required country, no place.
const remote = asRecord(make({ remoteType: "remote", eligibility: "remote_india", country: "REMOTE", location: "Remote" }));
ok("2. remote India: TELECOMMUTE with India, no jobLocation", remote?.jobLocationType === "TELECOMMUTE" && remote?.applicantLocationRequirements?.name === "India" && remote?.jobLocation === undefined);

// 3-5. No data: closed, Naukri, a company not read in 3 days; and the page says so.
ok("3. a closed job has none", make({ closedAt: new Date(NOW - day) }) === null);
ok("4. a Naukri job has none", make({ source: "naukri" }) === null);
ok("4. nor a mock job", make({ source: "mock" }) === null);
ok("5. a company read 4 days ago has none", make({ companyLastFetchedAt: new Date(NOW - 4 * day) }) === null);
ok("5. nor one never read", make({ companyLastFetchedAt: null }) === null);
ok("5. a company read 2 days 23 hours ago still has", make({ companyLastFetchedAt: new Date(NOW - (3 * day - 3600 * 1000)) }) !== null);
ok("5. postingIndexable agrees with the builder", postingIndexable(base, NOW) && !postingIndexable({ ...base, source: "naukri" }, NOW) && !postingIndexable({ ...base, closedAt: new Date(NOW) }, NOW));
ok("5. a job the agent cannot apply to has none (its page does not show the description)", make({ applyable: false }) === null);

// 6-7. Fields the board did not give are left out, never guessed.
const unpaid = asRecord(make({ salaryMin: null, salaryMax: null, salaryCurrency: null, salaryPeriod: null }));
ok("6. no pay: no baseSalary", unpaid !== null && unpaid.baseSalary === undefined);
ok("6. pay without a period: no baseSalary", asRecord(make({ salaryPeriod: null }))?.baseSalary === undefined);
ok("7. a kind with no schema.org word (gig): no employmentType", asRecord(make({ kind: "gig" }))?.employmentType === undefined);
ok("7. contract is CONTRACTOR, internship INTERN", asRecord(make({ kind: "contract" }))?.employmentType === "CONTRACTOR" && asRecord(make({ kind: "internship" }))?.employmentType === "INTERN");
ok("7. no employer yet: the board's company name, no sameAs", asRecord(make({ employer: null }))?.hiringOrganization?.name === base.company.name && asRecord(make({ employer: null }))?.hiringOrganization?.sameAs === undefined);
ok("7. an http logo is not passed on", asRecord(make({ employer: { name: "Razorpay", domain: null, logoUrl: "http://example.com/x.png" }, company: { name: "R", logoUrl: null } }))?.hiringOrganization?.logo === undefined);
ok("7. a place we cannot name is no data (abroad, country unknown)", make({ country: "REMOTE", eligibility: "abroad", location: "Somewhere" }) === null);
ok("7. an empty description is no data", make({ description: "   " }) === null);

// 8. A description that tries to close the script tag cannot.
const hostile = asRecord(make({ description: "Great job </script><script>alert(1)</script>" }));
const text = JSON.stringify(hostile).replace(/</g, "\\u003c");
ok("8. no '<' survives in the script text", hostile !== null && !text.includes("<"));
ok("8. and it still reads back as the original text", JSON.parse(text).description === "Great job </script><script>alert(1)</script>");

console.log(failed === 0 ? "PASS job-posting-test" : `FAIL job-posting-test (${failed})`);
process.exit(failed === 0 ? 0 : 1);
