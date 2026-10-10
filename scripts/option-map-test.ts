// T53: re-wording a known answer onto a form's own options. Offline: the resolver reports answers it could not place,
// uses a mapping only when the option is really on the form, and records why. Live: the model maps re-wordings and
// refuses changes of fact. npx tsx scripts/option-map-test.ts
import type { FormField } from "../src/modules/apply";
import { mapToOptions } from "../src/modules/apply/optionMap";
import { optionKey, resolveValues } from "../src/modules/apply/valueResolver";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

const PROFILE = { fullName: "Test Person", email: "t@example.com", phone: null, city: null, country: null, linkedin: null, github: null, portfolio: null, yearsExperience: 2, currentTitle: null, currentCompany: null, resumeKey: "resumes/x/resume.pdf" };
const notice: FormField = { selector: "#np", label: "What is your notice period?", type: "select", required: true, options: ["Immediately", "15 days", "1 month", "2 months"] };
const answers = [{ key: "notice_period", answer: "30 days", source: "user" }];

async function main() {
  const before = resolveValues([{ field: notice, key: "notice_period" }], PROFILE, answers);
  check("an answer that fits no option is asked and reported as unfit", before.values.length === 0 && before.pending.length === 1 && before.unfit[0]?.answer === "30 days" && before.unfit[0]?.sensitive === true, JSON.stringify(before.unfit));
  const mapped = resolveValues([{ field: notice, key: "notice_period" }], PROFILE, answers, undefined, new Map([[optionKey(notice.label, "30 days"), "1 month"]]));
  check("a mapping onto a real option fills it, keeping the source and saying why", mapped.values[0]?.value === "1 month" && mapped.values[0]?.source === "user" && /30 days/.test(mapped.values[0]?.basis ?? "") && mapped.pending.length === 0);
  const bogus = resolveValues([{ field: notice, key: "notice_period" }], PROFILE, answers, undefined, new Map([[optionKey(notice.label, "30 days"), "6 weeks"]]));
  check("a mapping to something not on the form is ignored", bogus.values.length === 0 && bogus.pending.length === 1);
  // A number with a unit in exactly one range of that unit is placed by code, before any model call.
  const ctc: FormField = { selector: "#ctc", label: "Expected CTC", type: "select", required: true, options: ["0-5 LPA", "5-10 LPA", "10-15 LPA", "15+ LPA"] };
  const inRange = resolveValues([{ field: ctc, key: "expected_ctc" }], PROFILE, [{ key: "expected_ctc", answer: "12 LPA", source: "user" }]);
  check("'12 LPA' is placed in '10-15 LPA' without the model", inRange.values[0]?.value === "10-15 LPA" && inRange.unfit.length === 0, JSON.stringify(inRange.values[0] ?? inRange.unfit));
  const edge = resolveValues([{ field: ctc, key: "expected_ctc" }], PROFILE, [{ key: "expected_ctc", answer: "10 LPA", source: "user" }]);
  check("a number on the edge of two ranges is not guessed by code", edge.values.length === 0 && edge.unfit.length === 1);

  const items = [
    { label: "Notice period", answer: "30 days", options: ["Immediately", "15 days", "1 month", "2 months", "3 months"], key: "notice_period", sensitive: true },
    { label: "Work authorization", answer: "Yes, I am authorized to work", options: ["Authorized", "Need sponsorship"], key: "work_authorization", sensitive: true },
    { label: "Gender", answer: "Man", options: ["Male", "Female", "Non-binary", "Decline to self-identify"], key: "gender", sensitive: true },
    { label: "Expected CTC", answer: "12 LPA", options: ["0-5 LPA", "5-10 LPA", "10-15 LPA", "15+ LPA"], key: "expected_ctc", sensitive: true },
    { label: "How did you hear about us?", answer: "Grace Hopper Celebration", options: ["LinkedIn", "Company website", "Referral", "Job board"], key: "q_aaaaaaaaaaaa", sensitive: false },
    { label: "Where did you hear about this role?", answer: "Grace Hopper Celebration", options: ["LinkedIn", "Company website", "Referral", "Other"], key: "q_bbbbbbbbbbbb", sensitive: false },
    { label: "What is your notice period (days)?", answer: "60 days", options: ["Immediately", "15 days", "1 month"], key: "notice_period", sensitive: true },
  ];
  const result = await mapToOptions(items);
  const got = (i: number) => result.get(optionKey(items[i].label, items[i].answer));
  check("'30 days' becomes '1 month'", got(0) === "1 month", got(0));
  check("'Yes, I am authorized to work' becomes 'Authorized'", got(1) === "Authorized", got(1));
  check("'Man' becomes 'Male'", got(2) === "Male", got(2));
  check("'12 LPA' falls in '10-15 LPA'", got(3) === "10-15 LPA", got(3));
  check("an event not listed and no 'Other' option: not mapped", got(4) === undefined, got(4));
  check("an event not listed with an 'Other' option: 'Other'", got(5) === "Other", got(5));
  check("'60 days' with no option that says so: not mapped (never a different fact)", got(6) === undefined, got(6));
  console.log(failed ? `FAIL option-map (${failed})` : "PASS option-map");
  process.exit(failed ? 1 : 0);
}

main();
