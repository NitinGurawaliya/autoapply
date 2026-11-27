import type { Page } from "playwright";

/**
 * Reading a portal's own page (docs/hirist/TDD.md 4.1): open the page as a person does and take the JSON its own script
 * fetched. We never call the site's API ourselves and never make its signature. Shared by every site driver.
 */

/** Why a page read stopped a run (docs/naukri/TDD.md 4.8). */
export type PageStop = "needs_signin" | "challenge" | "refused" | "error";
export type PageRead = { ok: true; json: unknown } | { ok: false; stop: PageStop; detail: string };

export type ReadOptions = {
  /** The site's name in what is logged ("Naukri"). */
  label: string;
  /** What the page shows when it did not give us its listings. */
  stopOf: (page: Page) => Promise<{ stop: PageStop; detail: string }>;
  /** Statuses with a meaning of their own on this site (Naukri: 406 is its "recaptcha required"). */
  statuses?: Record<number, { stop: PageStop; detail: string }>;
};

/** A response the site's own page received: its status decides; 403 a refusal, 401 signed out. */
export async function readCall(page: Page, url: string, call: RegExp, options: ReadOptions): Promise<PageRead> {
  const { label } = options;
  const awaited = page.waitForResponse((response) => call.test(response.url()) && response.request().method() === "GET", { timeout: 30000 });
  // Handled at once: when it times out while the page is still loading, an unhandled rejection ended the whole worker
  // process (25 Nov, a slow page through the proxy). It is still awaited below.
  awaited.catch(() => undefined);
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  } catch {
    return { ok: false, ...(await options.stopOf(page)) };
  }
  const response = await awaited.catch(() => null);
  if (!response) return { ok: false, ...(await options.stopOf(page)) };
  const special = options.statuses?.[response.status()];
  if (special) return { ok: false, ...special };
  if (response.status() === 403) return { ok: false, stop: "refused", detail: `${label} refused the page (403)` };
  if (response.status() === 401) return { ok: false, stop: "needs_signin", detail: `${label} answered 401` };
  if (!response.ok()) return { ok: false, stop: "error", detail: `${label} answered ${response.status()}` };
  const json = await response.json().catch(() => null);
  return json ? { ok: true, json } : { ok: false, stop: "error", detail: `${label}'s answer was not JSON` };
}

/** Words on a page that mean a check, on any site. */
export const CHECK_TEXT = /verify (?:that )?you(?:'re| are) (?:a )?human|unusual (?:activity|traffic)|are you a robot|complete the security check|captcha/i;
