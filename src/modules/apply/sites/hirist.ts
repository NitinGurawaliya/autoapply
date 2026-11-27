import type { Page } from "playwright";
import { CHECK_TEXT, readCall, type PageRead, type PageStop } from "./read";

/**
 * Hirist's own pages, signed out (K17, docs/hirist/TDD.md 4.2). Worker only. A search page and a job page are opened as a
 * person opens them and we take the JSON their own script fetched (shapes: fetchers/hirist.ts): never Hirist's API called
 * by us, never a signature made. The sign-in part (K18) joins here.
 *
 * Calls as the K17 probe saw them (27 Nov): `/search/<text>` fetches `gladiator.hirist.tech/job/search`; a skill page
 * (`/k/python-jobs`) and a city page `/job/keyword/`; a job page `/job/detail?jobcode=<id>`. No signature header; the
 * site's own bot check, when it shows one, is a captcha on the page.
 */

const SEARCH_CALL = /gladiator\.hirist\.tech\/job\/(?:search|keyword)(?:[/?]|$)/i;
const JOB_CALL = (jobId: string) => new RegExp(`gladiator\\.hirist\\.tech/job/detail\\?jobcode=${jobId.replace(/[^0-9]/g, "")}(?:&|$)`, "i");

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
