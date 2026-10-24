// "Select all that apply" answers (lib/choices.ts): several choices in one stored answer, one per line.
import { joinChoices, splitChoices } from "../src/lib/choices";

const checks: Array<[string, boolean]> = [
  ["one choice stays one", JSON.stringify(splitChoices("Full-time: 40 hrs/wk or more")) === JSON.stringify(["Full-time: 40 hrs/wk or more"])],
  ["two choices round-trip", JSON.stringify(splitChoices(joinChoices(["A, with a comma", "B"]))) === JSON.stringify(["A, with a comma", "B"])],
  ["blank lines and spaces dropped", JSON.stringify(splitChoices(" A \n\n B \n")) === JSON.stringify(["A", "B"])],
  ["empty answer has no choices", splitChoices("").length === 0],
  ["commas inside an option never split it", splitChoices("I use AI regularly, and review outputs").length === 1],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  if (!ok) failed += 1;
}
console.log(failed === 0 ? "PASS choices" : `FAIL choices (${failed})`);
process.exit(failed === 0 ? 0 : 1);
