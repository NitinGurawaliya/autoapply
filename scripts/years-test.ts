// The years a posting asks (tagging.ts requiredYears): ranges count from their lower bound, never their upper end
// (23 Nov: "Experience: 1–2 Years" read as 2). npx tsx scripts/years-test.ts
import { requiredYears } from "../src/modules/jobs/tagging";
const cases: Array<[string, number | null]> = [
  ["Experience: 1–2 Years Budget: 5–6 LPA Employment Type: Full-Time", 1],
  ["Experience: 1-2 Years", 1],
  ["Experience: 1-3 Associate - Product & AI Operations Location: Pune Experience: 1–2 Years Joining: Immediate", 1],
  ["1–2 years of experience in a Product-focused role", 1],
  ["Experience: 1 to 2 years", 1],
  ["Experience — 2—4 years in backend development", 2],
  ["5+ years of relevant experience", 5],
  ["3-5 years' experience", 3],
  ["experience of at least 4 years", 4],
  ["minimum 3 years", 3],
  ["7+ years designing systems", 7],
  ["Experience required: 3+", 3],
  ["We have 20+ years in business. 2 years of experience in Java.", 2],
  ["No years mentioned here", null],
];
let failed = 0;
for (const [text, want] of cases) {
  const got = requiredYears("Engineer", text);
  if (got !== want) failed += 1;
  console.log(`${got === want ? "ok  " : "FAIL"} ${got} (want ${want}) <= ${text.slice(0, 70)}`);
}
console.log(failed ? `FAIL years (${failed})` : "PASS years");
process.exit(failed ? 1 : 0);
