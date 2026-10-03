import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "playwright";

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
