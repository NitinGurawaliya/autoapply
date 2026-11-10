// Workable (M12): the form JSON → fields, and account slugs from addresses. No network, no database.
// npx tsx scripts/workable-test.ts
import { fromWorkable } from "../src/modules/apply/adapters/workable";
import { workableSlugOf } from "../src/modules/jobs/fetchers/workable";

// The shape of apply.workable.com/api/v1/jobs/<shortcode>/form (Zifo and Apna forms, 10 Nov), trimmed.
const FORM = [
  {
    name: "Personal information",
    fields: [
      { id: "firstname", label: "First name", required: true, type: "text" },
      { id: "lastname", label: "Last name", required: true, type: "text" },
      { id: "email", label: "Email", required: true, type: "email" },
      { id: "headline", label: "Headline", required: false, type: "text" },
      { id: "phone", label: "Phone", required: true, type: "phone" },
      { id: "address", label: "Address", required: true, type: "text", value: "Jhajjar, India", prefilledByLocation: true },
    ],
  },
  {
    name: "Profile",
    fields: [
      { id: "education", label: "Education", required: false, type: "group", fields: [{ id: "school", label: "School", required: true, type: "text" }] },
      { id: "summary", label: "Summary", required: false, type: "paragraph" },
      { id: "resume", label: "Resume", required: true, type: "file" },
    ],
  },
  {
    name: "Details",
    fields: [
      { id: "cover_letter", label: "Cover letter", required: false, type: "paragraph" },
      { id: "QA_1", label: "What is your notice period?", required: true, type: "paragraph" },
      { id: "QA_2", label: "What is your expected CTC?", required: true, type: "number" },
      { id: "QA_3", label: "Are you an Immediate Joiner?", required: true, type: "boolean" },
      { id: "QA_4", label: "How soon can you join?", required: true, type: "multiple", singleOption: false, options: [{ name: "1", value: "Immediately" }, { name: "2", value: "Within 30 days" }] },
      { id: "QA_5", label: "Preferred shift", required: false, type: "multiple", singleOption: true, options: [{ name: "3", value: "Day" }, { name: "4", value: "Night" }] },
    ],
  },
];

const fields = fromWorkable(FORM);
const by = (label: string) => fields.find((field) => field.label === label);
const throws = (body: unknown) => {
  try {
    fromWorkable(body);
    return false;
  } catch {
    return true;
  }
};

const checks: Array<[string, boolean]> = [
  ["the fixed fields carry their answer keys", by("First name")?.hintKey === "first_name" && by("Email")?.hintKey === "email" && by("Address")?.hintKey === "city"],
  ["the phone box is the one beside the country picker", by("Phone")?.selector === "#input_phone" && by("Phone")?.hintKey === "phone"],
  ["the resume is the resume field's file input", by("Resume")?.type === "file" && by("Resume")?.selector === 'input[type=file][data-ui="resume"], [data-ui="resume"] input[type=file]'],
  ["optional headline, summary and lists are left out", !by("Headline") && !by("Summary") && !by("Education")],
  ["the cover letter stays, as the cover_letter key", by("Cover letter")?.hintKey === "cover_letter" && by("Cover letter")?.type === "textarea"],
  ["a paragraph question is a textarea", by("What is your notice period?")?.type === "textarea" && by("What is your notice period?")?.selector === '[name="QA_1"]'],
  ["a number question is typed as text", by("What is your expected CTC?")?.type === "text"],
  ["a yes/no question is a radio with Yes and No", by("Are you an Immediate Joiner?")?.type === "radio" && JSON.stringify(by("Are you an Immediate Joiner?")?.options) === '["Yes","No"]'],
  ["a multiple choice is a checkbox group with its options", by("How soon can you join?")?.type === "checkbox-group" && by("How soon can you join?")?.options?.length === 2 && by("How soon can you join?")?.selector === '[data-ui="QA_4"]'],
  ["a single-option choice is a radio", by("Preferred shift")?.type === "radio" && by("Preferred shift")?.required === false],
  ["a required Education list stops the run (cannot be filled yet)", throws([{ name: "Profile", fields: [{ id: "education", label: "Education", required: true, type: "group", fields: [] }] }])],
  ["an account address is its slug", workableSlugOf(new URL("https://apply.workable.com/zifo/j/6A9E892A52/")) === "zifo"],
  ["a job address with no account is not a slug", workableSlugOf(new URL("https://apply.workable.com/j/6A9E892A52/apply")) === null],
  ["an account subdomain is its slug", workableSlugOf(new URL("https://apna.workable.com")) === "apna" && workableSlugOf(new URL("https://jobs.workable.com/search")) === null],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  if (!ok) failed += 1;
}
console.log(failed === 0 ? "PASS workable-test" : `FAIL workable-test (${failed})`);
process.exit(failed === 0 ? 0 : 1);
