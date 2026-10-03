import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Locator, Page } from "playwright";
import type { AtsAdapter, FilledField, FormField, ResolvedValue, SubmitContext, SubmitResult } from "../adapter";
import { NoRetryError } from "../adapter";
import { fillText, selectOption } from "./common";

// Greenhouse hosts the same form for every board, even when the listing lives on a company careers site.
function formUrl(job: { applyUrl: string; externalId: string; companySlug: string }) {
  const eu = /(^|\.)eu\.greenhouse\.io$/i.test(safeHost(job.applyUrl));
  const host = eu ? "job-boards.eu.greenhouse.io" : "job-boards.greenhouse.io";
  return `https://${host}/embed/job_app?for=${encodeURIComponent(job.companySlug)}&token=${encodeURIComponent(job.externalId)}`;
}

function safeHost(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

function byId(id: string) {
  return `[id="${id.replace(/"/g, '\\"')}"]`;
}

const SEARCHABLE_OVER = 50;

function cleanLabel(text: string) {
  return text.replace(/\s+/g, " ").replace(/\s*\*\s*$/, "").trim();
}

async function waitForForm(page: Page) {
  await page.locator("#first_name, #application-form, form").first().waitFor({ timeout: 30000 });
  // The uploader script loads after the form renders; files attached before it is ready are dropped.
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
}

async function attachFile(page: Page, value: ResolvedValue, bytes: Uint8Array) {
  const id = value.selector.match(/^\[id="(.+)"\]$/)?.[1] ?? "resume";
  const name = value.fileName ?? "resume.pdf";
  const dir = await mkdtemp(join(tmpdir(), "swipeapply-"));
  const cleanup = async () => {
    await rm(dir, { recursive: true, force: true });
  };
  try {
    const file = join(dir, name);
    await writeFile(file, bytes);
    const group = page.locator(`[aria-labelledby="upload-label-${id}"]`);
    const button = group.locator("button", { hasText: "Attach" });
    if (await button.count()) {
      const [chooser] = await Promise.all([page.waitForEvent("filechooser", { timeout: 10000 }), button.first().click()]);
      await chooser.setFiles(file);
    } else {
      await page.locator(value.selector).setInputFiles(file);
    }
    const attached = page.locator(`[aria-labelledby="upload-label-${id}"] .file-upload__filename`, { hasText: name });
    const failed = page.locator(`[id="${id}-error"]`);
    const deadline = Date.now() + 30000;
    while (!(await attached.count())) {
      const message = (await failed.count()) ? (await failed.innerText()).trim() : "";
      if (message) throw new Error(`Resume upload failed: ${message}`);
      if (Date.now() > deadline) throw new Error("Resume upload did not finish in 30s");
      await page.waitForTimeout(500);
    }
    return cleanup;
  } catch (error) {
    await cleanup();
    throw error;
  }
}

async function closeMenu(page: Page) {
  await page.keyboard.press("Escape");
  await page.waitForTimeout(100);
}

// Each combobox owns its listbox; the phone widget keeps a second, always-present country listbox.
async function optionsFor(page: Page, input: Locator) {
  const controls = await input.getAttribute("aria-controls");
  const id = await input.getAttribute("id");
  const listbox = controls ? `[id="${controls}"]` : `[id="react-select-${id}-listbox"]`;
  return page.locator(`${listbox} [role="option"]`);
}

async function readComboboxOptions(page: Page, input: Locator) {
  await input.scrollIntoViewIfNeeded();
  await input.click();
  const options = await optionsFor(page, input);
  await options.first().waitFor({ timeout: 1500 }).catch(() => undefined);
  const texts = (await options.allInnerTexts()).map((text) => text.replace(/\s+/g, " ").trim()).filter(Boolean);
  await closeMenu(page);
  return texts;
}

async function readFields(page: Page): Promise<FormField[]> {
  await waitForForm(page);
  const raw = await page.evaluate(() => {
    const rows: Array<{ id: string; label: string; kind: string; required: boolean; options?: string[] }> = [];
    document.querySelectorAll("input, select, textarea").forEach((node) => {
      const el = node as HTMLInputElement;
      const type = (el.getAttribute("type") ?? el.tagName).toLowerCase();
      // Inline on purpose: tsx wraps named functions in a helper that does not exist inside the page.
      let label = (el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent : "") ?? "";
      if (!label.trim() && el.getAttribute("aria-labelledby")) {
        label = (el.getAttribute("aria-labelledby") ?? "")
          .split(/\s+/)
          .map((part) => document.getElementById(part)?.textContent ?? "")
          .join(" ");
      }
      if (!label.trim()) label = el.closest("label")?.textContent ?? el.getAttribute("aria-label") ?? "";
      if (!el.id || ["hidden", "submit", "search", "button"].includes(type)) return;
      if (el.id.startsWith("g-recaptcha") || el.id.startsWith("iti-")) return;
      const required = el.required || el.getAttribute("aria-required") === "true";
      if (el.tagName === "SELECT") {
        const options = Array.from((el as unknown as HTMLSelectElement).options)
          .filter((option) => option.value)
          .map((option) => option.textContent?.trim() ?? "");
        rows.push({ id: el.id, label, kind: "select", required, options });
        return;
      }
      if (el.getAttribute("role") === "combobox") {
        rows.push({ id: el.id, label, kind: "combobox", required });
        return;
      }
      if (type === "checkbox") {
        const group = el.closest("fieldset");
        const legend = group?.querySelector("legend")?.textContent ?? "";
        rows.push({ id: el.id, label: legend ? `${legend} — ${label}` : label, kind: "checkbox", required });
        return;
      }
      if (type === "radio") return;
      rows.push({ id: el.id, label, kind: el.tagName === "TEXTAREA" ? "textarea" : type, required });
    });
    return rows;
  });

  const fields: FormField[] = [];
  for (const row of raw) {
    const selector = byId(row.id);
    const label = cleanLabel(row.label) || row.id;
    if (row.kind === "combobox") {
      const options = await readComboboxOptions(page, page.locator(selector));
      // Location pickers show nothing until you type, and long lists (schools) only load a first page,
      // so both are treated as search fields: the answer is typed and matched against the live results.
      const searchable = options.length === 0 || options.length > SEARCHABLE_OVER;
      fields.push({ selector, label, type: "combobox", required: row.required, options: searchable ? undefined : options });
      continue;
    }
    fields.push({ selector, label, type: row.kind === "tel" || row.kind === "email" ? "text" : row.kind, required: row.required, options: row.options });
  }
  return fields;
}

function norm(text: string) {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function bestOption(options: string[], wanted: string) {
  const target = norm(wanted);
  const normalized = options.map(norm);
  const exact = normalized.indexOf(target);
  if (exact >= 0) return options[exact];
  const starts = normalized.findIndex((option) => option.startsWith(target));
  if (starts >= 0) return options[starts];
  const contains = normalized.findIndex((option) => option.includes(target));
  if (contains >= 0) return options[contains];
  return null;
}

async function pickCombobox(page: Page, selector: string, value: string, label: string) {
  const input = page.locator(selector);
  await input.scrollIntoViewIfNeeded();
  await input.click();
  await input.fill(value);
  const options = await optionsFor(page, input);
  await options.first().waitFor({ timeout: 8000 }).catch(() => undefined);
  const texts = (await options.allInnerTexts()).map((text) => text.trim());
  const choice = bestOption(texts, value);
  if (!choice) {
    await closeMenu(page);
    throw new Error(`No option "${value}" for "${label}"`);
  }
  await options.nth(texts.indexOf(choice)).click();
  return choice;
}

async function setCheckbox(page: Page, selector: string, value: string) {
  const checked = /^(yes|true|checked|agree|i agree|1)$/i.test(value.trim());
  const box = page.locator(selector);
  if (checked) await box.check({ force: true });
  else await box.uncheck({ force: true });
}

async function visibleErrors(page: Page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[aria-invalid="true"]'))
      .map((el) => {
        const id = el.id;
        const label = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent : null;
        return (label ?? id ?? "").replace(/\s+/g, " ").replace(/\*$/, "").trim();
      })
      .filter(Boolean),
  );
}

async function captchaChallengeVisible(page: Page) {
  const frames = page.locator('iframe[src*="recaptcha"][src*="bframe"]');
  const count = await frames.count();
  for (let index = 0; index < count; index += 1) {
    if (await frames.nth(index).isVisible()) return true;
  }
  return false;
}

const CONFIRMATION_TEXT = /thank you for applying|application (has been )?(submitted|received)|we('| ha)ve received your application/i;

const SECURITY_INPUTS = '[id^="security-input-"]';
const MAX_CODE_TRIES = 3;

async function securityCodeVisible(page: Page) {
  const inputs = page.locator(SECURITY_INPUTS);
  return (await inputs.count()) > 0 && (await inputs.first().isVisible());
}

// Greenhouse emails a one-time code after the first submit and only sends the application once it is entered.
async function enterSecurityCode(page: Page, code: string) {
  const chars = code.replace(/\s+/g, "");
  const inputs = page.locator(SECURITY_INPUTS);
  const count = await inputs.count();
  if (count > 1 && chars.length === count) {
    for (let index = 0; index < count; index += 1) await inputs.nth(index).fill(chars[index]);
  } else {
    await inputs.first().click();
    await page.keyboard.type(chars, { delay: 40 });
  }
  await page.getByRole("button", { name: /submit/i }).last().click();
}

async function confirmation(page: Page) {
  if (/\/confirmation/i.test(page.url())) return `url ${page.url()}`;
  const body = await page.locator("body").innerText().catch(() => "");
  const match = body.match(CONFIRMATION_TEXT);
  return match ? `text "${match[0]}"` : null;
}

export async function waitForGreenhouseConfirmation(page: Page, ctx: SubmitContext, timeoutMs = 45000) {
  let deadline = Date.now() + timeoutMs;
  let codeTries = 0;
  while (Date.now() < deadline) {
    const confirmed = await confirmation(page);
    if (confirmed) return codeTries > 0 ? `${confirmed} after security code` : confirmed;
    if (await securityCodeVisible(page)) {
      // The inputs stay up while Greenhouse checks a code; only treat it as rejected after 15s with no confirmation.
      if (codeTries > 0) {
        const settle = Date.now() + 15000;
        while (Date.now() < settle && !(await confirmation(page))) await page.waitForTimeout(1000);
        if (await confirmation(page)) continue;
      }
      if (codeTries >= MAX_CODE_TRIES) throw new NoRetryError("Greenhouse did not accept the security code after 3 tries.");
      const prompt =
        codeTries === 0
          ? "Greenhouse emailed you a security code to finish this application. Enter it here."
          : "Greenhouse did not accept that code. Check the latest email and enter the code again.";
      const code = await ctx.requestCode(prompt);
      if (!code) throw new NoRetryError("Security code was not entered in time. Open the form and apply by hand.");
      codeTries += 1;
      await enterSecurityCode(page, code);
      deadline = Date.now() + timeoutMs;
      continue;
    }
    if (await captchaChallengeVisible(page)) {
      throw new NoRetryError("Greenhouse showed a CAPTCHA. Open the form and submit it yourself.");
    }
    const errors = await visibleErrors(page);
    if (errors.length > 0) {
      throw new NoRetryError(`Greenhouse rejected the form: ${errors.slice(0, 5).join(", ")}`);
    }
    await page.waitForTimeout(1000);
  }
  throw new NoRetryError("Submit clicked but no confirmation appeared. Check your email before applying again.");
}

export const greenhouseAdapter: AtsAdapter = {
  source: "greenhouse",
  matches(url: string) {
    return /greenhouse\.io/i.test(url) || /[?&]gh_jid=/i.test(url);
  },
  formUrl,
  inspect(page: Page) {
    return readFields(page);
  },
  uploadFile: attachFile,
  async fill(page, values) {
    const filled: FilledField[] = [];
    for (const value of values) {
      if (value.type === "file") continue;
      let written = value.value;
      if (value.type === "combobox") written = await pickCombobox(page, value.selector, value.value, value.label);
      else if (value.type === "select") await selectOption(page, value.selector, { label: value.value });
      else if (value.type === "checkbox") await setCheckbox(page, value.selector, value.value);
      else await fillText(page, value.selector, value.value);
      filled.push({ key: value.key, label: value.label, value: written, source: value.source, selector: value.selector });
    }
    return filled;
  },
  async submit(page, ctx): Promise<SubmitResult> {
    await page.getByRole("button", { name: /submit application/i }).click();
    const evidence = await waitForGreenhouseConfirmation(page, ctx);
    return { confirmed: true, evidence };
  },
};
