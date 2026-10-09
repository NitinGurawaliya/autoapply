import { matchKeyBySynonym } from "../src/modules/answers";

const cases: Array<[string, string]> = [
  ["Notice period (in days)", "notice_period"],
  ["Current CTC", "current_ctc"],
  ["LinkedIn Profile", "linkedin"],
  ["Are you legally authorized to work in the United States?", "work_authorization"],
  ["Do you now or will you in the future require sponsorship", "needs_sponsorship"],
  ["How did you hear about us?", "how_heard"],
  ["Gender", "gender"],
  ["Are you authorized to work in the country where the job is located?", "work_authorization"],
  ["Will you now or in the future require sponsorship for employment visa status in the country where the job is located?", "needs_sponsorship"],
  ["Country", "country"],
  ["Which country do you currently live in?", "country"],
];

let failed = false;
for (const [label, expected] of cases) {
  const got = matchKeyBySynonym(label);
  console.log(`${label} -> ${got}`);
  if (got !== expected) failed = true;
}

if (failed) {
  console.log("FAIL");
  process.exit(1);
}

console.log("PASS");
