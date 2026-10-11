import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Locator, Page } from "playwright";
import type { AtsAdapter, FilledField, FormField, ResolvedValue, SubmitContext, SubmitResult } from "../adapter";
import { NeedsAnswerError, NoRetryError } from "../adapter";
import { customQuestionKey } from "@/modules/answers";
import { assertJobOpen, dismissOverlays, fillText, friendlyError, inField, selectOption } from "./common";

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

function byName(name: string) {
  return `[name="${name.replace(/"/g, '\\"')}"]`;
}

const SEARCHABLE_OVER = 50;

function cleanLabel(text: string) {
  return text.replace(/\s+/g, " ").replace(/\s*\*\s*$/, "").trim();
}

async function waitForForm(page: Page) {
  await page
    .locator("#first_name, #application-form, form")
    .first()
    .waitFor({ timeout: 25000 })
    .catch(async (error) => {
      await assertJobOpen(page);
      throw error;
    });
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
    const rows: Array<{ id: string; name?: string; label: string; kind: string; required: boolean; options?: string[] }> = [];
    const groups = new Set<string>();
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
      // Checkboxes and radios are one question per name: the fieldset legend is the question, the box labels are the
      // options. Every box in a required group carries `required`, so they must never be filled one by one.
      if (type === "checkbox" || type === "radio") {
        const name = el.getAttribute("name") || el.id;
        if (!name || groups.has(name)) return;
        groups.add(name);
        const fieldset = el.closest("fieldset");
        const legend = fieldset?.querySelector("legend")?.textContent ?? "";
        const boxes = Array.from(document.querySelectorAll(`input[name="${CSS.escape(name)}"]`)) as HTMLInputElement[];
        const options = boxes.map((box) =>
          ((box.id ? document.querySelector(`label[for="${CSS.escape(box.id)}"]`)?.textContent : "") || box.closest("label")?.textContent || box.value || "").replace(/\s+/g, " ").trim(),
        );
        // Greenhouse's demographic-data consent box says it is optional, but Greenhouse refuses the submission without it
        // once the demographic questions are answered (and they always are: "Decline to self-identify").
        const groupRequired =
          boxes.some((box) => box.required || box.getAttribute("aria-required") === "true") || fieldset?.getAttribute("aria-required") === "true" || name === "gdpr_demographic_data_consent_given";
        if (type === "radio" || boxes.length > 1) {
          rows.push({ id: el.id, name, label: legend || label, kind: type === "radio" ? "radio" : "checkbox-group", required: groupRequired, options });
        } else if (el.id) {
          rows.push({ id: el.id, label: legend || label, kind: "checkbox", required: groupRequired });
        }
        return;
      }
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
      rows.push({ id: el.id, label, kind: el.tagName === "TEXTAREA" ? "textarea" : type, required });
    });
    return rows;
  });

  const fields: FormField[] = [];
  for (const row of raw) {
    const selector = row.name ? byName(row.name) : byId(row.id);
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

/**
 * What to type into a search box, best first: the answer, then simpler forms of it, because location pickers find
 * nothing for "Greater Delhi Area" or "Bengaluru, Karnataka, India" but do for "Delhi" and "Bengaluru" (10 Oct dry run).
 */
export function searchTerms(value: string, label = "") {
  // A school is matched only by its full name: "Jaypee" alone would pick "Jaypee Institute", another school.
  if (/\b(school|university|college|institut)/i.test(label)) return [...new Set([value.trim(), value.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim()])];
  const terms = [value.trim()];
  const plain = value.replace(/\b(greater|metropolitan|metro|area|region|district|urban|rural|ncr|city of)\b/gi, " ").replace(/\s+/g, " ").trim();
  terms.push(plain, plain.split(",")[0].trim(), value.split(",")[0].trim());
  return [...new Set(terms.filter((term) => term.length >= 2))];
}

async function pickCombobox(page: Page, selector: string, value: string, label: string) {
  const input = page.locator(selector);
  await input.scrollIntoViewIfNeeded();
  await input.click();
  const options = await optionsFor(page, input);
  let texts: string[] = [];
  let choice: string | null = null;
  for (const term of searchTerms(value, label)) {
    await input.fill(term);
    await options.first().waitFor({ timeout: 8000 }).catch(() => undefined);
    texts = (await options.allInnerTexts()).map((text) => text.trim());
    choice = bestOption(texts, term);
    if (choice) break;
  }
  // A school the list does not have: its own "Other" entry is the true answer (Greenhouse's list misses many Indian
  // colleges, 11 Oct dry runs).
  if (!choice && /\b(school|university|college|institut)/i.test(label)) {
    await input.fill("Other");
    await options.first().waitFor({ timeout: 8000 }).catch(() => undefined);
    texts = (await options.allInnerTexts()).map((text) => text.trim());
    choice = texts.find((text) => /^other\b/i.test(text)) ?? null;
  }
  if (!choice) {
    // Nothing matched the search: a list that shows every option when empty (Discipline: 72 subjects, Degree) is asked
    // whole, so the user picks once and the pick fits every form with the same list ("Information Technology" is not one
    // of Greenhouse's subjects; picking the nearest one for them would be a guess about their education).
    if (texts.filter(Boolean).length === 0) {
      await input.fill("");
      await options.first().waitFor({ timeout: 3000 }).catch(() => undefined);
      const all = (await options.allInnerTexts()).map((text) => text.trim()).filter(Boolean);
      if (all.length > 0 && all.length <= 200) texts = all;
    }
    await closeMenu(page);
    // Live options when the list showed some; otherwise a free-text question so the user can try another search term.
    const shown = texts.filter(Boolean).slice(0, 200);
    const question = { key: customQuestionKey(label), label: shown.length ? label : `${label} (nothing matched "${value}", try another search word)`, type: shown.length ? "combobox" : "text", required: true, ...(shown.length ? { options: shown } : {}) };
    throw new NeedsAnswerError(question);
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

/** Tick the box (or radio) whose label fits the answer. */
async function pickInGroup(page: Page, value: ResolvedValue) {
  const boxes = page.locator(value.selector);
  const labels = await boxes.evaluateAll((nodes) =>
    nodes.map((node) =>
      ((node.id ? document.querySelector(`label[for="${CSS.escape(node.id)}"]`)?.textContent : "") || node.closest("label")?.textContent || (node as HTMLInputElement).value || "").replace(/\s+/g, " ").trim(),
    ),
  );
  const choice = bestOption(labels, value.value);
  if (!choice) throw new NeedsAnswerError({ key: customQuestionKey(value.label), label: value.label, type: value.type, required: true, options: labels });
  await boxes.nth(labels.indexOf(choice)).check({ force: true });
  return choice;
}

/**
 * Required questions still empty just before Submit, by label. Greenhouse only names them after a submit attempt,
 * and an attempt with holes is a wasted (and logged) submit. Questions hidden by the form's own conditions do not count.
 */
export async function missingRequired(page: Page): Promise<string[]> {
  const raw = await page.evaluate(() => {
    const missing: string[] = [];
    const groups = new Set<string>();
    document.querySelectorAll("input, select, textarea").forEach((node) => {
      const el = node as HTMLInputElement;
      const type = (el.getAttribute("type") ?? el.tagName).toLowerCase();
      if (["hidden", "submit", "search", "button", "file"].includes(type)) return;
      if (/^(g-recaptcha|iti-|security-input-)/.test(el.id)) return;
      const fieldset = el.closest("fieldset");
      const box = type === "checkbox" || type === "radio";
      const required = el.required || el.getAttribute("aria-required") === "true" || (box && fieldset?.getAttribute("aria-required") === "true") || el.name === "gdpr_demographic_data_consent_given";
      if (!required) return;
      if (el.getClientRects().length === 0 && (!fieldset || fieldset.getClientRects().length === 0)) return;
      let label = (el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent : "") ?? "";
      if (!label.trim() && el.getAttribute("aria-labelledby")) {
        label = (el.getAttribute("aria-labelledby") ?? "")
          .split(/\s+/)
          .map((part) => document.getElementById(part)?.textContent ?? "")
          .join(" ");
      }
      if (box) {
        const name = el.getAttribute("name") || el.id;
        if (groups.has(name)) return;
        groups.add(name);
        const checked = Array.from(document.querySelectorAll(`input[name="${CSS.escape(name)}"]`)).some((other) => (other as HTMLInputElement).checked);
        if (!checked) missing.push(fieldset?.querySelector("legend")?.textContent || label || name);
        return;
      }
      if (el.getAttribute("role") === "combobox") {
        // react-select keeps the choice outside the input. Only a control still showing its placeholder is empty;
        // markup we do not recognise is left to Greenhouse rather than blocking a good form.
        const control = el.closest(".select__control");
        if (control?.querySelector(".select__placeholder") && !control.querySelector(".select__single-value, .select__multi-value")) missing.push(label || el.id);
        return;
      }
      if (!el.value.trim()) missing.push(label || el.id);
    });
    return missing;
  });
  return [...new Set(raw.map((label) => cleanLabel(label).slice(0, 80)).filter(Boolean))];
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
    await dismissOverlays(page);
    for (const value of values) {
      if (value.type === "file") continue;
      const written = await inField(value.label, async () => {
        if (value.type === "combobox") return pickCombobox(page, value.selector, value.value, value.label);
        if (value.type === "radio" || value.type === "checkbox-group") return pickInGroup(page, value);
        if (value.type === "select") await selectOption(page, value.selector, { label: value.value });
        else if (value.type === "checkbox") await setCheckbox(page, value.selector, value.value);
        else if ((await page.locator(value.selector).getAttribute("type").catch(() => null)) === "number") {
          // A number box takes only a number ("Start date year"); text there failed the whole run (SingleStore, 10 Oct).
          const number = value.value.match(/-?\d+(\.\d+)?/)?.[0];
          if (!number) throw new NeedsAnswerError({ key: customQuestionKey(value.label), label: value.label, type: "number", required: true });
          await fillText(page, value.selector, number);
          return number;
        } else await fillText(page, value.selector, value.value);
        return value.value;
      });
      filled.push({ key: value.key, label: value.label, value: written, source: value.source, selector: value.selector });
    }
    return filled;
  },
  async submit(page, ctx): Promise<SubmitResult> {
    await dismissOverlays(page);
    const missing = await missingRequired(page);
    if (missing.length > 0) throw new NoRetryError(`Greenhouse needs these filled before it will submit: ${missing.slice(0, 5).join(", ")}`);
    try {
      const button = page.getByRole("button", { name: /submit application/i });
      await button.scrollIntoViewIfNeeded().catch(() => undefined);
      await button.click({ timeout: 20000 });
    } catch (error) {
      throw new NoRetryError(`Could not press Submit on the Greenhouse form: ${friendlyError(error)}`);
    }
    const evidence = await waitForGreenhouseConfirmation(page, ctx);
    return { confirmed: true, evidence };
  },
};
