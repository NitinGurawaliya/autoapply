// Required acknowledgements (privacy notices, "my answers are true", arbitration) on every adapter, offline:
// what counts as one, the one-time standing permission, and the Ashby blocks that used to be invisible.
// Ashby markup copied from the live OpenAI and Snowflake forms; no network, nothing submitted.
// npx tsx scripts/acknowledgement-test.ts
import { chromium } from "playwright";
import { matchKeyBySynonym } from "../src/modules/answers";
import type { FormField } from "../src/modules/apply/adapter";
import { ACKNOWLEDGEMENT_KEY, acknowledgementValue } from "../src/modules/apply/acknowledgement";
import { ashbyAdapter, emptyRequired } from "../src/modules/apply/adapters/ashby";
import { resolveValues } from "../src/modules/apply/valueResolver";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

const field = (label: string, type: string, options?: string[], required = true): FormField => ({ selector: `#${type}`, label, type, required, options });

// 1. What counts as an acknowledgement.
const ARBITRATION = field("Applicant Arbitration Agreement Acknowledgement", "checkbox-group", ["I acknowledge that I have opened, read, and understood the Arbitration Agreement. I understand that by submitting my application, I am agreeing to be bound by the terms of the Arbitration Agreement."]);
const CERTIFY = field("I hereby certify that I have not knowingly withheld any information that might adversely affect my chances for employment and that the answers given by me are true and correct to the best of my knowledge.", "checkbox-group", ["I confirm I have read the above."]);
const PRIVACY = field("Snowflake will process your personal information in accordance with the Snowflake Candidate Privacy Notice.", "checkbox-group", ["I have read and agree to the Snowflake Candidate Privacy Notice."]);
const AGE_REDACT = field("In any materials you submit, you may redact or remove age-identifying information such as dates of attendance or graduation.", "checkbox-group", ["I Acknowledge"]);
const GH_ACK = field('By clicking the "Acknowledge" button, you acknowledge that Twilio processes data in accordance with the Twilio Applicant Privacy Policy.', "checkbox");
const GH_CONSENT = field("By checking this box, I consent to Stripe collecting, storing, and processing my personal data", "checkbox");
const SELECT_ACK = field("Do you acknowledge that you have read our candidate privacy policy?", "select", ["Yes", "No"]);
check("one-box acknowledgement groups tick their only box", acknowledgementValue(ARBITRATION) === ARBITRATION.options![0] && acknowledgementValue(CERTIFY) === CERTIFY.options![0] && acknowledgementValue(PRIVACY) === PRIVACY.options![0] && acknowledgementValue(AGE_REDACT) === "I Acknowledge");
check("a single consent checkbox is ticked with Yes", acknowledgementValue(GH_ACK) === "Yes" && acknowledgementValue(GH_CONSENT) === "Yes");
check("an acknowledgement asked as a choice picks the affirmative option", acknowledgementValue(SELECT_ACK) === "Yes");
check("marketing opt-ins are never acknowledgements", acknowledgementValue(field("Do you opt-in to receive WhatsApp messages from us? I agree to the terms.", "checkbox")) === null && acknowledgementValue(field("I consent to being contacted about future opportunities", "checkbox")) === null);
check("a certification that is really a fact about the candidate is not one", acknowledgementValue(field("I certify that I am legally authorized to work in the United States", "checkbox")) === null && acknowledgementValue(field("I certify that I am over 18 years of age", "checkbox")) === null && acknowledgementValue(field("I acknowledge I will require visa sponsorship", "checkbox")) === null);
check("an optional acknowledgement is left alone", acknowledgementValue({ ...GH_ACK, required: false }) === null);
check("ordinary questions are not acknowledgements", acknowledgementValue(field("How did you hear about Twilio?", "checkbox-group", ["LinkedIn", "Twitter"])) === null && acknowledgementValue(field("Have you ever been employed by Stripe?", "yesno", ["Yes", "No"])) === null);
check("a choice with no single affirmative option is not guessed", acknowledgementValue(field("Do you agree to the privacy policy?", "select", ["Option A", "Option B"])) === null);

// 2. The standing permission.
const PROFILE = { fullName: "Test Person", email: "t@example.com", phone: null, city: null, country: null, linkedin: null, github: null, portfolio: null, yearsExperience: 2, currentTitle: null, currentCompany: null, resumeKey: "resumes/x/resume.pdf" };
const ACKS = [ARBITRATION, CERTIFY, GH_ACK];
const mapped = ACKS.map((f) => ({ field: f, key: matchKeyBySynonym(f.label) }));
const none = resolveValues(mapped, PROFILE, []);
check("without a standing answer the permission is asked once, not once per box", none.values.length === 0 && none.pending.length === 1 && none.pending[0].key === ACKNOWLEDGEMENT_KEY && none.pending[0].options?.join("|") === "Yes|No", JSON.stringify(none.pending.map((q) => q.key)));
const yes = resolveValues(mapped, PROFILE, [{ key: ACKNOWLEDGEMENT_KEY, answer: "Yes", source: "user" }]);
check("with permission every acknowledgement is ticked, nothing asked", yes.pending.length === 0 && yes.values.length === 3);
check("each ticked box is recorded as the user's answer under the permission key", yes.values.every((v) => v.source === "user" && v.key === ACKNOWLEDGEMENT_KEY) && yes.values[0].value === ARBITRATION.options![0] && yes.values[2].value === "Yes");
const no = resolveValues(mapped, PROFILE, [{ key: ACKNOWLEDGEMENT_KEY, answer: "No", source: "user" }]);
check("a user who said no is asked each acknowledgement on its own", no.values.length === 0 && no.pending.length === 3 && no.pending.every((q) => q.key.startsWith("q_")));
const ownKey = no.pending[0].key;
const own = resolveValues(mapped, PROFILE, [{ key: ACKNOWLEDGEMENT_KEY, answer: "Yes", source: "user" }, { key: ownKey, answer: "No", source: "user" }]);
check("an earlier No to that exact question beats the standing permission (asked again, not ticked)", !own.values.some((v) => v.label === ARBITRATION.label) && own.pending.length === 1 && own.pending[0].key === ownKey && own.values.length === 2);

// 3. Ashby: the acknowledgement blocks are found, filled and checked before Submit.
const ASHBY = `<form>
<div class="_fieldEntry_1e3gg_28 ashby-application-form-field-entry" data-field-path="_systemfield_name"><label class="_heading_f7cvd_52 _required_f7cvd_91 ashby-application-form-question-title" for="_systemfield_name">Legal Name</label><input id="_systemfield_name" type="text" value="Test Person"/></div>
<div data-field-path="a90e16d2"><fieldset class="_container_1258i_28 _fieldEntry_1e3gg_28 ashby-application-form-input-checkbox-group"><label class="_heading_f7cvd_52 _required_f7cvd_91 _label_1e3gg_42 ashby-application-form-question-title" for="a90e16d2">Applicant Arbitration Agreement Acknowledgement</label><div class="ashby-application-form-question-description"><p><a href="#">Applicant Arbitration Agreement</a></p></div><div class="_option_1258i_34 ashby-application-form-input-checkbox-group-option"><span class="ashby-application-form-input-checkbox-group-option-checkbox" data-disabled="false"><svg></svg><input type="checkbox" id="x_a90e16d2-labeled-checkbox-0" name="I acknowledge that I have opened, read, and understood the Arbitration Agreement."></span><label for="x_a90e16d2-labeled-checkbox-0" class="ashby-application-form-input-checkbox-group-option-label">I acknowledge that I have opened, read, and understood the Arbitration Agreement. I understand that by submitting my application, I am agreeing to be bound by the terms of the Arbitration Agreement.</label></div></fieldset></div>
<div data-field-path="2ded3ef9"><fieldset class="_fieldEntry_1e3gg_28 ashby-application-form-input-checkbox-group"><label class="_heading_f7cvd_52 _required_f7cvd_91 ashby-application-form-question-title" for="2ded3ef9">Snowflake will process your personal information in accordance with the Snowflake Candidate Privacy Notice.</label><div class="ashby-application-form-input-checkbox-group-option"><span class="ashby-application-form-input-checkbox-group-option-checkbox"><input type="checkbox" id="y_2ded3ef9-labeled-checkbox-0" name="I have read and agree to the Snowflake Candidate Privacy Notice."></span><label for="y_2ded3ef9-labeled-checkbox-0">I have read and agree to the Snowflake Candidate Privacy Notice.</label></div></fieldset></div>
<div class="_fieldEntry_1e3gg_28 ashby-application-form-field-entry" data-field-path="a7d1a4bb"><label class="_heading_f7cvd_52 _required_f7cvd_91 ashby-application-form-question-title" for="a7d1a4bb">Have you ever been directly employed by any government or military entity?</label><div class="ashby-application-form-input-yesno"><button type="button" class="ashby-application-form-input-yesno-option" aria-pressed="false" data-option="yes" onclick="this.parentElement.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === this)))">Yes</button><button type="button" class="ashby-application-form-input-yesno-option" aria-pressed="false" data-option="no" onclick="this.parentElement.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === this)))">No</button><input type="checkbox" tabindex="-1" name="a7d1a4bb"></div></div>
<button type="submit" class="ashby-application-form-submit-button">Submit Application</button>
</form>`;

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.setContent(ASHBY);
    const fields = await ashbyAdapter.inspect(page);
    const arb = fields.find((f) => f.label.startsWith("Applicant Arbitration"));
    const priv = fields.find((f) => f.label.startsWith("Snowflake will process"));
    check("Ashby finds the acknowledgement blocks that have no field-entry class", Boolean(arb && priv), fields.map((f) => f.label.slice(0, 30)).join(" / "));
    check("they are required one-box groups with the box's own text as the option", arb?.type === "checkbox-group" && arb.required && /^I acknowledge that I have opened/.test(arb.options?.[0] ?? "") && priv?.options?.[0] === "I have read and agree to the Snowflake Candidate Privacy Notice.", JSON.stringify(arb));

    const before = await emptyRequired(page);
    check("before filling, the empty acknowledgements and the unanswered Yes/No are named", ["Applicant Arbitration", "Snowflake will process", "Have you ever been directly employed"].every((w) => before.some((m) => m.startsWith(w))), before.join(" / "));

    const resolved = resolveValues(fields.map((f) => ({ field: f, key: f.hintKey ?? matchKeyBySynonym(f.label) })), PROFILE, [
      { key: ACKNOWLEDGEMENT_KEY, answer: "Yes", source: "user" },
      { key: (await import("../src/modules/answers")).customQuestionKey(fields.find((f) => f.type === "yesno")!.label), answer: "No", source: "user" },
    ]);
    await ashbyAdapter.fill(page, resolved.values.filter((v) => v.type !== "file"));
    const ticked = await page.evaluate(() => Array.from(document.querySelectorAll("input[type=checkbox]:checked")).map((el) => el.id));
    check("with permission both acknowledgement boxes are ticked", ticked.includes("x_a90e16d2-labeled-checkbox-0") && ticked.includes("y_2ded3ef9-labeled-checkbox-0"), ticked.join(" "));
    const after = await emptyRequired(page);
    check('a Yes/No answered "No" is not reported empty (its hidden checkbox stays unticked)', after.length === 0, after.join(" / "));
  } finally {
    await browser.close();
  }
  console.log(failed ? `FAIL acknowledgement (${failed})` : "PASS acknowledgement");
  process.exit(failed ? 1 : 0);
}

main();
