// Offline checks for the Keka board (T96): the phone split, pay as Keka wants it, and which addresses are Keka portals.
// npx tsx scripts/keka-test.ts
import { salaryAmount, splitPhone } from "../src/modules/apply/adapters/keka";
import { fieldsFromSchema, kekaAdapter } from "../src/modules/apply/adapters/keka";
import { looksLikeLink } from "../src/modules/apply/valueResolver";
import { kekaSlugOf } from "../src/modules/jobs/fetchers/keka";
import { historyValue } from "../src/modules/apply/history";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

const codes = ["+1", "+1-684", "+44", "+91", "+971"];
const p1 = splitPhone("+91 98765 43210", codes);
check("+91 number splits into code and number", p1.code === "+91" && p1.number === "9876543210", JSON.stringify(p1));
const p2 = splitPhone("98765 43210", codes);
check("a bare 10-digit number is Indian", p2.code === "+91" && p2.number === "9876543210", JSON.stringify(p2));
const p3 = splitPhone("919876543210", codes);
check("91 and 10 digits is Indian", p3.code === "+91" && p3.number === "9876543210", JSON.stringify(p3));
const p4 = splitPhone("+1-684 555 0100", codes);
check("the longest code wins (+1-684 before +1)", p4.code === "+1-684" && p4.number === "5550100", JSON.stringify(p4));
const p5 = splitPhone("+971 50 123 4567", codes);
check("+971 is not +97 or +9", p5.code === "+971" && p5.number === "501234567", JSON.stringify(p5));

check("'12' (lakhs, as onboarding saves it) is 12,00,000", salaryAmount("12") === "1200000");
check("'12 LPA' is 12,00,000", salaryAmount("12 LPA") === "1200000");
check("'6.5 lakhs' is 6,50,000", salaryAmount("6.5 lakhs") === "650000");
check("'1.2 Cr' is 1,20,00,000", salaryAmount("1.2 Cr") === "12000000");
check("a full amount stays", salaryAmount("1,200,000") === "1200000");
check("no number, no amount", salaryAmount("negotiable") === null);

check("a careers address names its company", kekaSlugOf(new URL("https://jupiter.keka.com/careers/jobdetails/145340")) === "jupiter");
check("Keka's own hosts are not companies", kekaSlugOf(new URL("https://www.keka.com/careers")) === null && kekaSlugOf(new URL("https://help.keka.com/careers")) === null);
check("an address outside /careers is not a portal", kekaSlugOf(new URL("https://jupiter.keka.com/hrms")) === null);

check("the adapter takes Keka application forms only", kekaAdapter.matches("https://jupiter.keka.com/careers/applyjob/145340") && !kekaAdapter.matches("https://jobs.ashbyhq.com/x/y") && !kekaAdapter.matches("https://evil.com/?u=jupiter.keka.com/careers/"));
check("the listing address becomes the form", kekaAdapter.formUrl?.({ applyUrl: "https://hr.keka.com/careers/jobdetails/145383", externalId: "hr:145383", companySlug: "hr" }) === "https://hr.keka.com/careers/applyjob/145383");

// Work history, education and skills rows (history.ts): from the resume only, dates as Keka's pickers show them.
const resume = {
  experience: [{ title: "Backend Intern", company: "Acme", start: "June 2025", end: "Present" }],
  education: [{ school: "JUIT", degree: "B.Tech in Computer Science", year: "2022 – 2026" }],
  skills: ["Python", "React", " "],
};
const at = (id: string) => historyValue(`[id="${id}"]`, resume)?.value ?? null;
check("company and title from the latest role", at("companyName_0") === "Acme" && at("designation_0") === "Backend Intern");
check("a current role is ticked and has no end month", at("isCurrentlyWorking_0") === "Yes" && at("dateOfRelieving_0") === null);
check("start month as Keka shows it", at("experienceDateOfJoining_0") === "June 2025", String(at("experienceDateOfJoining_0")));
check("degree, branch and university", at("degree_0") === "B.Tech in Computer Science" && at("branch_0") === "Computer Science" && at("university_0") === "JUIT");
check("a year-only date is left out", historyValue('[id="experienceDateOfJoining_0"]', { experience: [{ title: "x", company: "y", start: "2023" }] }) === null);
check("skills one per line, blanks dropped", at("skills") === "Python\nReact");
check("no skills on the resume: nothing", historyValue('[id="skills"]', { skills: [] }) === null);

// Keka's field types decide the kind (fieldsFromSchema), as 406 forms showed them on 1 Nov.
const field = (identifier: string, fieldType: number, required = true, options: string[] = []) => ({ identifier, fieldName: identifier, fieldType, required, fieldOptions: options.map((value) => ({ value })) });
const kinds = fieldsFromSchema(
  [field("a1", 2), field("a2", 4, true, ["A", "B"]), field("a3", 5, true, ["Yes", "No"]), field("a4", 10), field("a5", 6), field("a6", 9), field("locationPreference", 3), field("middleName", 1, false)],
  null,
  "acme",
).map((f) => `${f.label}:${f.type}`);
check("long text, tick boxes, one choice, link, date, number", kinds.slice(0, 6).join(" ") === "a1:textarea a2:checkbox-group a3:radio a4:url a5:date a6:number", kinds.join(" "));
check("Preferred Location is kept per company", kinds.includes("Preferred Location:select") === false && kinds.includes("locationPreference (acme):select"), kinds.join(" "));
check("an optional middle name is left out", !kinds.some((k) => k.startsWith("middleName")));
let stopped = "";
try {
  fieldsFromSchema([field("additionalDocuments", 8)], null, "acme");
} catch (error) {
  stopped = error instanceof Error ? error.message : "";
}
check("required documents stop the form", /cannot answer yet/.test(stopped));
check("a required question missing from the page stops it", (() => {
  try {
    fieldsFromSchema([field("guid-1", 1)], [{ id: "guid-1", present: false }], "acme");
    return false;
  } catch {
    return true;
  }
})());

// A link field takes a link only (valueResolver.ts).
check("links: with and without a scheme", looksLikeLink("https://github.com/x") && looksLikeLink("linkedin.com/in/x") && looksLikeLink("www.x.dev"));
check("not links: a word, a sentence", !looksLikeLink("Yes") && !looksLikeLink("Careers Website") && !looksLikeLink("see my site"));

console.log(failed === 0 ? "PASS keka" : `FAIL keka (${failed})`);
process.exit(failed === 0 ? 0 : 1);
