// Phase M5: pay read from the boards' structured fields, and how it is written. Payload shapes recorded from live
// boards on 18 Nov (Ashby includeCompensation=true; Lever salaryRange). npx tsx scripts/salary-test.ts
import { ashbySalary, formatSalary, leverSalary } from "../src/modules/jobs/salary";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

const ashbyInr = {
  compensationTierSummary: "₹15L – ₹30L • Offers Bonus",
  summaryComponents: [
    { compensationType: "Salary", interval: "1 YEAR", currencyCode: "INR", minValue: 1500000, maxValue: 3000000 },
    { compensationType: "Bonus", interval: "1 YEAR", currencyCode: "INR", minValue: null, maxValue: null },
  ],
};
const ashbyUsd = { summaryComponents: [{ compensationType: "Salary", interval: "1 YEAR", currencyCode: "USD", minValue: 175000, maxValue: 225000 }] };
const ashbyEquityOnly = { summaryComponents: [{ compensationType: "EquityPercentage", interval: "NONE", currencyCode: null, minValue: 0.1, maxValue: 0.5 }] };
const leverMonthly = { currency: "USD", interval: "per-month-salary", min: 0, max: 1000 };

const inr = ashbySalary(ashbyInr);
check("Ashby INR salary component", inr?.min === 1500000 && inr.max === 3000000 && inr.currency === "INR" && inr.period === "year");
check("Ashby INR formats in lakhs", inr != null && formatSalary(inr) === "₹15L – ₹30L", inr ? String(formatSalary(inr)) : "");
const usd = ashbySalary(ashbyUsd);
check("Ashby USD formats with period", usd != null && formatSalary(usd) === "$175k – $225k / yr", usd ? String(formatSalary(usd)) : "");
check("Ashby without a Salary component is no pay", ashbySalary(ashbyEquityOnly) === null);
check("Ashby with no compensation is no pay", ashbySalary(undefined) === null && ashbySalary({}) === null);
const lever = leverSalary(leverMonthly);
check("Lever min 0 counts as no minimum", lever?.min === null && lever.max === 1000 && lever.period === "month");
check("Lever formats as Up to", lever != null && formatSalary(lever) === "Up to $1,000 / mo", lever ? String(formatSalary(lever)) : "");
check("Lever unknown interval is no pay", leverSalary({ currency: "USD", interval: "per-week", min: 1, max: 2 }) === null);

check("crore", formatSalary({ min: 8000000, max: 12000000, currency: "INR", period: "year" }) === "₹80L – ₹1.2Cr");
check("one figure", formatSalary({ min: 2000000, max: 2000000, currency: "INR", period: "year" }) === "₹20L");
check("from", formatSalary({ min: 800000, max: null, currency: "INR", period: "year" }) === "From ₹8L");
check("monthly INR keeps its period", formatSalary({ min: 50000, max: 80000, currency: "INR", period: "month" }) === "₹50k – ₹80k / mo");
check("euro", formatSalary({ min: null, max: 60000, currency: "EUR", period: "year" }) === "Up to €60k / yr");
check("unknown currency uses its code", formatSalary({ min: 100000, max: 120000, currency: "CHF", period: "year" }) === "CHF 100k – CHF 120k / yr");
check("nothing usable is null", formatSalary({ min: null, max: null, currency: "INR", period: "year" }) === null && formatSalary({ min: 5, max: 9, currency: null, period: "year" }) === null);

console.log(`${failed === 0 ? "PASS" : "FAIL"} salary-test`);
process.exit(failed === 0 ? 0 : 1);
