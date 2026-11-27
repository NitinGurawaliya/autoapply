import type { BrowserContext, Locator, Page } from "playwright";
import { livePage } from "../browser";
import type { SignInResult } from "./naukri";
import type { OtpStep } from "./naukriOtp";
import { CHECK_TEXT, readCall, type PageRead, type PageStop } from "./read";

/**
 * Hirist's own pages (K17 reading, K18 sign-in; docs/hirist/TDD.md 4.2, 4.3). Worker only.
 *
 * Reading, signed out: a search page and a job page are opened as a person opens them and we take the JSON their own
 * script fetched (shapes: fetchers/hirist.ts): never Hirist's API called by us, never a signature made. Calls as the K17
 * probe saw them (27 Nov): `/search/<text>` fetches `gladiator.hirist.tech/job/search`; a skill page (`/k/python-jobs`) and
 * a city page `/job/keyword/`; a job page `/job/detail?jobcode=<id>`. No signature header; the site's own bot check, when
 * it shows one, is a captcha on the page.
 *
 * Signing in, as Naukri's OTP connect (K8b): the agent enters the user's mobile number or email and the code Hirist sends
 * on Hirist's own login form, so the page makes every request itself. Never a password. The code is typed and forgotten:
 * nothing here keeps, logs or reads back the login id or the code, and a check on the page is the user's (the phone shows
 * the page, K8). The form as read signed out on 27 Nov (scripts/hirist-login-probe.ts): the header's "Login" button opens a
 * modal with `input[name=otpIdentifier]` ("Email or Mobile Number") and "Get OTP", disabled until the box holds a valid
 * id; no captcha on it. The code screen shows only once a real code is sent, so its boxes are found when it shows.
 */

const SEARCH_CALL = /gladiator\.hirist\.tech\/job\/(?:search|keyword)(?:[/?]|$)/i;
const JOB_CALL = (jobId: string) => new RegExp(`gladiator\\.hirist\\.tech/job/detail\\?jobcode=${jobId.replace(/[^0-9]/g, "")}(?:&|$)`, "i");
const HOME = "https://www.hirist.tech/";
// The page asks Hirist whether the session is signed in on every load: 401 signed out (probe, 27 Nov), 200 signed in.
const VALIDATE_CALL = /gladiator\.hirist\.tech\/auth\/validate/i;

/** What the page is showing when it did not give us the listings: a check, a refusal page, or nothing we recognise. */
export async function pageStop(page: Page): Promise<{ stop: PageStop; detail: string }> {
  const title = await page.title().catch(() => "");
  const text = await page.locator("body").innerText({ timeout: 3000 }).catch(() => "");
  if (/access denied|forbidden|too many requests/i.test(title) || /^\s*(access denied|403 forbidden|too many requests)/i.test(text)) return { stop: "refused", detail: "Hirist refused the page" };
  const frames = await page.locator('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[title*="challenge" i]').count().catch(() => 0);
  if (frames > 0 || CHECK_TEXT.test(text.slice(0, 4000))) return { stop: "challenge", detail: "Hirist asked for a check" };
  return { stop: "error", detail: "Hirist's page did not load its listings" };
}

const OPTIONS = { label: "Hirist", stopOf: pageStop, statuses: { 429: { stop: "refused" as const, detail: "Hirist asked us to slow down (429)" } } };

/** One of Hirist's own search pages; the listings its own script fetched. */
export function readSearch(page: Page, url: string): Promise<PageRead> {
  return readCall(page, url, SEARCH_CALL, OPTIONS);
}

/** One of Hirist's own job pages; the posting its own script fetched. */
export function readJob(page: Page, url: string, jobId: string): Promise<PageRead> {
  return readCall(page, url, JOB_CALL(jobId), OPTIONS);
}

// ---- Signing in ---------------------------------------------------------------------------------------------------

const ID_BOX = "input[name='otpIdentifier']";
const SEND_BUTTON = "button:has-text('Get OTP')";
// Boxes that are not the code: the id box and the header's job search.
const NOT_CODE = new Set(["otpIdentifier", "query", "loc", "experience"]);
// What Hirist shows when it turns an id or a code away. Only the words are kept, never a digit.
const ERROR_TEXT = ".Mui-error:visible, [class*='error' i]:visible, [role=alert]:visible";
const CHALLENGE = "iframe[src*='recaptcha/api2/bframe'], iframe[src*='recaptcha/enterprise/bframe'], iframe[src*='hcaptcha']";
const SUBMIT_TEXT = /^(?:verify|submit|confirm|proceed|continue|login)(?: otp| code)?$/i;
const TYPE_DELAY_MS = 70;
const POLL_MS = 2000;

const MOBILE = /^\d{10}$/;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

// The page's own session check, seen on the browser context (a sign-in can open and close pages): set once it answers 200.
const signedInSeen = new WeakMap<BrowserContext, { seen: boolean }>();
function watch(context: BrowserContext) {
  const known = signedInSeen.get(context);
  if (known) return known;
  const state = { seen: false };
  signedInSeen.set(context, state);
  context.on("response", (response) => {
    if (VALIDATE_CALL.test(response.url()) && response.status() === 200) state.seen = true;
  });
  return state;
}

async function visible(locator: Locator) {
  return locator.first().isVisible().catch(() => false);
}

async function challengeShown(page: Page) {
  const frames = page.locator(CHALLENGE);
  const count = await frames.count().catch(() => 0);
  for (let index = 0; index < count; index += 1) {
    const box = await frames.nth(index).boundingBox().catch(() => null);
    if (box && box.width > 50 && box.height > 50) return true;
  }
  return false;
}

/** Hirist's own words for a refusal, with any digits taken out (it may repeat the number). */
async function refusal(page: Page) {
  const errors = page.locator(ERROR_TEXT);
  const count = Math.min(await errors.count().catch(() => 0), 8);
  for (let index = 0; index < count; index += 1) {
    const text = ((await errors.nth(index).innerText().catch(() => "")) || "").replace(/\d/g, "").replace(/\s+/g, " ").trim();
    if (text.length >= 4 && text.length <= 160) return text;
  }
  return null;
}

/** The code boxes once Hirist shows them: every visible short text box that is neither the id box nor the job search. */
async function codeBoxes(page: Page) {
  const boxes = page.locator("input:visible");
  const count = await boxes.count().catch(() => 0);
  const found: Locator[] = [];
  for (let index = 0; index < count; index += 1) {
    const box = boxes.nth(index);
    const facts = await box.evaluate((element) => ({ name: (element as HTMLInputElement).name, type: (element as HTMLInputElement).type, max: (element as HTMLInputElement).maxLength })).catch(() => null);
    if (!facts || NOT_CODE.has(facts.name)) continue;
    if (!["tel", "text", "number", "password"].includes(facts.type)) continue;
    // One box of the whole code (no length) or a few of a digit each.
    if (facts.max === -1 || (facts.max >= 1 && facts.max <= 8)) found.push(box);
  }
  return found;
}

/** Waits for one of the outcomes after a press, up to `ms`; `stale` is a message already on the page before the press. */
async function settle(page: Page, ms: number, done: () => Promise<OtpStep | null>, stale: string | null): Promise<OtpStep | null> {
  const deadline = Date.now() + ms;
  // The same words as before count as this press's answer once they have gone and come back (a second wrong code).
  let cleared = stale === null;
  while (Date.now() < deadline) {
    if (await challengeShown(page)) return { state: "check" };
    const result = await done();
    if (result) return result;
    const message = await refusal(page);
    if (message === null) cleared = true;
    else if (message !== stale || cleared) return { state: "refused", message };
    await page.waitForTimeout(400);
  }
  return null;
}

/**
 * On Hirist's front page: the header's "Login", the id box, "Get OTP". `code_sent` once the code boxes show; `check` when a
 * challenge shows; `refused` with Hirist's words (an unknown id, too many tries).
 */
export async function sendLoginCode(page: Page, loginId: string): Promise<OtpStep> {
  if (!MOBILE.test(loginId) && !EMAIL.test(loginId)) return { state: "refused", message: "Enter your mobile number or email." };
  watch(page.context());
  if (await challengeShown(page)) return { state: "check" };
  const idBox = page.locator(ID_BOX);
  if (!(await visible(idBox))) {
    // The cookie banner first, as a person would; then the header's Login button opens the form.
    const gotIt = page.locator("button:visible").filter({ hasText: /^Got it$/ }).first();
    if (await gotIt.isVisible().catch(() => false)) await gotIt.click().catch(() => undefined);
    const open = page.locator("button:visible").filter({ hasText: /^Login$/ }).first();
    if (!(await open.isVisible().catch(() => false))) return { state: "refused", message: "Hirist's login did not offer a code. Try again in a minute." };
    await open.click();
    await idBox.first().waitFor({ state: "visible", timeout: 10_000 }).catch(() => undefined);
  }
  if (!(await visible(idBox))) return { state: "refused", message: "Hirist's login did not offer a code. Try again in a minute." };
  const box = idBox.first();
  await box.click();
  await box.fill("");
  await box.pressSequentially(loginId, { delay: TYPE_DELAY_MS });
  const send = page.locator(SEND_BUTTON).first();
  await send.waitFor({ state: "visible", timeout: 5_000 }).catch(() => undefined);
  for (let tries = 0; tries < 10 && (await send.isDisabled().catch(() => false)); tries += 1) await page.waitForTimeout(200);
  const stale = await refusal(page);
  await send.click();
  const outcome = await settle(page, 20_000, async () => ((await codeBoxes(page)).length > 0 ? { state: "code_sent" } : null), stale);
  return outcome ?? { state: "refused", message: "Hirist did not send a code. Try again in a minute." };
}

/**
 * Types Hirist's code into its code boxes and submits. `accepted` once the page's own session check answers signed in, or the
 * form closes; `refused` with Hirist's words for a wrong or expired code.
 */
export async function enterLoginCode(page: Page, code: string): Promise<OtpStep> {
  if (!/^\d{4,8}$/.test(code)) return { state: "refused", message: "Enter the code Hirist sent you." };
  const state = watch(page.context());
  if (await challengeShown(page)) return { state: "check" };
  const boxes = await codeBoxes(page);
  if (boxes.length === 0) return { state: "refused", message: "Ask Hirist for a code first." };
  // Before typing: a form that submits on the last digit shows its answer at once.
  const stale = await refusal(page);
  if (boxes.length === 1) {
    await boxes[0].click();
    await boxes[0].fill("");
    await boxes[0].pressSequentially(code, { delay: TYPE_DELAY_MS });
  } else {
    // One digit a box; Hirist's own page moves the cursor along, so the first box takes the whole code as typing. The
    // boxes are emptied first: after a wrong code they still hold it, and a full box takes no more.
    for (const box of boxes) await box.fill("");
    await boxes[0].click();
    await page.keyboard.type(code, { delay: TYPE_DELAY_MS });
  }
  await page.waitForTimeout(800);
  // Some code screens submit on the last digit; otherwise press the form's own button.
  if (!state.seen && (await codeBoxes(page)).length > 0) {
    const scope = page.locator("[role=dialog]:visible");
    const within = (await scope.count().catch(() => 0)) > 0 ? scope.first().locator("button:visible") : page.locator("button:visible");
    const submit = within.filter({ hasText: SUBMIT_TEXT }).first();
    if (await submit.isVisible().catch(() => false)) await submit.click().catch(() => undefined);
  }
  const outcome = await settle(page, 20_000, async () => (state.seen || (await codeBoxes(page)).length === 0 ? { state: "accepted" } : null), stale);
  return outcome ?? { state: "refused", message: "Hirist did not answer. Try again." };
}

/** A short first name for "Connected as ...", from Hirist's own session answer; null when it is not plainly there. */
export function firstNameOf(body: unknown): string | null {
  const record = (value: unknown) => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null);
  const top = record(body);
  const inner = record(top?.data) ?? record(top?.user);
  for (const candidate of [inner?.firstName, inner?.name, inner?.fullName, top?.firstName, top?.name]) {
    if (typeof candidate !== "string") continue;
    const first = candidate.trim().split(/\s+/)[0] ?? "";
    if (/^[\p{L}][\p{L}.'-]{0,39}$/u.test(first)) return first;
  }
  return null;
}

/** Opens Hirist's front page and reports whether its own session check answers signed in (200; signed out it is 401). */
export async function confirmSignedIn(page: Page): Promise<{ signedIn: boolean; accountLabel: string | null }> {
  const awaited = page.waitForResponse((response) => VALIDATE_CALL.test(response.url()), { timeout: 20_000 });
  awaited.catch(() => undefined);
  await page.goto(HOME, { waitUntil: "domcontentloaded", timeout: 30_000 });
  const response = await awaited.catch(() => null);
  if (!response || response.status() !== 200) return { signedIn: false, accountLabel: null };
  const body = await response.json().catch(() => null);
  return { signedIn: true, accountLabel: firstNameOf(body) };
}

/**
 * Waits for the person to sign in to Hirist in this window, up to `timeoutMs`: the page's own session check answers 200,
 * confirmed once by opening the front page. Ends early when the window is closed or `cancelled()` says the connection was
 * withdrawn (Disconnect pressed meanwhile).
 */
export async function waitForSignIn(page: Page, timeoutMs: number, cancelled: () => Promise<boolean>): Promise<SignInResult> {
  const deadline = Date.now() + timeoutMs;
  let lastCancelCheck = 0;
  let nextConfirm = 0;
  const state = watch(page.context());
  while (Date.now() < deadline) {
    const current = livePage(page);
    if (!current) return { status: "closed" };
    if (Date.now() - lastCancelCheck > 5000) {
      lastCancelCheck = Date.now();
      if (await cancelled()) return { status: "cancelled" };
    }
    if (state.seen && Date.now() >= nextConfirm) {
      // Let Hirist finish its own redirect after sign-in before the page is moved.
      await current.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => undefined);
      const confirmed = await confirmSignedIn(current).catch(() => ({ signedIn: false, accountLabel: null }));
      if (confirmed.signedIn) return { status: "signed_in", accountLabel: confirmed.accountLabel };
      // Not signed in after all: asked again only after a pause, so a half-finished sign-in is never interrupted twice in a row.
      state.seen = false;
      nextConfirm = Date.now() + 20_000;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  return { status: "timeout" };
}
