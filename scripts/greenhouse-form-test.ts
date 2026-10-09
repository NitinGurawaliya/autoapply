// Greenhouse form shapes that used to fail on live forms, offline: checkbox groups (Stripe countries, Twilio "how did
// you hear"), one-box acknowledgements, radio groups, number inputs (education years) and the required-field check
// before Submit. Markup copied from the real hosted forms; no network, nothing submitted.
// npx tsx scripts/greenhouse-form-test.ts
import { chromium } from "playwright";
import { matchKeyBySynonym } from "../src/modules/answers";
import { NoRetryError } from "../src/modules/apply/adapter";
import type { ResolvedValue } from "../src/modules/apply/adapter";
import { greenhouseAdapter, missingRequired } from "../src/modules/apply/adapters/greenhouse";
import { resolveValues } from "../src/modules/apply/valueResolver";
import { explainOutcome } from "../src/lib/explain";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

const group = (id: string, legend: string, options: string[]) =>
  `<fieldset class="checkbox" id="${id}[]" aria-required="true"><legend class="label checkbox__description">${legend} <span class="required">*</span></legend>` +
  options
    .map((option, i) => `<div class="checkbox__wrapper"><div class="checkbox__input"><input required="" type="checkbox" id="${id}[]_${i}" name="${id}[]" aria-invalid="false" value="${i}"/></div><label for="${id}[]_${i}">${option}</label></div>`)
    .join("") +
  "</fieldset>";

const FORM = `<form id="application-form">
  <label id="first_name-label" for="first_name">First Name<span aria-hidden="true">*</span></label>
  <input id="first_name" type="text" aria-required="true" aria-invalid="false" />
  ${group("question_1", "Please select the country or countries you anticipate working in for the role in which you are applying.", ["Australia", "India", "Brazil"])}
  ${group("question_2", "How did you hear about Twilio?", ["Careers Website", "LinkedIn", "Twitter"])}
  ${group("question_3", "By clicking the &quot;Acknowledge&quot; button, you acknowledge that Twilio processes data in accordance with the Twilio Applicant Privacy Policy.", ["Acknowledge"])}
  <fieldset aria-required="true"><legend>Are you 18 or older?</legend>
    <label><input type="radio" name="question_4" value="1" /> Yes</label><label><input type="radio" name="question_4" value="0" /> No</label>
  </fieldset>
  <label id="question_5-label" for="question_5">Total years of experience*</label><input id="question_5" type="number" aria-required="true" />
  <label id="start-year--0-label" for="start-year--0">Start date year</label><input id="start-year--0" aria-label="Start date year" aria-required="false" type="number" />
  <label id="q_combo-label" for="q_combo">Office preference*</label>
  <div class="select__control"><div class="select__value-container"><div class="select__placeholder">Select...</div><input id="q_combo" role="combobox" type="text" aria-required="true" aria-labelledby="q_combo-label" /></div></div>
  <div style="display:none"><label for="question_6">Which visa do you hold?*</label><input id="question_6" type="text" aria-required="true" /></div>
  <button type="submit" onclick="event.preventDefault(); window.clicked = true">Submit application</button>
</form>`;

const PROFILE = { fullName: "Test Person", email: "t@example.com", phone: null, city: "Bengaluru", country: "India", linkedin: null, github: null, portfolio: null, yearsExperience: 3, currentTitle: null, currentCompany: null, resumeKey: "resumes/x/resume.pdf" };

async function rejects(run: () => Promise<unknown>) {
  try {
    await run();
    return null;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.setContent(FORM);
    const fields = await greenhouseAdapter.inspect(page);
    const byLabel = (start: string) => fields.find((f) => f.label.startsWith(start));

    const countries = byLabel("Please select the country");
    check("a checkbox group is one question with its boxes as options", countries?.type === "checkbox-group" && countries.required && countries.options?.join("|") === "Australia|India|Brazil", JSON.stringify(countries));
    check("no box is read as a question of its own", !fields.some((f) => / — /.test(f.label) || ["Australia", "LinkedIn", "Acknowledge"].includes(f.label)), fields.map((f) => f.label).join(" / "));
    const ack = byLabel("By clicking");
    check("a one-box acknowledgement is a required checkbox named by its legend", ack?.type === "checkbox" && ack.required === true);
    const radio = byLabel("Are you 18");
    check("a radio group is read with its options", radio?.type === "radio" && radio.required && radio.options?.join("|") === "Yes|No", JSON.stringify(radio));
    check("number inputs keep their type", byLabel("Total years")?.type === "number" && byLabel("Start date year")?.type === "number");

    const mapped = fields.map((field) => ({ field, key: matchKeyBySynonym(field.label) }));
    const answers = [{ key: "start_date", answer: "Immediate", source: "user" }, { key: "years_experience", answer: "3 years", source: "user" }];
    const { values, pending } = resolveValues(mapped, PROFILE, answers);
    const value = (start: string) => values.find((v) => v.label.startsWith(start));
    const asked = (start: string) => pending.find((q) => q.label.startsWith(start));
    check("the country group gets the profile country as one of its options", value("Please select the country")?.value === "India");
    check("a default that is not one of the boxes asks instead of unticking them", !value("How did you hear") && asked("How did you hear")?.options?.includes("LinkedIn") === true);
    check("the acknowledgement is asked, never ticked on the candidate's behalf", !value("By clicking") && asked("By clicking")?.options?.join("|") === "Yes|No");
    check("a number field takes the number out of the answer", value("Total years")?.value === "3");
    check("an optional number field skips a non-number answer instead of typing it", !value("Start date year") && !asked("Start date year"));

    // Before anything is filled: every empty required question is named, hidden ones are not.
    const before = await missingRequired(page);
    const want = ["First Name", "Please select the country", "How did you hear", "By clicking", "Are you 18", "Total years", "Office preference"];
    check("every empty required question is found before Submit", want.every((w) => before.some((m) => m.startsWith(w))), before.join(" / "));
    check("a question the form hides is not counted", !before.some((m) => m.startsWith("Which visa")));
    check("an optional field is not counted", !before.some((m) => m.startsWith("Start date year")));

    const error = await rejects(() => greenhouseAdapter.submit(page, { requestCode: async () => null }));
    check("Submit is never pressed while a required question is empty", error instanceof NoRetryError && /needs these filled before it will submit: First Name/.test(error.message) && !(await page.evaluate(() => (window as unknown as { clicked?: boolean }).clicked)), error?.message);
    check("the user is told nothing was sent and what to answer", /Nothing was sent/.test(explainOutcome("failed", error?.message ?? "").next ?? ""));

    // The user answers what was asked; fill everything.
    const answered: ResolvedValue[] = pending.filter((q) => !q.label.startsWith("Which visa")).map((q) => {
      const field = fields.find((f) => f.label === q.label)!;
      const reply = q.label.startsWith("How did you hear") ? "LinkedIn" : q.label.startsWith("By clicking") ? "Yes" : q.label.startsWith("Are you 18") ? "Yes" : "x";
      return { key: q.key, label: q.label, value: reply, source: "user", selector: field.selector, type: field.type, required: true };
    });
    const toFill = [...values, ...answered].filter((v) => v.type !== "combobox");
    const filled = await greenhouseAdapter.fill(page, toFill);
    const ticked = await page.evaluate(() => Array.from(document.querySelectorAll("input:checked")).map((el) => (el as HTMLInputElement).name + ":" + (el as HTMLInputElement).value));
    check("only the chosen box of each group is ticked", ticked.sort().join(" ") === ["question_1[]:1", "question_2[]:1", "question_3[]:0", "question_4:1"].sort().join(" "), ticked.join(" "));
    check("the filled list records the option label", filled.find((f) => f.label.startsWith("Please select the country"))?.value === "India" && filled.find((f) => f.label.startsWith("Are you 18"))?.value === "Yes");
    check("the number field holds the number", (await page.locator("#question_5").inputValue()) === "3");

    const groupError = await rejects(() => greenhouseAdapter.fill(page, [{ ...toFill.find((v) => v.label.startsWith("Please select the country"))!, value: "Japan" }]));
    check("an answer that fits no box asks the user with the live options", groupError?.name === "Error" && "question" in (groupError as object) && (groupError as unknown as { question: { options: string[] } }).question.options.includes("Brazil"), groupError?.message);

    // A react-select pick shows its choice outside the input.
    await page.evaluate(() => {
      document.querySelector(".select__placeholder")!.outerHTML = '<div class="select__single-value">Bengaluru</div>';
    });
    const after = await missingRequired(page);
    check("nothing is missing once every required question has an answer", after.length === 0, after.join(" / "));
  } finally {
    await browser.close();
  }
  console.log(failed ? `FAIL greenhouse-form (${failed})` : "PASS greenhouse-form");
  process.exit(failed ? 1 : 0);
}

main();
