import type { Page, Response } from "playwright";
import { SITE_INFO } from "@/modules/sources/sites";
import { livePage } from "../browser";

/**
 * Naukri in the user's own visible window (Phase K, docs/naukri/TDD.md 4.5). Worker only. The agent never reads or
 * types into Naukri's login form: it waits for the account to be signed in, by whatever means the person used.
 *
 * Signed-in signals (any): a page under /mnjuser/ (Naukri's signed-in area, where it lands after sign-in), or Naukri's
 * auth cookie. Confirmed by opening the signed-in home page: signed out, Naukri sends that to /nlogin/.
 */

const NAUKRI = SITE_INFO.naukri;
const LOGIN_PATH = /\/nlogin\//i;
const SIGNED_IN_PATH = /\/mnjuser\//i;
// Naukri's access-token cookie (set on sign-in, removed on sign-out); one signal among two, never the only proof.
const AUTH_COOKIE = /^nauk_at$/i;
const PROFILE_CALL = /\/users\/self\b/i;
const POLL_MS = 2000;

export type SignInResult =
  | { status: "signed_in"; accountLabel: string | null }
  | { status: "closed" }
  | { status: "timeout" }
  | { status: "cancelled" };

/** A short first name for "Connected as ...", from Naukri's own account response; null when it is not plainly there. */
export function firstNameOf(body: unknown): string | null {
  const record = (value: unknown) => (value && typeof value === "object" ? (value as Record<string, unknown>) : null);
  const top = record(body);
  const profile = record(Array.isArray(top?.profile) ? top?.profile[0] : top?.profile);
  const user = record(top?.user);
  for (const candidate of [profile?.name, top?.name, user?.name]) {
    if (typeof candidate !== "string") continue;
    const first = candidate.trim().split(/\s+/)[0] ?? "";
    if (/^[\p{L}][\p{L}.'-]{0,39}$/u.test(first)) return first;
  }
  return null;
}

// The page is never moved while it is on Naukri's login pages: a password step can be followed by an OTP step, and
// moving the page then would throw away what the person typed.
async function looksSignedIn(page: Page) {
  const open = page.context().pages().filter((candidate) => !candidate.isClosed());
  if (open.some((candidate) => SIGNED_IN_PATH.test(candidate.url()))) return true;
  if (LOGIN_PATH.test(page.url())) return false;
  const cookies = await page.context().cookies("https://www.naukri.com").catch(() => []);
  return cookies.some((cookie) => AUTH_COOKIE.test(cookie.name) && cookie.value.length > 0);
}

/**
 * Opens Naukri's signed-in home page in this window and reports whether the account is signed in, with the first name
 * Naukri's own account call returns on the way (read once, only the first name kept).
 */
export async function confirmSignedIn(page: Page): Promise<{ signedIn: boolean; accountLabel: string | null }> {
  let accountLabel: string | null = null;
  const onResponse = (response: Response) => {
    if (accountLabel || !PROFILE_CALL.test(response.url()) || response.status() !== 200) return;
    void response
      .json()
      .then((body) => {
        accountLabel ??= firstNameOf(body);
      })
      .catch(() => undefined);
  };
  page.on("response", onResponse);
  try {
    await page.goto(NAUKRI.homeUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
    const url = page.url();
    return { signedIn: SIGNED_IN_PATH.test(url) && !LOGIN_PATH.test(url), accountLabel };
  } finally {
    page.off("response", onResponse);
  }
}

/** Why a page read stopped a run (docs/naukri/TDD.md 4.8). */
export type PageStop = "needs_signin" | "challenge" | "refused" | "error";
export type PageRead = { ok: true; json: unknown } | { ok: false; stop: PageStop; detail: string };

const SEARCH_CALL = /\/jobapi\/v3\/search\b/i;
const JOB_CALL = (jobId: string) => new RegExp(`/jobapi/v4/job/${jobId.replace(/[^0-9a-z]/gi, "")}\\b`, "i");
const CHECK_TEXT = /verify (?:that )?you(?:'re| are) (?:a )?human|unusual (?:activity|traffic)|are you a robot|complete the security check|captcha/i;

/**
 * What the page is showing when it did not give us the listings: Naukri's login (signed out), a check (CAPTCHA,
 * "unusual activity"), Akamai's "Access Denied", or nothing we recognise. Reads the page's title and text only.
 */
export async function pageStop(page: Page): Promise<{ stop: PageStop; detail: string }> {
  if (LOGIN_PATH.test(page.url())) return { stop: "needs_signin", detail: "Naukri showed its sign-in page" };
  const title = await page.title().catch(() => "");
  const text = await page.locator("body").innerText({ timeout: 3000 }).catch(() => "");
  if (/access denied/i.test(title) || /^\s*access denied/i.test(text)) return { stop: "refused", detail: "Naukri answered Access Denied" };
  const recaptcha = await page.locator('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[title*="challenge" i]').count().catch(() => 0);
  if (recaptcha > 0 || CHECK_TEXT.test(text.slice(0, 4000))) return { stop: "challenge", detail: "Naukri asked for a check" };
  return { stop: "error", detail: "Naukri's page did not load its listings" };
}

/** A response Naukri's own page received: its status decides; 406 is Naukri's "recaptcha required", 403 a refusal. */
async function readCall(page: Page, url: string, call: RegExp): Promise<PageRead> {
  const awaited = page.waitForResponse((response) => call.test(response.url()) && response.request().method() === "GET", { timeout: 30000 });
  // Handled at once: when it times out while the page is still loading, an unhandled rejection ended the whole worker
  // process (25 Nov, a slow page through the proxy). It is still awaited below.
  awaited.catch(() => undefined);
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  } catch {
    return { ok: false, ...(await pageStop(page)) };
  }
  const response = await awaited.catch(() => null);
  if (!response) return { ok: false, ...(await pageStop(page)) };
  if (response.status() === 406) return { ok: false, stop: "challenge", detail: "Naukri asked its page for a reCAPTCHA" };
  if (response.status() === 403) return { ok: false, stop: "refused", detail: "Naukri refused the page (403)" };
  if (response.status() === 401) return { ok: false, stop: "needs_signin", detail: "Naukri answered 401" };
  if (!response.ok()) return { ok: false, stop: "error", detail: `Naukri answered ${response.status()}` };
  const json = await response.json().catch(() => null);
  return json ? { ok: true, json } : { ok: false, stop: "error", detail: "Naukri's answer was not JSON" };
}

/** One of Naukri's own search pages, as a person opens it; the listings its own script fetched. */
export function readSearch(page: Page, url: string) {
  return readCall(page, url, SEARCH_CALL);
}

/** One of Naukri's own job pages; the posting its own script fetched. */
export function readJob(page: Page, url: string, jobId: string) {
  return readCall(page, url, JOB_CALL(jobId));
}

/** The window is on a signed-in Naukri page (after opening the signed-in home page). */
export function onSignedInPage(page: Page) {
  const url = page.url();
  return SIGNED_IN_PATH.test(url) && !LOGIN_PATH.test(url);
}

/**
 * Waits for the person to sign in to Naukri in this window, up to `timeoutMs`. Ends early when the window is closed or
 * `cancelled()` says the connection was withdrawn (Disconnect pressed meanwhile).
 */
export async function waitForSignIn(page: Page, timeoutMs: number, cancelled: () => Promise<boolean>): Promise<SignInResult> {
  const deadline = Date.now() + timeoutMs;
  let lastCancelCheck = 0;
  let nextConfirm = 0;
  while (Date.now() < deadline) {
    const current = livePage(page);
    if (!current) return { status: "closed" };
    if (Date.now() - lastCancelCheck > 5000) {
      lastCancelCheck = Date.now();
      if (await cancelled()) return { status: "cancelled" };
    }
    if (Date.now() >= nextConfirm && (await looksSignedIn(current))) {
      // Let Naukri finish its own redirect after sign-in before the page is moved.
      await current.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => undefined);
      const confirmed = await confirmSignedIn(current).catch(() => ({ signedIn: false, accountLabel: null }));
      if (confirmed.signedIn) return { status: "signed_in", accountLabel: confirmed.accountLabel };
      // Not signed in after all: Naukri has already sent the page back to its login, so the person carries on there.
      // Checked again only after a pause, so a half-finished sign-in is never interrupted twice in a row.
      nextConfirm = Date.now() + 20000;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  return { status: "timeout" };
}
