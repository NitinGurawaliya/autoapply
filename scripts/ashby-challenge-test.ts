// Ashby's checks on the worker's own Submit (ASHBY_AUTO_SUBMIT=1) and the person handoff that follows, offline: a
// reCAPTCHA challenge or an emailed code hands the run to a person (this window where there is a screen, BotCheckError
// where there is none), a person run never presses Submit itself, HTTP 429/403 on the submission is "not sent", and
// what may have been sent is never called "not sent". The person is simulated by the test (it sends the form the way the
// page would once a person had answered the check); nothing here answers a challenge. Fixtures mimic Ashby's markup and
// page.route answers the network: nothing leaves this machine.
// npx tsx scripts/ashby-challenge-test.ts
import { chromium, type Browser, type Page } from "playwright";
import { PERSON_HANDOFF, withPerson } from "../src/lib/queue";
import { ashbyAdapter } from "../src/modules/apply/adapters/ashby";
import { BotCheckError, MaybeSentError, NotSentError, RefusedError, WindowClosedError, type SubmitContext } from "../src/modules/apply/adapter";
import { decideAfterError } from "../src/modules/apply/outcome";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

const realPlatform = process.platform;
/** canShowWindow() reads the platform and DISPLAY when called: Linux with no display is a Docker worker. */
function screen(shown: boolean) {
  Object.defineProperty(process, "platform", { value: shown ? realPlatform : "linux" });
  if (!shown) delete process.env.DISPLAY;
}

const SEND = `fetch("https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiSubmitSingleApplicationFormAction", { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify({ operationName: "ApiSubmitSingleApplicationFormAction" }) })`;
const CHALLENGE = `const f = document.createElement("iframe"); f.id = "challenge"; f.src = "https://www.google.com/recaptcha/api2/bframe?k=x"; f.style.cssText = "width:400px;height:580px"; document.body.appendChild(f);`;
// What the Submit button does in each fixture, run in the page.
const ON_CLICK: Record<string, string> = {
  challenge: CHALLENGE,
  code: `document.body.insertAdjacentHTML("beforeend", "<p>We emailed you a 6-digit verification code. Enter the code to continue.</p>");`,
  submit: `${SEND}.then((r) => { if (r.ok) document.body.innerHTML = "<h2>Success</h2><p>Thanks for your interest.</p>"; });`,
  // The page uploads the resume again (an Ashby POST that is not the submit), then the challenge shows: nothing was sent.
  uploadThenChallenge: `fetch("https://jobs.ashbyhq.com/api/file-upload", { method: "POST", headers: { "content-type": "text/plain" }, body: "resume" }).then(() => { ${CHALLENGE} });`,
  // The submission leaves, then a challenge shows and no Success ever comes: it may have been sent.
  sentThenChallenge: `${SEND}.then(() => { ${CHALLENGE} });`,
  // The submission leaves and the page shows nothing: only Ashby's answer to it tells what happened.
  sendQuietly: SEND,
};
// The person, simulated: the check is gone and the form's submission goes out, as the page does once they answer it.
const PERSON_SENDS = `document.getElementById("challenge")?.remove(); ${ON_CLICK.submit}`;

function form(onClick: string) {
  return `<script>window.clicked = 0;</script><form onsubmit="return false"><div class="ashby-application-form-field-entry" data-field-path="_systemfield_name"><label class="ashby-application-form-question-title _required_x">Name</label><input type="text" value="Test Person" /></div>
    <button type="button" class="ashby-application-form-submit-button" onclick='window.clicked = (window.clicked || 0) + 1; ${onClick}'>Submit Application</button></form>`;
}

type RunOptions = { person?: boolean; status?: number; afterHandoff?: (page: Page) => Promise<void>; cancelAfterMs?: number; level?: string | "unreadable"; answer?: string };

const SENT_ANSWER = '{"data":{"submitSingleApplicationFormAction":{"applicationFormResult":{"__typename":"FormSubmitSuccess"}}}}';
const SCORE_ANSWER = '{"errors":[{"message":"RECAPTCHA_SCORE_BELOW_THRESHOLD"}],"data":null}';
const BLOCK_ANSWER = '{"data":{"submitSingleApplicationFormAction":{"messages":{"blockMessageForCandidateHtml":"<p>You applied recently</p>"},"applicationFormResult":{"__typename":"FormRender"}}}}';
const POSTING = "https://jobs.ashbyhq.com/acme/0b6e0f8c-1d2e-4f3a-9b8c-7d6e5f4a3b2c/application";
const realFetch = globalThis.fetch;
/** Ashby's posting query, answered here: the company's protection level, or a failure. */
let levelReads = 0;
function stubLevel(level: string | undefined) {
  globalThis.fetch = (async () => {
    levelReads += 1;
    if (level === "unreadable") throw new Error("offline");
    return new Response(JSON.stringify({ data: { jobPosting: { id: "x", recaptchaAction: level } } }), { status: 200 });
  }) as typeof fetch;
}

/** One submit in a fresh window. Cancelled once it hands over (no person comes), unless the test acts as the person. */
async function run(browser: Browser, kind: string, options: RunOptions = {}) {
  const page = await browser.newPage();
  await page.route("**/recaptcha/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<div>challenge</div>" }));
  await page.route("https://jobs.ashbyhq.com/**", (route) =>
    route.fulfill({ status: options.status ?? 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: options.answer ?? '{"data":{"submitSingleApplicationFormAction":{"applicationFormResult":{}}}}' }),
  );
  // At a real posting address, so a headless run reads the company's protection level first ("none" unless the test says).
  stubLevel(options.level ?? "job_apply_none");
  await page.route(POSTING, (route) => route.fulfill({ status: 200, contentType: "text/html", body: form(ON_CLICK[kind]) }));
  await page.goto(POSTING);
  levelReads = 0;
  const announced: string[] = [];
  let attempted = false;
  let acted = false;
  const started = Date.now();
  const ctx: SubmitContext = {
    requestCode: async () => null,
    handoff: true,
    person: options.person,
    announceHandoff: async (message) => {
      announced.push(message);
      if (options.afterHandoff && !acted) {
        acted = true;
        // As a person would, a moment after being told.
        setTimeout(() => void options.afterHandoff!(page).catch(() => undefined), 1500);
      }
    },
    cancelled: async () => (options.cancelAfterMs !== undefined ? Date.now() - started > options.cancelAfterMs : !options.afterHandoff && announced.length > 0),
    markAttempted: () => void (attempted = true),
  };
  let error: unknown = null;
  let result = null;
  try {
    result = await ashbyAdapter.submit(page, ctx);
  } catch (caught) {
    error = caught;
  }
  const clicks = page.isClosed() ? -1 : ((await page.evaluate(() => (window as unknown as { clicked?: number }).clicked ?? 0).catch(() => -1)) as number);
  await page.close().catch(() => undefined);
  return { error, result, announced, attempted, clicks, levelReads };
}

const at = (minutes: number) => new Date(Date.UTC(2026, 9, 25, 12, minutes));

async function main() {
  process.env.ASHBY_AUTO_SUBMIT = "1";
  const browser = await chromium.launch({ headless: true });
  try {
    // ---- Docker worker (no screen): Ashby's check stops it, nothing sent, nothing attempted.
    screen(false);
    let out = await run(browser, "challenge");
    check("no screen: a reCAPTCHA challenge on the worker's Submit is a bot check, nothing sent", out.error instanceof BotCheckError && !out.attempted && out.clicks === 1, String(out.error));
    out = await run(browser, "code");
    check("no screen: an emailed code on the worker's Submit is a bot check, nothing sent", out.error instanceof BotCheckError && !out.attempted, String(out.error));
    out = await run(browser, "uploadThenChallenge");
    check("no screen: the page's own resume upload before a challenge is not 'sent' (27 Oct, Resend)", out.error instanceof BotCheckError && !out.attempted, String(out.error));
    out = await run(browser, "submit", { level: "job_apply_low" });
    check("no screen: a company protected at 'low' goes to a person with no click at all", out.error instanceof BotCheckError && /spam protection \(job_apply_low\)/.test(String(out.error)) && out.clicks === 0 && !out.attempted, `${out.error} clicks=${out.clicks}`);
    out = await run(browser, "submit", { level: "job_apply_high" });
    check("no screen: 'high' also goes to a person", out.error instanceof BotCheckError && out.clicks === 0);
    out = await run(browser, "submit", { level: "job_apply_none" });
    check("no screen: a company at 'none' is sent by the worker's own Submit, after one level read", out.result?.confirmed === true && out.clicks === 1 && out.levelReads === 1, JSON.stringify(out.result));
    out = await run(browser, "submit", { level: "unreadable" });
    check("no screen: an unreadable level is protected: a person, no click", out.error instanceof BotCheckError && /could not be read/.test(String(out.error)) && out.clicks === 0 && !out.attempted, `${out.error} clicks=${out.clicks}`);
    out = await run(browser, "submit", { level: "job_apply_very_high" });
    check("no screen: a level never seen before is protected, not 'none'", out.error instanceof BotCheckError && /job_apply_very_high/.test(String(out.error)) && out.clicks === 0, `${out.error} clicks=${out.clicks}`);
    out = await run(browser, "sentThenChallenge", { cancelAfterMs: 4000 });
    check("no screen: a challenge after the submission already left is never 'not sent' (may have been sent)", out.error instanceof MaybeSentError && out.attempted, String(out.error));

    // Ashby's own answer to the submit decides when the page shows nothing (atsfill's notes on Ashby, 29 Oct).
    out = await run(browser, "sendQuietly", { answer: SENT_ANSWER });
    check("no screen: Ashby answering FormSubmitSuccess is sent, with no Success page", out.result?.confirmed === true && /FormSubmitSuccess/.test(out.result.evidence), JSON.stringify(out.result ?? String(out.error)));
    out = await run(browser, "sendQuietly", { answer: SCORE_ANSWER });
    check("no screen: a reCAPTCHA score too low on the worker's Submit is a bot check, not 'may have been sent'", out.error instanceof BotCheckError, String(out.error));
    // ---- Worker with a screen: the same window becomes a handoff.
    screen(true);
    out = await run(browser, "sendQuietly", { answer: SCORE_ANSWER });
    check("screen: a reCAPTCHA score too low hands the window to a person", /reCAPTCHA turned the submission away/.test(out.announced[0] ?? ""), out.announced.join(" | "));
    check("screen: and with no Submit from them, nothing was sent", out.error instanceof NotSentError && !(out.error instanceof MaybeSentError), String(out.error));
    out = await run(browser, "sendQuietly", { answer: BLOCK_ANSWER });
    check("screen: Ashby's block message is a refusal, nothing sent", out.error instanceof RefusedError && /applied recently/.test(String(out.error)), String(out.error));
    out = await run(browser, "challenge");
    check("screen: a challenge turns the same window into a handoff for a person", /reCAPTCHA check/.test(out.announced[0] ?? "") && out.clicks === 1, out.announced.join(" | "));
    check("screen: the person cancelling before Submit is not sent", out.error instanceof NotSentError && !(out.error instanceof BotCheckError) && !out.attempted, String(out.error));
    out = await run(browser, "submit", { level: "job_apply_low" });
    check("screen: a company at 'low' is still sent by the worker's own click (visible Chrome, 24 Oct: 0 of 6 challenged)", out.result?.confirmed === true && out.clicks === 1 && /worker pressed Submit/.test(out.result.evidence), JSON.stringify(out.result));
    out = await run(browser, "challenge", { level: "unreadable" });
    check("screen: the level is not read at all; a challenge on the click hands this window over", out.clicks === 1 && out.levelReads === 0 && /reCAPTCHA check/.test(out.announced[0] ?? ""), `reads=${out.levelReads} ${out.announced.join(" | ")}`);
    out = await run(browser, "challenge", { level: "job_apply_low", afterHandoff: (page) => page.evaluate(PERSON_SENDS) });
    check("screen: at 'low', challenged, the person completes it in the same window and it is sent", out.result?.confirmed === true && out.attempted && /you pressed Submit/.test(out.result.evidence), JSON.stringify(out.result));
    out = await run(browser, "challenge", { afterHandoff: (page) => page.evaluate(PERSON_SENDS) });
    check("screen: the person completes it in the same filled window and it is sent, credited to them", out.result?.confirmed === true && /you pressed Submit/.test(out.result.evidence) && out.attempted && out.clicks === 1, JSON.stringify(out.result));

    // ---- A person run (apply-person queue): the worker never presses Submit.
    out = await run(browser, "submit", { person: true });
    check("person run: the worker never presses Submit itself", out.clicks === 0 && /confirm a person/.test(out.announced[0] ?? "") && !out.attempted, `clicks=${out.clicks}`);
    out = await run(browser, "submit", { person: true, afterHandoff: (page) => page.evaluate(PERSON_SENDS) });
    check("person run: the person's Submit is sent once Ashby shows Success", out.result?.confirmed === true && out.attempted && out.clicks === 0, JSON.stringify(out.result));
    out = await run(browser, "submit", { person: true, afterHandoff: (page) => page.close() });
    check("person run: the window closed before Submit is WindowClosedError, nothing sent", out.error instanceof WindowClosedError && !out.attempted, String(out.error));

    // ---- Ashby's answer to the submission.
    out = await run(browser, "submit", { status: 429 });
    check("HTTP 429 on the submission: rate limited, not sent", out.error instanceof RefusedError && /429/.test((out.error as Error).message) && out.attempted, String(out.error));
    out = await run(browser, "submit", { status: 403 });
    check("HTTP 403 on the submission: turned away, not sent", out.error instanceof RefusedError && /403/.test((out.error as Error).message), String(out.error));
    out = await run(browser, "submit");
    check("an accepted submission with Ashby's Success banner is sent", out.result?.confirmed === true && out.attempted && out.clicks === 1, JSON.stringify(out.result));

    // ---- The school picker lists each school as name, country and website on three lines (25 Oct, Applied Intuition).
    const page = await browser.newPage();
    const schools = ["Jaypee University of Information Technology Extension\nIndia\nx.in", "Jaypee University of Information Technology\nIndia\njuit.ac.in", "St. Joseph University In Tanzania\nTanzania\nsjuit.ac.tz"];
    await page.setContent(`<div data-field-path="q_edu"><label>Education History</label><input role="combobox" /></div><div role="listbox" id="list"></div>
      <script>const schools = ${JSON.stringify(schools)};
      document.querySelector("input").addEventListener("input", () => {
        const list = document.getElementById("list");
        list.innerHTML = schools.map(() => '<div role="option" style="white-space:pre-line"></div>').join("");
        list.querySelectorAll("[role=option]").forEach((o, i) => { o.textContent = schools[i]; o.addEventListener("click", () => { window.picked = schools[i].split(String.fromCharCode(10))[0]; }); });
      });</script>`);
    const filled = await ashbyAdapter.fill(page, [{ key: "school", label: "Education History", value: "Jaypee University Of Information Technology", source: "resume", selector: '[data-field-path="q_edu"]', type: "combobox", required: true }]);
    const picked = await page.evaluate(() => (window as unknown as { picked?: string }).picked);
    check("a school is picked by its name line, not a longer name that starts the same", picked === "Jaypee University of Information Technology" && filled.length === 1, `picked=${picked}`);
  } finally {
    screen(true);
    globalThis.fetch = realFetch;
    await browser.close();
  }

  // ---- Which queue later runs go on (lib/queue.ts withPerson): with a person until the user's own Retry.
  const handed = { type: "ask_user", message: `${PERSON_HANDOFF}. A Chrome window opens...`, createdAt: at(10) };
  check("never handed over: not with a person", !withPerson([]));
  check("handed over: every later run (retry, reopen, answer, reaper) stays with a person", withPerson([handed]));
  check("the user's Retry after the handoff starts afresh", !withPerson([handed, { type: "retry", message: "Retried by you", createdAt: at(20) }]));
  check("handed over again after a Retry: with a person", withPerson([{ type: "retry", message: "Retried by you", createdAt: at(5) }, handed]));
  check("other events never count", !withPerson([{ type: "ask_user", message: "Ready to send: check the form", createdAt: at(30) }]));

  // ---- What the runner does after each person-run outcome (outcome.ts), on a handoff board.
  const decide = (error: unknown, extra: Partial<Parameters<typeof decideAfterError>[0]> = {}) =>
    decideAfterError({ error, attempted: false, handoff: true, submitStage: true, windowGone: false, reopenedBefore: false, retryable: false, attempt: 1, maxAttempts: 3, ...extra });
  check("person run: no Submit within 15 minutes fails, never retried by itself", decide(new NotSentError("Submit was not pressed within 15 minutes.")) === "failed");
  check("person run: window closed before Submit opens once more, then skips", decide(new WindowClosedError("closed")) === "reopen" && decide(new WindowClosedError("closed"), { reopenedBefore: true }) === "skip");
  check("person run: anything after the person's Submit is pending verification, never retried", decide(new Error("page crashed"), { attempted: true }) === "pending_verification");
  check("person run: Ashby's refusal after the person's Submit fails (nothing sent)", decide(new RefusedError("flagged as spam"), { attempted: true }) === "failed");

  console.log(failed === 0 ? "PASS ashby-challenge-test" : `FAIL ashby-challenge-test (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
