// Offline checks shared by the ATS adapters: closed-job wording, date inputs, form URLs and adapter choice.
// npx tsx scripts/adapters-test.ts
import { looksClosed, toDatePickerText } from "../src/modules/apply/adapters/common";
import { pickAdapter } from "../src/modules/apply/pick";
import { explainOutcome } from "../src/lib/explain";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

for (const text of ["Page not found The page you requested was not found", "This job is no longer available", "The job you are looking for is no longer open.", "Sorry, this position has been filled", "This posting has expired", "We can't find that page"]) {
  check(`closed: "${text.slice(0, 44)}"`, looksClosed(text));
}
for (const text of ["Apply for this job First Name Last Name Email Resume", "Software Engineer Location Bengaluru Apply now", "Submit application"]) {
  check(`open form text is not mistaken for closed: "${text.slice(0, 36)}"`, !looksClosed(text));
}
check("a closed job is explained to the user", explainOutcome("failed", "This job is no longer open.").headline === "This job is closed");

const now = new Date("2026-10-08T10:00:00Z");
check("ISO date becomes MM/DD/YYYY", toDatePickerText("2026-12-01", now) === "12/01/2026");
check("a written date is understood", toDatePickerText("15 Nov 2026", now) === "11/15/2026" && toDatePickerText("Nov 15, 2026", now) === "11/15/2026");
check("a plain number is days from now (a notice period)", toDatePickerText("30", now) === "11/07/2026" && toDatePickerText("7", now) === "10/15/2026");
check("words that are not a date are refused", toDatePickerText("Immediate", now) === null && toDatePickerText("ASAP", now) === null && toDatePickerText("", now) === null && toDatePickerText("2026-13-45", now) === null);

const lever = pickAdapter("https://jobs.lever.co/acme/abc", "lever");
const ashby = pickAdapter("https://jobs.ashbyhq.com/acme/abc", "ashby");
const gh = pickAdapter("https://stripe.com/jobs/search?gh_jid=1", "greenhouse");
check("each job source gets its own adapter", lever.source === "lever" && ashby.source === "ashby" && gh.source === "greenhouse");
check("a job from an unknown source falls back by its address", pickAdapter("https://jobs.ashbyhq.com/x/y").source === "ashby" && pickAdapter("https://jobs.lever.co/x/y").source === "lever");
check("the mock form always wins for its own address", pickAdapter("http://localhost:3000/mock/greenhouse", "greenhouse").source === "mock");

const job = (applyUrl: string) => ({ applyUrl, externalId: "99", companySlug: "acme" });
check("Lever form address ends in /apply, whatever the link looked like", ["https://jobs.lever.co/acme/abc", "https://jobs.lever.co/acme/abc/", "https://jobs.lever.co/acme/abc/apply", "https://jobs.lever.co/acme/abc?lever-source=x"].every((u) => lever.formUrl?.(job(u)) === "https://jobs.lever.co/acme/abc/apply"));
check("Ashby form address ends in /application", ["https://jobs.ashbyhq.com/acme/abc", "https://jobs.ashbyhq.com/acme/abc/application", "https://jobs.ashbyhq.com/acme/abc/application?utm=1"].every((u) => ashby.formUrl?.(job(u)) === "https://jobs.ashbyhq.com/acme/abc/application"));
check("Greenhouse builds its own hosted form address", gh.formUrl?.(job("https://stripe.com/jobs/search?gh_jid=99")) === "https://job-boards.greenhouse.io/embed/job_app?for=acme&token=99");
check("the EU Greenhouse board stays on the EU host", gh.formUrl?.(job("https://job-boards.eu.greenhouse.io/groww/jobs/1"))?.startsWith("https://job-boards.eu.greenhouse.io/") === true);

console.log(failed === 0 ? "PASS adapters" : `FAIL adapters (${failed})`);
process.exit(failed === 0 ? 0 : 1);
