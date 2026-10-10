// Offline checks for the one-time sponsorship answer (modules/apply/sponsorship.ts): a sponsorship question on a job
// outside the candidate's home country asks "Do you need visa sponsorship to work in any country other than India?"
// once, then reuses Yes / No for every country; "It depends" and home-country jobs keep the per-country question.
// npx tsx scripts/sponsorship-test.ts
import { customQuestionKey } from "../src/modules/answers";
import { resolveValues } from "../src/modules/apply";
import type { FormField } from "../src/modules/apply";
import { homeCountryCode, outsideHome, SPONSORSHIP_ABROAD_KEY } from "../src/modules/apply/sponsorship";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}
const profile = { fullName: "Test User", email: "t@example.com", phone: "123", city: "Mohali", country: "India", linkedin: null, github: null, portfolio: null, yearsExperience: 1, currentTitle: "Dev", currentCompany: "Acme", resumeKey: "resumes/u/resume.pdf" };
const sponsor = (label: string, options = ["Yes", "No"]): FormField => ({ selector: `[name="${label}"]`, label, type: "select", required: true, options });
const toronto = { company: "MongoDB", country: "OTHER" };
const us = { company: "Okta", country: "US" };
const india = { company: "Razorpay", country: "IN" };
const remote = { company: "GitLab", country: "REMOTE" };
const q = sponsor("Will you now or in the future require employment sponsorship?");
const run = (field: FormField, job: { company: string; country: string }, answers: Array<{ key: string; answer: string; source: string }>) =>
  resolveValues([{ field, key: "needs_sponsorship" }], profile, answers, undefined, undefined, job);

check("home country codes", homeCountryCode("India") === "IN" && homeCountryCode("United States") === "US" && homeCountryCode("USA") === "US" && homeCountryCode("Canada") === null);
check("which jobs are abroad", outsideHome("India", "OTHER") && outsideHome("India", "US") && !outsideHome("India", "IN") && !outsideHome("India", "REMOTE") && !outsideHome("Canada", "OTHER") && !outsideHome(null, "US"));

const first = run(q, toronto, []);
check("a job abroad asks the one-time question instead of this country's", first.pending.length === 1 && first.pending[0].key === SPONSORSHIP_ABROAD_KEY && /other than India\?$/.test(first.pending[0].label), first.pending[0]?.label);
check("the one-time question offers Yes, No and It depends", JSON.stringify(first.pending[0]?.options) === JSON.stringify(["Yes", "No", "It depends on the country"]));

const yes = [{ key: SPONSORSHIP_ABROAD_KEY, answer: "Yes", source: "user" }];
const filled = run(q, toronto, yes);
check("with Yes, a Toronto job is answered Yes as the user's own answer", filled.values[0]?.value === "Yes" && filled.values[0]?.source === "user" && filled.pending.length === 0, JSON.stringify(filled.values[0]));
check("and says why", /need visa sponsorship outside India/.test(filled.values[0]?.basis ?? ""), filled.values[0]?.basis);
const usJob = run(sponsor("Will you now or in the future need visa sponsorship to work in the United States?"), us, yes);
check("the same answer serves a US job in any wording", usJob.values[0]?.value === "Yes");
const reworded = run(sponsor("Do you require sponsorship?", ["Yes, I will require sponsorship", "No, I will not require sponsorship"]), us, yes);
check("it is placed on the form's own wording of Yes", reworded.values[0]?.value === "Yes, I will require sponsorship", JSON.stringify(reworded.values[0] ?? reworded.unfit));

const no = run(q, toronto, [{ key: SPONSORSHIP_ABROAD_KEY, answer: "No", source: "user" }]);
check("with No, it is answered No", no.values[0]?.value === "No");

const depends = run(q, toronto, [{ key: SPONSORSHIP_ABROAD_KEY, answer: "It depends on the country", source: "user" }]);
check("with It depends, this country's question is asked", depends.pending.length === 1 && depends.pending[0].key === customQuestionKey(q.label), depends.pending[0]?.key);

const home = run(q, india, yes);
check("a job in the home country never uses it", home.values.length === 0 && home.pending[0]?.key === customQuestionKey(q.label));
const anywhere = run(q, remote, yes);
check("nor does a remote job (no country to compare)", anywhere.values.length === 0 && anywhere.pending[0]?.key === customQuestionKey(q.label));

const own = run(q, toronto, [...yes, { key: customQuestionKey(q.label), answer: "No", source: "user" }]);
check("the user's answer to this exact question still wins", own.values[0]?.value === "No");

const optional = resolveValues([{ field: { ...q, required: false }, key: "needs_sponsorship" }], profile, [], undefined, undefined, toronto);
check("an optional sponsorship question does not ask the one-time question", optional.pending.length === 0);

console.log(failed === 0 ? "PASS sponsorship" : `FAIL sponsorship (${failed})`);
process.exit(failed === 0 ? 0 : 1);
