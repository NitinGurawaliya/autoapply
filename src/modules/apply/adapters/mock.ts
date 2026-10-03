import type { Page } from "playwright";
import type { AtsAdapter, FilledField, FormField, ResolvedValue, SubmitResult } from "../adapter";
import { fillText, pickComboboxOption, selectOption, uploadFile, waitForConfirmation } from "./common";

async function readFields(page: Page): Promise<FormField[]> {
  const locators = page.locator("input, select, textarea");
  const count = await locators.count();
  const fields: FormField[] = [];
  for (let index = 0; index < count; index += 1) {
    const locator = locators.nth(index);
    const id = await locator.getAttribute("id");
    if (!id) continue;
    const tag = await locator.evaluate((element) => element.tagName.toLowerCase());
    const inputType = (await locator.getAttribute("type")) ?? tag;
    if (inputType === "hidden" || inputType === "submit") continue;
    const labelText = (await page.locator(`label[for="${id}"]`).first().textContent())?.trim() || id;
    const required = (await locator.getAttribute("required")) != null;
    let options: string[] | undefined;
    if (tag === "select") {
      options = await locator.locator("option").evaluateAll((nodes) =>
        nodes
          .map((node) => (node as HTMLOptionElement).value)
          .filter((value) => value.length > 0),
      );
    }
    fields.push({
      selector: `#${id}`,
      label: labelText,
      type: tag === "select" ? "select" : inputType,
      required,
      options,
    });
  }
  return fields;
}

export const mockAdapter: AtsAdapter = {
  source: "mock",
  matches(url: string) {
    try {
      return new URL(url).pathname.replace(/\/$/, "") === "/mock/greenhouse";
    } catch {
      return false;
    }
  },
  inspect(page: Page) {
    return readFields(page);
  },
  async fill(page, values) {
    const filled: FilledField[] = [];
    for (const value of values) {
      if (value.type === "file") continue;
      if (value.key === "how_heard") await pickComboboxOption(page, value.selector, value.value);
      else if (value.type === "select") await selectOption(page, value.selector, value.value);
      else await fillText(page, value.selector, value.value);
      filled.push({
        key: value.key,
        label: value.label,
        value: value.value,
        source: value.source,
        selector: value.selector,
      });
    }
    return filled;
  },
  async submit(page): Promise<SubmitResult> {
    await page.getByRole("button", { name: "Submit application" }).click();
    try {
      const evidence = await waitForConfirmation(page);
      return { confirmed: evidence.includes("/mock/submissions"), evidence };
    } catch (error) {
      const url = page.url();
      const message = error instanceof Error ? error.message : "submit failed";
      throw new Error(`${message} at ${url}`);
    }
  },
};

export async function uploadResume(page: Page, value: ResolvedValue, bytes: Uint8Array) {
  return uploadFile(page, value.selector, bytes, value.fileName ?? "resume.pdf");
}
