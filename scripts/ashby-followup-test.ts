// Ashby questions shown only once another is answered (17 Nov, Commure: "Please specify the type of sponsorship" after
// sponsorship Yes): after filling, the adapter's nextStep returns the questions that appeared, once, and null when none.
// Offline: a fixture in Ashby's markup; Ashby's API calls are answered locally. npx tsx scripts/ashby-followup-test.ts
import { chromium } from "playwright";
import { ashbyAdapter } from "../src/modules/apply/adapters/ashby";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

const FOLLOW_UP = `<div data-field-path="q_type" class="ashby-application-form-field-entry"><label class="ashby-application-form-question-title _required_x">Please specify the type of sponsorship you will require</label><textarea></textarea></div>`;
const FORM = `<form onsubmit="return false">
  <div data-field-path="_systemfield_name" class="ashby-application-form-field-entry"><label class="ashby-application-form-question-title _required_x">Name</label><input id="_systemfield_name" type="text"></div>
  <div data-field-path="q_sponsor" class="ashby-application-form-field-entry" id="sponsor"><label class="ashby-application-form-question-title _required_x">Will you now or in the future require sponsorship to work in the US?</label>
    <div class="ashby-application-form-input-yesno"><button type="button" aria-pressed="false" onclick='this.setAttribute("aria-pressed","true"); document.getElementById("sponsor").insertAdjacentHTML("afterend", ${JSON.stringify(FOLLOW_UP)})'>Yes</button><button type="button" aria-pressed="false">No</button></div></div>
</form>`;

async function main() {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route("**/api/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: '{"data":null}' }));
    await page.route("https://jobs.ashbyhq.com/acme/1/application", (route) => route.fulfill({ status: 200, contentType: "text/html", body: FORM }));
    await page.goto("https://jobs.ashbyhq.com/acme/1/application");
    const first = await ashbyAdapter.inspect(page);
    check("the first read has the two questions shown", first.length === 2, first.map((f) => f.label).join(" | "));
    check("nothing new before any answer: null", (await ashbyAdapter.nextStep!(page)) === null);
    await page.locator("#sponsor button", { hasText: "Yes" }).click();
    const more = await ashbyAdapter.nextStep!(page);
    check("the follow-up shown after Yes comes back, required, as a text box", more?.length === 1 && /type of sponsorship/.test(more[0].label) && more[0].required && more[0].type === "textarea", JSON.stringify(more));
    check("and only once: the next read finds nothing new", (await ashbyAdapter.nextStep!(page)) === null);
  } finally {
    await browser.close();
  }
  console.log(failed === 0 ? "PASS ashby-followup" : `FAIL ashby-followup (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}
main();
