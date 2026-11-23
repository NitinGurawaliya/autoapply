import type { Locator, Page } from "playwright";

/**
 * OTP connect (K8b, owner 23 Nov; docs/naukri/TDD.md 13.16): the agent enters the user's mobile number and Naukri's
 * code on Naukri's own login page, so the page makes every request itself (reCAPTCHA token included). Never a password.
 * The code is typed and forgotten: nothing here keeps, logs or reads back the number or the code. A challenge on the
 * page is the user's (the phone shows the page, K8); nothing here touches it.
 *
 * Naukri's page as read on 23 Nov: "Use OTP to Login" (`button.otpBut`) shows a 10-digit box (`input.mobileInputt`)
 * and "Get OTP" (`button.sndbtn`, disabled until ten digits). The code screen shows only once a real code is sent, so
 * its boxes are found when it shows: six of one digit, or one of four to six.
 */

export type OtpStep = { state: "code_sent" } | { state: "accepted" } | { state: "check" } | { state: "refused"; message: string };

const OTP_BUTTON = "button.otpBut, button:has-text('Use OTP to Login')";
const MOBILE_BOX = "input.mobileInputt, input[type=tel][maxlength='10']";
const SEND_BUTTON = "button.sndbtn, button:has-text('Get OTP')";
// What Naukri shows when it turns a number or a code away. Only the words are kept, never a digit.
const ERROR_TEXT = "[class*='err' i]:visible, [class*='error' i]:visible, [role=alert]:visible";
// A reCAPTCHA challenge the person must answer (the invisible check on its own shows nothing).
const CHALLENGE = "iframe[src*='recaptcha/api2/bframe'], iframe[src*='recaptcha/enterprise/bframe'], iframe[src*='hcaptcha']";
const TYPE_DELAY_MS = 70;

async function visible(locator: Locator) {
  return locator.first().isVisible().catch(() => false);
}

/** A challenge frame on screen: the step goes to the person. */
async function challengeShown(page: Page) {
  const frames = page.locator(CHALLENGE);
  const count = await frames.count().catch(() => 0);
  for (let index = 0; index < count; index += 1) {
    const box = await frames.nth(index).boundingBox().catch(() => null);
    if (box && box.width > 50 && box.height > 50) return true;
  }
  return false;
}

/** Naukri's own words for a refusal, with any digits taken out (it may repeat the number). */
async function refusal(page: Page) {
  const errors = page.locator(ERROR_TEXT);
  const count = Math.min(await errors.count().catch(() => 0), 8);
  for (let index = 0; index < count; index += 1) {
    const text = ((await errors.nth(index).innerText().catch(() => "")) || "").replace(/\d/g, "").replace(/\s+/g, " ").trim();
    if (text.length >= 4 && text.length <= 160) return text;
  }
  return null;
}

/** The code boxes once Naukri shows them: every visible short box that is not the number box or the job search. */
async function codeBoxes(page: Page) {
  const boxes = page.locator("input:visible").filter({ hasNot: page.locator(".suggestor-input") });
  const count = await boxes.count().catch(() => 0);
  const found: Locator[] = [];
  for (let index = 0; index < count; index += 1) {
    const box = boxes.nth(index);
    const facts = await box
      .evaluate((element) => {
        const input = element as HTMLInputElement;
        return { max: input.maxLength, type: input.type, mobile: input.classList.contains("mobileInputt"), search: input.id === "experienceDD" };
      })
      .catch(() => null);
    if (!facts || facts.mobile || facts.search) continue;
    if (!["tel", "text", "number", "password"].includes(facts.type)) continue;
    if (facts.max >= 1 && facts.max <= 8) found.push(box);
  }
  return found;
}

/**
 * Waits for one of the outcomes after a press, up to `ms`. `stale` is a message that was already on the page before the
 * press (the last wrong code's): it is not this press's answer.
 */
async function settle(page: Page, ms: number, done: () => Promise<OtpStep | null>, stale: string | null): Promise<OtpStep | null> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await challengeShown(page)) return { state: "check" };
    const result = await done();
    if (result) return result;
    const message = await refusal(page);
    if (message && message !== stale) return { state: "refused", message };
    await page.waitForTimeout(400);
  }
  return null;
}

/**
 * On Naukri's login page: "Use OTP to Login", the number, "Get OTP". `code_sent` once the code boxes show; `check` when
 * a challenge shows; `refused` with Naukri's words (an unknown number, too many tries).
 */
export async function sendLoginCode(page: Page, mobile: string): Promise<OtpStep> {
  if (!/^\d{10}$/.test(mobile)) return { state: "refused", message: "Enter your 10-digit mobile number." };
  if (await challengeShown(page)) return { state: "check" };
  const mobileBox = page.locator(MOBILE_BOX);
  if (!(await visible(mobileBox))) {
    const otpButton = page.locator(OTP_BUTTON).first();
    if (!(await otpButton.isVisible().catch(() => false))) return { state: "refused", message: "Naukri's login did not offer a code. Try again in a minute." };
    await otpButton.click();
    await mobileBox.first().waitFor({ state: "visible", timeout: 10_000 }).catch(() => undefined);
  }
  if (!(await visible(mobileBox))) return { state: "refused", message: "Naukri's login did not offer a code. Try again in a minute." };
  const box = mobileBox.first();
  await box.click();
  await box.fill("");
  await box.pressSequentially(mobile, { delay: TYPE_DELAY_MS });
  const send = page.locator(SEND_BUTTON).first();
  await send.waitFor({ state: "visible", timeout: 5_000 }).catch(() => undefined);
  for (let tries = 0; tries < 10 && (await send.evaluate((element) => element.classList.contains("disabled") || (element as HTMLButtonElement).disabled).catch(() => false)); tries += 1) {
    await page.waitForTimeout(200);
  }
  const stale = await refusal(page);
  await send.click();
  const outcome = await settle(page, 20_000, async () => ((await codeBoxes(page)).length > 0 ? { state: "code_sent" } : null), stale);
  return outcome ?? { state: "refused", message: "Naukri did not send a code. Try again in a minute." };
}

/**
 * Types Naukri's code into its code boxes and submits. `accepted` once the page leaves the login (the sign-in check in
 * sites/naukri.ts waitForSignIn confirms it), `refused` with Naukri's words for a wrong or expired code.
 */
export async function enterLoginCode(page: Page, code: string): Promise<OtpStep> {
  if (!/^\d{4,8}$/.test(code)) return { state: "refused", message: "Enter the code Naukri texted you." };
  if (await challengeShown(page)) return { state: "check" };
  const boxes = await codeBoxes(page);
  if (boxes.length === 0) return { state: "refused", message: "Ask Naukri for a code first." };
  if (boxes.length === 1) {
    await boxes[0].click();
    await boxes[0].fill("");
    await boxes[0].pressSequentially(code, { delay: TYPE_DELAY_MS });
  } else {
    // One digit a box; Naukri's own page moves the cursor along, so the first box takes the whole code as typing.
    await boxes[0].click();
    await page.keyboard.type(code, { delay: TYPE_DELAY_MS });
  }
  const stale = await refusal(page);
  const startUrl = page.url();
  // Some code screens submit on the last digit; otherwise press the screen's own button.
  await page.waitForTimeout(600);
  if (page.url() === startUrl) {
    const submit = page.locator("button:visible").filter({ hasText: /verify|login|submit|continue/i }).filter({ hasNotText: /email|resend|otp to login/i }).first();
    if (await submit.isVisible().catch(() => false)) await submit.click().catch(() => undefined);
  }
  const outcome = await settle(page, 15_000, async () => (page.isClosed() || !/\/nlogin\//.test(page.url()) ? { state: "accepted" } : null), stale);
  if (outcome) return outcome;
  // Still on the login with the same words as before (a second wrong code): refused again.
  const still = await refusal(page);
  if (still && /\/nlogin\//.test(page.url())) return { state: "refused", message: still };
  // No word from Naukri: the sign-in check decides; the phone waits for it.
  return { state: "accepted" };
}
