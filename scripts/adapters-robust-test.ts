// Adapter failure modes, offline: unsupported required questions, empty required fields before Submit, cookie banners,
// per-field error messages. Fixtures mimic the real markup; no network, nothing submitted.
// npx tsx scripts/adapters-robust-test.ts
import { chromium } from "playwright";
import { ashbyAdapter, emptyRequired } from "../src/modules/apply/adapters/ashby";
import { dismissOverlays, friendlyError, inField } from "../src/modules/apply/adapters/common";
import { leverAdapter } from "../src/modules/apply/adapters/lever";
import { NoRetryError } from "../src/modules/apply/adapter";
import { acknowledgementValue } from "../src/modules/apply/acknowledgement";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}
const entry = (path: string, title: string, required: boolean, body: string) =>
  `<div class="ashby-application-form-field-entry" data-field-path="${path}"><label class="ashby-application-form-question-title ${required ? "_required_x" : ""}">${title}</label>${body}</div>`;
const ashby = (entries: string) => `<form>${entries}<button type="submit" class="ashby-application-form-submit-button">Submit Application</button></form>`;

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

  // ---- Ashby: a required question type the agent cannot answer stops the run before anything is filled
  await page.setContent(ashby(entry("_systemfield_name", "Name", true, '<input id="_systemfield_name" type="text" />') + entry("q1", "Pick your skills", true, '<div role="listbox"><div role="option">A</div></div>')));
  let error = await rejects(() => ashbyAdapter.inspect(page));
  check("a required question the agent cannot answer stops the run, naming the question", error instanceof NoRetryError && /Pick your skills/.test(error.message), error?.message.slice(0, 80));

  await page.setContent(ashby(entry("_systemfield_name", "Name", true, '<input id="_systemfield_name" type="text" />') + entry("q1", "Pick your skills", false, '<div role="listbox"><div role="option">A</div></div>')));
  const fields = await ashbyAdapter.inspect(page);
  check("an optional question it cannot answer is skipped, the rest is read", fields.length === 1 && fields[0].label === "Name", fields.map((f) => f.label).join(","));

  // ---- Ashby: required field still empty is caught before Submit
  await page.setContent(ashby(entry("_systemfield_name", "Name", true, '<input type="text" value="" />') + entry("q2", "Why us?", true, "<textarea>some words</textarea>")));
  error = await rejects(() => ashbyAdapter.submit(page, { requestCode: async () => null }));
  check("an empty required field is reported before clicking Submit", error instanceof NoRetryError && /still empty: Name/.test(error.message), error?.message.slice(0, 90));
  check("a filled required field is not reported", !/Why us/.test(error?.message ?? ""));

  // ---- Ashby: "Education History" is a School picker with optional degree, field, month and year boxes (27 Oct, Ramp)
  const education = (school: string) =>
    ashby(entry("_systemfield_education_history", "Education History", true, `<input role="combobox" value="${school}" /><input type="text" placeholder="Degree" /><input type="text" placeholder="Field of Study" /><select><option value="">Month...</option><option value="1">Jan</option></select><select><option value="">Year...</option></select><input type="checkbox" />`));
  await page.setContent(education("Jaypee University of Information Technology"));
  check("a picked school with the optional boxes empty is not reported empty", (await emptyRequired(page)).length === 0);
  await page.setContent(education(""));
  check("no school picked is still reported empty", (await emptyRequired(page)).includes("Education History"));

  // ---- Ashby: a one-box group whose box has no text is that box, saying what the question says (27 Oct, OakNorth)
  await page.setContent(ashby(entry("_systemfield_name", "Name", true, '<input id="_systemfield_name" type="text" />') + entry("q3", "Please confirm you have read and understood our privacy policy.", true, '<div class="ashby-application-form-input-checkbox-group"><span><input type="checkbox" id="q3-0" name="" /></span><label for="q3-0"></label></div>')));
  const confirm = (await ashbyAdapter.inspect(page)).find((field) => /privacy policy/.test(field.label));
  check("an untexted one-box group is read as one checkbox, never as an empty choice", confirm?.type === "checkbox" && !confirm.options, JSON.stringify(confirm));
  check("which the standing acknowledgement permission ticks", confirm ? acknowledgementValue(confirm) === "Yes" : false);

  // ---- Lever: the browser's own validation names the missing field
  await page.setContent('<form id="application-form"><ul><li class="application-question"><div class="application-label">Full name</div><input name="name" required value="" /></li></ul><button id="hcaptchaSubmitBtn" type="submit">Submit application</button></form>');
  error = await rejects(() => leverAdapter.submit(page, { requestCode: async () => null }));
  check("Lever: a missing required field is named before Submit", error instanceof NoRetryError && /Full name/.test(error.message), error?.message.slice(0, 90));

  // ---- Lever: no Submit button is a clear message, not a 30 second timeout
  await page.setContent('<form id="application-form"><ul></ul></form>');
  const started = Date.now();
  error = await rejects(() => leverAdapter.submit(page, { requestCode: async () => null }));
  check("Lever: a form without a Submit button fails clearly", error instanceof NoRetryError && /Submit button never appeared/.test(error.message), `${Math.round((Date.now() - started) / 1000)}s`);

  // ---- cookie banner on top of the page
  await page.setContent('<div style="position:fixed;inset:0;background:#fff9"><button id="onetrust-reject-all-handler" onclick="this.parentElement.remove()">Reject all</button></div><button id="go">Go</button>');
  check("a cookie banner is declined", (await dismissOverlays(page)) === true && (await page.locator("#onetrust-reject-all-handler").count()) === 0);
  await page.setContent("<button id='go'>Go</button>");
  check("no banner means nothing is clicked", (await dismissOverlays(page)) === false);

  // ---- messages
  check("a Playwright timeout reads as a plain sentence", /never showed/.test(friendlyError(new Error("locator.click: Timeout 30000ms exceeded.\nCall log:\n  - waiting for locator('#hcaptchaSubmitBtn')"))));
  check("a covered control is explained", /covering it/.test(friendlyError(new Error("<div> intercepts pointer events"))));
  const wrapped = await rejects(() => inField("Years of experience", async () => { throw new Error("locator.fill: Timeout 30000ms exceeded.\nCall log:\n  - waiting for locator('[name=\"x\"]')"); }));
  check("a failing field names itself in the error", /Could not fill "Years of experience"/.test(wrapped?.message ?? ""), wrapped?.message.slice(0, 100));

  await browser.close();
  console.log(failed === 0 ? "PASS adapters-robust" : `FAIL adapters-robust (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}
main();
