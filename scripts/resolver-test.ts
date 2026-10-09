// Offline checks for how answers are resolved against a form. npx tsx scripts/resolver-test.ts
import { customQuestionKey } from "../src/modules/answers";
import { resolveValues } from "../src/modules/apply";
import type { FormField } from "../src/modules/apply";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}
const profile = { fullName: "Test User", email: "t@example.com", phone: "123", city: "Mohali", country: "India", linkedin: null, github: null, portfolio: null, yearsExperience: 1, currentTitle: "Dev", currentCompany: "Acme", resumeKey: "resumes/u/resume.pdf" };
const field = (label: string, over: Partial<FormField> = {}): FormField => ({ selector: `[name="${label}"]`, label, type: "textarea", required: true, ...over });
const why = field("What excites you about Fam?");

// Essay questions (T55): without the one-time permission it is asked first; with "No" the essay is asked under its
// own key; a "why us" answer is reused for the same company (here the question names it).
const permission = resolveValues([{ field: why, key: "free_text" }], profile, []);
check("an essay question first asks the one-time drafting permission", permission.pending.length === 1 && permission.pending[0].key === "accept_ai_essays", permission.pending[0]?.key);
const asked = resolveValues([{ field: why, key: "free_text" }], profile, [{ key: "accept_ai_essays", answer: "No", source: "user" }]);
check("a free-text question is asked under its own key", asked.pending.length === 1 && asked.pending[0].key === customQuestionKey(why.label) && asked.pending[0].key !== "free_text", asked.pending[0]?.key);

const saved = resolveValues([{ field: why, key: "free_text" }], profile, [{ key: customQuestionKey(why.label), answer: "Because X", source: "user" }], undefined, undefined, { company: "Fam" });
check("its own saved answer is used", saved.values.length === 1 && saved.values[0].value === "Because X" && saved.pending.length === 0);

const otherCompany = field("Why do you want to work at Meesho?");
const shared = resolveValues([{ field: otherCompany, key: "free_text" }], profile, [{ key: "free_text", answer: "Old answer for another company", source: "user" }, { key: customQuestionKey(why.label), answer: "Because X", source: "user" }]);
check("an answer saved for one company's question is never reused for another's", shared.values.length === 0 && shared.pending.length === 1, `${shared.values.length} values`);

const optional = resolveValues([{ field: field("Anything else?", { required: false }), key: "free_text" }], profile, []);
check("an optional free-text question is left blank, not asked", optional.values.length === 0 && optional.pending.length === 0);

const generic = field("Additional information", { required: true });
const reused = resolveValues([{ field: generic, key: "free_text" }], profile, [{ key: "free_text", answer: "A general note", source: "user" }]);
check("the canonical additional-information field still reuses its saved answer", reused.values[0]?.value === "A general note");
const mockField = field("Why do you want this job?", { selector: "#free_text" });
const mockSaved = resolveValues([{ field: mockField, key: "free_text" }], profile, [{ key: "free_text", answer: "From the bank", source: "user" }]);
check("a field whose id is the canonical key keeps using it (the mock form)", mockSaved.values[0]?.value === "From the bank");

const select = field("Notice Period", { type: "select", options: ["Immediate", "7 - 15 days", "30 days"] });
const fit = resolveValues([{ field: select, key: "notice_period" }], profile, [{ key: "notice_period", answer: "7", source: "user" }]);
check("a plain number picks the option range that holds it", fit.values[0]?.value === "7 - 15 days", fit.values[0]?.value);

const radio = field("Ready to relocate?", { type: "radio", options: ["Yes", "No", "Already in Bangalore"] });
const miss = resolveValues([{ field: radio, key: "willing_to_relocate" }], profile, [{ key: "willing_to_relocate", answer: "Maybe", source: "user" }]);
check("an answer that is not one of the form's options is asked again with those options", miss.values.length === 0 && miss.pending[0]?.options?.length === 3);

const cover = resolveValues([{ field: field("Cover letter"), key: "cover_letter" }], profile, [{ key: "cover_letter", answer: "My letter", source: "user" }]);
check("a saved cover letter is still reused", cover.values[0]?.value === "My letter");

const location = resolveValues([{ field: field("Current location", { type: "location", required: false }), key: "city" }], profile, []);
check("the required flag travels with the value", location.values[0]?.required === false && location.values[0]?.value === "Mohali");

console.log(failed === 0 ? "PASS resolver" : `FAIL resolver (${failed})`);
process.exit(failed === 0 ? 0 : 1);
