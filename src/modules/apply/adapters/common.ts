import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "playwright";
import { NoRetryError } from "../adapter";

export async function fillText(page: Page, selector: string, value: string) {
  await page.locator(selector).fill(value);
}

export async function selectOption(page: Page, selector: string, value: string | { label: string }) {
  await page.locator(selector).selectOption(value);
}

export async function pickComboboxOption(page: Page, selector: string, labelText: string) {
  const input = page.locator(selector);
  await input.click();
  await input.fill(labelText);
  const option = page.getByRole("option", { name: labelText, exact: true });
  if (await option.count()) await option.first().click();
}

export async function uploadFile(page: Page, selector: string, bytes: Uint8Array, name: string) {
  const dir = await mkdtemp(join(tmpdir(), "swipeapply-"));
  const file = join(dir, name);
  await writeFile(file, bytes);
  await page.locator(selector).setInputFiles(file);
  return async () => {
    await rm(dir, { recursive: true, force: true });
  };
}

export async function waitForConfirmation(page: Page) {
  await page.waitForURL(/\/mock\/submissions/, { timeout: 20000, waitUntil: "domcontentloaded" });
  return page.url();
}

const CLOSED = /page not found|no longer (available|open|accepting)|(job|position|posting|role) (is |has |has been )?(closed|not found|filled|expired)|doesn.t exist|can.t find that page|the job you are looking for/i;

/** Job boards keep listing jobs the company has already taken down. */
export function looksClosed(text: string) {
  return CLOSED.test(text);
}

/** Call when the application form did not appear: a closed job is a clear answer, not a mystery timeout. */
export async function assertJobOpen(page: Page) {
  const text = await page.locator("body").innerText().catch(() => "");
  if (looksClosed(text)) throw new NoRetryError("This job is no longer open.");
}

/**
 * Calendar inputs want a real date. Accepts "2026-12-01", "15 Nov 2026", "Nov 15, 2026", or a plain number of days
 * from now (the way notice periods are usually answered). Returns MM/DD/YYYY, or null when it is not a date.
 */
export function toDatePickerText(value: string, now = new Date()) {
  const text = value.trim();
  let date: Date | null = null;
  if (/^\d{1,3}$/.test(text)) {
    date = new Date(now.getTime() + Number(text) * 24 * 60 * 60 * 1000);
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    date = new Date(`${text}T00:00:00Z`);
  } else if (/[a-z]/i.test(text) && /\d{4}|\d{1,2}/.test(text)) {
    const parsed = new Date(`${text} UTC`);
    date = Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (!date || Number.isNaN(date.getTime())) return null;
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${mm}/${dd}/${date.getUTCFullYear()}`;
}

const BANNER_BUTTONS = [
  "#onetrust-reject-all-handler",
  "button:has-text('Reject all')",
  "button:has-text('Reject All')",
  "button:has-text('Decline')",
  "button:has-text('Necessary only')",
  "button:has-text('Only necessary')",
  "#onetrust-accept-btn-handler",
  "button[aria-label='Close cookie banner']",
];

/**
 * Cookie banners sit on top of the page and swallow clicks, including the one on Submit. Decline the optional cookies
 * when a banner is there; when none is, this costs a few milliseconds.
 */
export async function dismissOverlays(page: Page) {
  for (const selector of BANNER_BUTTONS) {
    const button = page.locator(selector).first();
    if (await button.isVisible().catch(() => false)) {
      await button.click({ timeout: 3000 }).catch(() => undefined);
      await page.waitForTimeout(300);
      return true;
    }
  }
  return false;
}

/** Playwright errors read like a stack trace; the first useful line, in words a person can act on. */
export function friendlyError(error: unknown) {
  const text = error instanceof Error ? error.message : String(error);
  const first = text.split(String.fromCharCode(10)).find((line) => line.trim()) ?? text;
  if (/timeout/i.test(first) && /waiting for/i.test(text)) {
    const waiting = text.match(/waiting for (.{1,80})/i)?.[1]?.replace(/\u001b\[[0-9;]*m/g, "").trim();
    return `the page never showed ${waiting ?? "the control"}`;
  }
  if (/intercepts pointer events/i.test(text)) return "something on the page (a banner or pop-up) was covering it";
  if (/not visible|not attached|detached/i.test(text)) return "the control disappeared or stayed hidden";
  if (/not enabled|disabled/i.test(text)) return "the control was disabled";
  return first.replace(/\u001b\[[0-9;]*m/g, "").slice(0, 140);
}

/** Run one field's step; if it fails, say which field, so a failed run names its cause. */
export async function inField<T>(label: string, step: () => Promise<T>): Promise<T> {
  try {
    return await step();
  } catch (error) {
    if (error instanceof NoRetryError || (error instanceof Error && error.name === "NeedsAnswerError")) throw error;
    if (error && typeof error === "object" && "question" in error) throw error;
    throw new Error(`Could not fill "${label.slice(0, 70)}": ${friendlyError(error)}`);
  }
}

/** The first of these that is on the page and visible; the same Submit button is not named the same on every board. */
export async function firstVisible(page: Page, selectors: string[], timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const selector of selectors) {
      const locator = page.locator(selector).first();
      if (await locator.isVisible().catch(() => false)) return locator;
    }
    await page.waitForTimeout(500);
  }
  return null;
}
