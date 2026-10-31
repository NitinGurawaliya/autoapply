// Offline checks for the Keka board (T96): the phone split, pay as Keka wants it, and which addresses are Keka portals.
// npx tsx scripts/keka-test.ts
import { salaryAmount, splitPhone } from "../src/modules/apply/adapters/keka";
import { kekaAdapter } from "../src/modules/apply/adapters/keka";
import { kekaSlugOf } from "../src/modules/jobs/fetchers/keka";

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

console.log(failed === 0 ? "PASS keka" : `FAIL keka (${failed})`);
process.exit(failed === 0 ? 0 : 1);
