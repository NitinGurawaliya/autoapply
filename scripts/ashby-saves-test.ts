// Ashby saves each answer on its server as it is given ("ApiSetFormValue", one per question) and Submit sends only the
// form's id, so an answer whose save failed is "Missing entry" with the answer still on screen (27 Oct, Writer). Offline:
// a fixture in Ashby's markup sends those saves the way the page does, page.route answers them (a chosen one fails), and
// the adapter must pick an unsaved choice again before Submit, and again after a "Missing entry" for a choice. Also: every
// Ashby submit operation counts as the submit, and nothing else does. Nothing leaves this machine.
// npx tsx scripts/ashby-saves-test.ts
import { chromium, type Browser, type Page } from "playwright";
import type { ResolvedValue, SubmitContext } from "../src/modules/apply/adapter";
import { ashbyAdapter, carriesSubmit, readSubmitAnswer } from "../src/modules/apply/adapters/ashby";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

const POSTING = "https://jobs.ashbyhq.com/acme/0b6e0f8c-1d2e-4f3a-9b8c-7d6e5f4a3b2c/application";
const HUB = "108cbcee-hub";
const OFFICE = "9d92fff2-office";

// The page's own saves, as Ashby's form makes them: one POST per answer, carrying the question path and the value.
const SAVE = `function save(path, value) { fetch("https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiSetFormValue", { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify({ operationName: "ApiSetFormValue", variables: { path, value } }) }); }`;

function form(onSubmit: string) {
  const radio = (index: number, text: string) =>
    `<div class="ashby-application-form-input-radio-group-option"><input type="radio" id="hub-${index}" name="hub" onchange='save("${HUB}", "${text}")'><label for="hub-${index}">${text}</label></div>`;
  const yesno = (text: string) =>
    `<button type="button" aria-pressed="false" class="ashby-application-form-input-yesno-option" onclick='document.querySelectorAll("[data-yn] button").forEach((b) => b.setAttribute("aria-pressed", String(b === this))); save("${OFFICE}", ${text === "Yes"})'>${text}</button>`;
  return `<script>${SAVE} window.submits = 0;</script><form onsubmit="return false">
    <div data-field-path="${HUB}"><fieldset class="ashby-application-form-input-radio-group"><label class="ashby-application-form-question-title _required_x">Are you located within 50 miles of one of the following office hubs</label>
      ${radio(0, "London, UK")}${radio(1, "No, but willing to relocate")}${radio(2, "No, and not willing to relocate")}</fieldset></div>
    <div data-field-path="${OFFICE}" data-yn><label class="ashby-application-form-question-title _required_x">Are you able and excited to join us for in  person, collaborative working sessions?</label>
      <div class="ashby-application-form-input-yesno">${yesno("Yes")}${yesno("No")}</div></div>
    <button type="button" class="ashby-application-form-submit-button" onclick='window.submits += 1; ${onSubmit}'>Submit Application</button></form>`;
}

const SEND_MULTIPLE = `fetch("https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiSubmitMultipleFormsAction", { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify({ operationName: "ApiSubmitMultipleFormsAction" }) })`;
// The first Submit meets Ashby's validation (the office answer was lost); the second goes out and succeeds.
const MISSING_THEN_SENT = `if (window.submits === 1) { document.body.insertAdjacentHTML("afterbegin", "<div>Your form needs corrections<br>Missing entry for required field: Are you able and excited to join us for in  person, collaborative working sessions?</div>"); } else { ${SEND_MULTIPLE}.then((r) => { if (r.ok) document.body.innerHTML = "<h2>Success</h2><p>Thanks for your interest.</p>"; }); }`;

type Saves = Array<{ path: string; value: unknown; ok: boolean }>;

/**
 * Opens the fixture; `failFirst` lists question paths whose first save Ashby answers with an error. With `render`, each
 * save is answered as Ashby does, with the whole form as held (`drop`: paths Ashby never keeps), after `delayMs`.
 */
async function open(browser: Browser, onSubmit: string, failFirst: string[] = [], options: { render?: boolean; drop?: string[]; delayMs?: number } = {}) {
  const page = await browser.newPage();
  const saves: Saves = [];
  const failing = new Set(failFirst);
  const held = new Map<string, unknown>();
  const flight = { now: 0, most: 0 };
  await page.route("https://jobs.ashbyhq.com/api/**", async (route) => {
    if (options.render) {
      const parsed = JSON.parse(route.request().postData() ?? "{}") as { operationName?: string; variables?: { path?: string; value?: unknown } };
      if (parsed.operationName === "ApiSetFormValue" && parsed.variables?.path) {
        const path = parsed.variables.path;
        saves.push({ path, value: parsed.variables.value, ok: true });
        flight.now += 1;
        flight.most = Math.max(flight.most, flight.now);
        await new Promise((resolve) => setTimeout(resolve, options.delayMs ?? 0));
        flight.now -= 1;
        if (!options.drop?.includes(path)) held.set(path, parsed.variables.value);
        const entries = [HUB, OFFICE].map((p) => ({ field: { path: p }, fieldValue: held.has(p) ? { value: held.get(p) } : null }));
        return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ data: { setFormValue: { sections: [{ fieldEntries: entries }] } } }) });
      }
    }
    const body = route.request().postData() ?? "";
    let parsed: { operationName?: string; variables?: { path?: string; value?: unknown } } = {};
    try {
      parsed = JSON.parse(body);
    } catch {
      // not JSON
    }
    if (parsed.operationName === "ApiSetFormValue" && parsed.variables?.path) {
      const path = parsed.variables.path;
      const fail = failing.delete(path);
      saves.push({ path, value: parsed.variables.value, ok: !fail });
      if (fail) return route.fulfill({ status: 500, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: '{"errors":[{"message":"failed"}]}' });
    }
    return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: '{"data":{"ok":true}}' });
  });
  await page.route(POSTING, (route) => route.fulfill({ status: 200, contentType: "text/html", body: form(onSubmit) }));
  await page.goto(POSTING);
  return { page, saves, flight };
}

const VALUES: ResolvedValue[] = [
  { key: "q_hub", label: "Are you located within 50 miles of one of the following office hubs", value: "No, but willing to relocate", source: "user", selector: `[data-field-path="${HUB}"]`, type: "radio" },
  { key: "q_office", label: "Are you able and excited to join us for in person, collaborative working sessions?", value: "Yes", source: "user", selector: `[data-field-path="${OFFICE}"]`, type: "yesno" },
];

/** What Ashby holds last for a question: the value of its latest accepted save. */
const lastSaved = (saves: Saves, path: string) => saves.filter((save) => save.path === path && save.ok).at(-1)?.value;
const picked = (page: Page) =>
  page.evaluate(() => ({
    hub: (document.querySelector("input[name=hub]:checked")?.nextElementSibling?.textContent ?? "").trim(),
    office: document.querySelector('[data-yn] button[aria-pressed="true"]')?.textContent?.trim() ?? "",
  }));

async function main() {
  check("Ashby's single-form submit counts as the submit", carriesSubmit('{"operationName":"ApiSubmitSingleApplicationFormAction","variables":{}}'));
  check("a form in sections (Writer's ApiSubmitMultipleFormsAction) counts as the submit", carriesSubmit('{"operationName":"ApiSubmitMultipleFormsAction","variables":{}}'));
  check("a saved answer, a resume upload or a page read is not the submit", !["ApiSetFormValue", "ApiSetFormValueToFile", "ApiCreateFileUploadHandle", "ApiJobPosting"].some((op) => carriesSubmit(`{"operationName":"${op}"}`)));
  check("nothing at all is not the submit", !carriesSubmit(null) && !carriesSubmit(""));

  // Ashby's answer to a submit (atsfill's notes on Ashby).
  const answer = (data: unknown) => readSubmitAnswer(JSON.stringify({ data: { submitMultipleFormsAction: data } })).kind;
  check("FormSubmitSuccess is sent", answer({ applicationFormResult: { __typename: "FormSubmitSuccess" } }) === "sent");
  check("a reCAPTCHA score too low is a bot check, not sent", readSubmitAnswer('{"errors":[{"message":"RECAPTCHA_SCORE_BELOW_THRESHOLD"}]}').kind === "captcha");
  check("Ashby's block message is a refusal, with its text", answer({ messages: { blockMessageForCandidateHtml: "<p>You applied recently</p>" }, applicationFormResult: { __typename: "FormRender" } }) === "refused");
  check("a form returned with errors is invalid", answer({ applicationFormResult: { __typename: "FormRender", errorMessages: ["Missing entry for required field: Email"] } }) === "invalid");
  check("an answer with no result, or not JSON, is unknown", answer({ applicationFormResult: {} }) === "unknown" && readSubmitAnswer("<html>").kind === "unknown");

  const browser = await chromium.launch({ headless: true });
  try {
    {
      const { page, saves } = await open(browser, "");
      await ashbyAdapter.fill(page, VALUES);
      const now = await picked(page);
      check("saved answers are left alone: one save per question", saves.filter((s) => s.path === HUB).length === 1 && saves.filter((s) => s.path === OFFICE).length === 1, JSON.stringify(saves.map((s) => s.path)));
      check("and they are the answers given", lastSaved(saves, HUB) === "No, but willing to relocate" && lastSaved(saves, OFFICE) === true && now.hub === "No, but willing to relocate" && now.office === "Yes");
      await page.close();
    }
    {
      const { page, saves } = await open(browser, "", [HUB, OFFICE]);
      await ashbyAdapter.fill(page, VALUES);
      const now = await picked(page);
      check("a radio answer whose save failed is picked again and Ashby holds it", lastSaved(saves, HUB) === "No, but willing to relocate", JSON.stringify(saves.filter((s) => s.path === HUB)));
      check("a Yes/No answer whose save failed is picked again and Ashby holds it", lastSaved(saves, OFFICE) === true, JSON.stringify(saves.filter((s) => s.path === OFFICE)));
      check("the page ends on the answers given, not the option picked in between", now.hub === "No, but willing to relocate" && now.office === "Yes", JSON.stringify(now));
      await page.close();
    }
    {
      // Ashby answers each save with the form it holds, slowly: the next answer waits for the save before it.
      const { page, saves, flight } = await open(browser, "", [], { render: true, delayMs: 600 });
      await ashbyAdapter.fill(page, VALUES);
      check("one save at a time: no two saves in flight together", flight.most === 1, `most in flight ${flight.most}`);
      check("each answer saved once when Ashby holds it", saves.filter((s) => s.path === HUB).length === 1 && saves.filter((s) => s.path === OFFICE).length === 1, JSON.stringify(saves.map((s) => s.path)));
      await page.close();
    }
    {
      // Ashby's returned form never holds the Yes/No answer although its save went through: given again, then the run stops
      // before Submit, since it would be "Missing entry" after it.
      const { page, saves } = await open(browser, "", [], { render: true, drop: [OFFICE] });
      let error: unknown = null;
      try {
        await ashbyAdapter.fill(page, VALUES.map((value) => ({ ...value, required: true })));
      } catch (caught) {
        error = caught;
      }
      check("an answer Ashby does not hold is given again", saves.filter((s) => s.path === OFFICE).length >= 3, JSON.stringify(saves.filter((s) => s.path === OFFICE)));
      check("a required answer Ashby still does not hold stops the run before Submit", error instanceof Error && /did not keep/.test(error.message) && /in person/.test(error.message), error instanceof Error ? error.message : String(error));
      await page.close();
    }
    {
      // Saved during the fill, then "Missing entry" on Submit for the Yes/No (the Writer runs): picked again, Submit once more.
      process.env.ASHBY_AUTO_SUBMIT = "1";
      const { page, saves } = await open(browser, MISSING_THEN_SENT);
      await ashbyAdapter.fill(page, VALUES);
      const before = saves.filter((s) => s.path === OFFICE).length;
      const ctx: SubmitContext = { requestCode: async () => null, handoff: true, announceHandoff: async () => undefined, cancelled: async () => false, markAttempted: () => undefined };
      let result: unknown = null;
      let error: unknown = null;
      try {
        result = await ashbyAdapter.submit(page, ctx);
      } catch (caught) {
        error = caught;
      }
      const submits = (await page.evaluate(() => (window as unknown as { submits: number }).submits).catch(() => -1)) as number;
      check("a choice named in 'Missing entry' is picked again before the second Submit", saves.filter((s) => s.path === OFFICE).length > before && lastSaved(saves, OFFICE) === true, JSON.stringify(saves.filter((s) => s.path === OFFICE)));
      check("then the form in sections is sent and confirmed", result !== null && error === null && submits === 2, `submits=${submits} error=${error instanceof Error ? error.message.slice(0, 100) : error}`);
      await page.close().catch(() => undefined);
    }
  } finally {
    await browser.close();
  }
  console.log(failed === 0 ? "PASS ashby-saves" : `FAIL ashby-saves (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
