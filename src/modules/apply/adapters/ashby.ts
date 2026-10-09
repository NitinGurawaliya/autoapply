import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "playwright";
import { customQuestionKey } from "@/modules/answers";
import type { AtsAdapter, FilledField, FormField, ResolvedValue, SubmitResult } from "../adapter";
import { NeedsAnswerError, NoRetryError } from "../adapter";
import { assertJobOpen, dismissOverlays, firstVisible, friendlyError, inField, toDatePickerText } from "./common";

// Ashby hosts every company's form on jobs.ashbyhq.com/<company>/<id>/application.
function formUrl(job: { applyUrl: string }) {
  const url = job.applyUrl.split(/[?#]/)[0].replace(/\/+$/, "");
  return /\/application$/i.test(url) ? url : `${url}/application`;
}

const norm = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();
const entryOf = (path: string) => `[data-field-path="${path.replace(/"/g, '\\"')}"]`;

// The fixed fields have fixed paths; everything else is mapped from its label.
function hintFor(path: string): string | undefined {
  if (path === "_systemfield_name") return "full_name";
  if (path === "_systemfield_email") return "email";
  if (path === "_systemfield_location") return "city";
  if (path === "_systemfield_resume") return "resume";
  return undefined;
}

type Row = { path: string; label: string; kind: string; required: boolean; options?: string[] };

// Runs inside the page. A plain string on purpose: tsx would wrap named helpers in a function the page does not have.
const READ_FORM = `(() => {
  const clean = (text) => (text || '').replace(/\\u00a0/g, ' ').replace(/\\s+/g, ' ').trim();
  const optionText = (el) => clean(((el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]')) || el.closest('label') || el.parentElement || el).textContent);
  const rows = [];
  // Every question is a [data-field-path] block. Checkbox groups (acknowledgements among them) do not carry the
  // field-entry class, so selecting by class missed them entirely.
  Array.from(document.querySelectorAll('[data-field-path]')).filter((el) => !el.parentElement.closest('[data-field-path]')).forEach((entry) => {
    const path = entry.getAttribute('data-field-path') || '';
    if (!path) return;
    const labelEl = entry.querySelector('.ashby-application-form-question-title');
    const label = clean(labelEl ? labelEl.textContent : '');
    const required = Boolean(labelEl && /_required_/.test(labelEl.className));
    if (entry.querySelector('input[type=file]')) return void rows.push({ path, label, kind: 'file', required });
    if (entry.querySelector('.ashby-application-form-input-yesno')) return void rows.push({ path, label, kind: 'yesno', required, options: ['Yes', 'No'] });
    if (entry.querySelector('input.ashby-application-form-input-date, .react-datepicker-wrapper')) return void rows.push({ path, label, kind: 'date', required });
    const combo = entry.querySelector('input[role=combobox]');
    if (combo) return void rows.push({ path, label, kind: 'combobox', required });
    const select = entry.querySelector('select');
    if (select) return void rows.push({ path, label, kind: 'select', required, options: Array.from(select.options).filter((o) => o.value).map((o) => clean(o.textContent)) });
    const radios = Array.from(entry.querySelectorAll('input[type=radio]')).filter((r) => !/consent/i.test(r.name));
    const text = entry.querySelector('input:not([type=radio]):not([type=checkbox]):not([type=file]):not([type=hidden]), textarea');
    if (text) return void rows.push({ path, label, kind: text.tagName === 'TEXTAREA' ? 'textarea' : 'text', required });
    if (radios.length) return void rows.push({ path, label, kind: 'radio', required, options: radios.map(optionText) });
    const boxes = Array.from(entry.querySelectorAll('input[type=checkbox]'));
    if (boxes.length > 1 || (boxes.length === 1 && entry.querySelector('.ashby-application-form-input-checkbox-group'))) return void rows.push({ path, label, kind: 'checkbox-group', required, options: boxes.map(optionText) });
    if (boxes.length === 1) return void rows.push({ path, label: label || optionText(boxes[0]), kind: 'checkbox', required });
    if (entry.querySelector('input, select, textarea, [role=combobox], [role=listbox], [contenteditable=true]')) rows.push({ path, label, kind: 'unsupported', required });
  });
  return rows;
})()`;

// Runs inside the page: labels of required questions that still have no answer. Only widgets with a readable value
// are judged; anything else is left to Ashby's own validation, so this never blocks a good form.
const EMPTY_REQUIRED = `(() => {
  const clean = (text) => (text || '').replace(/\\s+/g, ' ').trim();
  const out = [];
  Array.from(document.querySelectorAll('[data-field-path]')).filter((el) => !el.parentElement.closest('[data-field-path]')).forEach((entry) => {
    const title = entry.querySelector('.ashby-application-form-question-title');
    if (!title || !/_required_/.test(title.className)) return;
    if (entry.querySelector('input[type=file]')) return;
    const text = entry.querySelector('input:not([type=radio]):not([type=checkbox]):not([type=hidden]), textarea');
    const radios = Array.from(entry.querySelectorAll('input[type=radio], input[type=checkbox]'));
    const select = entry.querySelector('select');
    let empty = false;
    // A Yes/No pair keeps a hidden checkbox that stays unticked for "No": judge it by the pressed button.
    if (entry.querySelector('.ashby-application-form-input-yesno')) empty = !entry.querySelector('[aria-pressed="true"]');
    else if (select) empty = !select.value;
    else if (text) empty = !text.value.trim();
    else if (radios.length > 0 && !text) empty = !radios.some((r) => r.checked);
    if (empty) out.push(clean(title.textContent));
  });
  return out;
})()`;

/** Labels of required questions that still have no answer. */
export async function emptyRequired(page: Page) {
  return [...new Set((await page.evaluate(EMPTY_REQUIRED)) as string[])];
}

async function readFields(page: Page): Promise<FormField[]> {
  await page
    .locator("#_systemfield_name, .ashby-application-form-field-entry")
    .first()
    .waitFor({ timeout: 25000 })
    .catch(async (error) => {
      await assertJobOpen(page);
      throw error;
    });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
  const rows = (await page.evaluate(READ_FORM)) as Row[];
  if (rows.length === 0) throw new Error("The application form did not load properly (it had no fields)");
  const fields: FormField[] = [];
  for (const row of rows) {
    // A question type the agent cannot answer yet: skip it when optional, stop before filling anything when required.
    if (row.kind === 'unsupported') {
      if (row.required) throw new NoRetryError(`This form has a required question the agent cannot answer yet: ${(row.label || row.path).slice(0, 90)}`);
      continue;
    }
    // A cover-letter upload is optional and never auto-written; skip file fields other than the resume.
    if (row.kind === "file" && row.path !== "_systemfield_resume" && !row.required) continue;
    fields.push({
      selector: entryOf(row.path),
      label: row.label || row.path,
      type: row.kind === "file" ? "file" : row.kind,
      required: row.required,
      options: row.options,
      hintKey: hintFor(row.path),
    });
  }
  return fields;
}

async function attachFile(page: Page, value: ResolvedValue, bytes: Uint8Array) {
  const name = value.fileName ?? "resume.pdf";
  const dir = await mkdtemp(join(tmpdir(), "swipeapply-"));
  const cleanup = async () => {
    await rm(dir, { recursive: true, force: true });
  };
  try {
    const file = join(dir, name);
    await writeFile(file, bytes);
    const entry = page.locator(value.selector);
    await entry.locator('input[type="file"]').setInputFiles(file);
    // The entry shows the file name once it is attached ("resume.pdf  Replace").
    await page.waitForFunction(
      ([selector, fileName]) => (document.querySelector(selector)?.textContent ?? "").toLowerCase().includes(fileName.toLowerCase()),
      [value.selector, name],
      { timeout: 30000 },
    );
    return cleanup;
  } catch (error) {
    await cleanup();
    throw new Error(`Resume upload failed: ${error instanceof Error ? error.message.split("\n")[0] : "no confirmation"}`);
  }
}

function pickLabel(options: string[], wanted: string) {
  const target = norm(wanted);
  const normalised = options.map(norm);
  const exact = normalised.indexOf(target);
  if (exact >= 0) return exact;
  const starts = normalised.findIndex((option) => option.startsWith(target));
  if (starts >= 0) return starts;
  return normalised.findIndex((option) => option.includes(target));
}

async function fillCombobox(page: Page, value: ResolvedValue) {
  const entry = page.locator(value.selector);
  const input = entry.locator('input[role="combobox"]');
  await input.scrollIntoViewIfNeeded();
  await input.click();
  await input.fill("");
  await input.pressSequentially(value.value, { delay: 60 });
  const options = page.locator('[role="listbox"] [role="option"]');
  await options.first().waitFor({ timeout: 8000 }).catch(() => undefined);
  const texts = (await options.allInnerTexts()).map((text) => text.replace(/\s+/g, " ").trim());
  if (texts.length === 0) {
    await input.fill("");
    if (!value.required) return null;
    throw new NeedsAnswerError({ key: customQuestionKey(value.label), label: `${value.label} (nothing matched "${value.value}", try another search word)`, type: "text", required: true });
  }
  const index = Math.max(0, pickLabel(texts, value.value));
  await options.nth(index).click();
  return texts[index];
}

const CONFIRMATION = /successfully submitted|application (has been )?(submitted|received)|thank you for (applying|your application)/i;
const REFUSED = /flagged as (possible )?spam|couldn.t be submitted|unable to submit your application/i;

async function captchaChallengeVisible(page: Page) {
  const frames = page.locator('iframe[src*="recaptcha"][src*="bframe"], iframe[title*="recaptcha challenge" i]');
  const count = await frames.count();
  for (let index = 0; index < count; index += 1) {
    const box = await frames.nth(index).boundingBox();
    if (box && box.height > 120 && (await frames.nth(index).isVisible())) return true;
  }
  return false;
}

async function entriesWithErrors(page: Page) {
  return (await page.evaluate(`Array.from(document.querySelectorAll('[data-field-path]')).filter((el) => !el.parentElement.closest('[data-field-path]')).filter((entry) => entry.querySelector('[class*="_error"], [role="alert"]')).map((entry) => ((entry.querySelector('.ashby-application-form-question-title') || {}).textContent || '').replace(/\\s+/g, ' ').trim()).filter(Boolean)`)) as string[];
}

export async function waitForAshbyConfirmation(page: Page, timeoutMs = 60000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const body = await page.locator("body").innerText().catch(() => "");
    const done = body.match(CONFIRMATION);
    if (done) return `text "${done[0]}"`;
    if (REFUSED.test(body)) throw new NoRetryError("Ashby refused the application as possible spam. Open the form and submit it yourself.");
    if (await captchaChallengeVisible(page)) throw new NoRetryError("Ashby showed a CAPTCHA. Open the form and submit it yourself.");
    const errors = await entriesWithErrors(page);
    if (errors.length > 0 && Date.now() - started > 6000) {
      throw new NoRetryError(`Ashby rejected the form: ${[...new Set(errors)].slice(0, 5).join(", ")}`);
    }
    await page.waitForTimeout(1000);
  }
  throw new NoRetryError("Submit clicked but no confirmation appeared. Check your email before applying again.");
}

export const ashbyAdapter: AtsAdapter = {
  source: "ashby",
  matches(url: string) {
    return /ashbyhq\.com/i.test(url);
  },
  formUrl,
  uploadFile: attachFile,
  inspect(page: Page) {
    return readFields(page);
  },
  async fill(page, values) {
    const filled: FilledField[] = [];
    await dismissOverlays(page);
    for (const value of values) {
      if (value.type === "file") continue;
      const written = await inField(value.label, async () => {
        const entry = page.locator(value.selector);
        await entry.scrollIntoViewIfNeeded().catch(() => undefined);
        if (value.type === "combobox") return fillCombobox(page, value);
        if (value.type === "date") {
          const text = toDatePickerText(value.value);
          if (!text) {
            throw new NeedsAnswerError({ key: customQuestionKey(value.label), label: `${value.label} (enter a date, for example 15 Nov 2026)`, type: "text", required: true });
          }
          const input = entry.locator("input").first();
          await input.click();
          await input.fill(text);
          await page.keyboard.press("Enter");
          await page.keyboard.press("Escape");
          if (!(await input.inputValue()).trim()) throw new Error("the date was not accepted");
          return text;
        }
        if (value.type === "yesno") {
          const wanted = /^(yes|y|true)$/i.test(value.value.trim()) ? "Yes" : "No";
          await entry.locator("button.ashby-application-form-input-yesno-option", { hasText: new RegExp(`^${wanted}$`) }).click();
          return wanted;
        }
        if (value.type === "select") {
          await entry.locator("select").selectOption({ label: value.value });
          return value.value;
        }
        if (value.type === "radio" || value.type === "checkbox-group") {
          const kind = value.type === "radio" ? "radio" : "checkbox";
          const inputs = entry.locator(`input[type="${kind}"]`);
          const labels = await inputs.evaluateAll((nodes) =>
            nodes.map((node) => (((node.id ? document.querySelector(`label[for="${CSS.escape(node.id)}"]`) : null) ?? node.closest("label") ?? node.parentElement)?.textContent ?? "").replace(/\s+/g, " ").trim()),
          );
          const index = pickLabel(labels, value.value);
          if (index < 0) throw new Error(`No option "${value.value}" for "${value.label}"`);
          await inputs.nth(index).check({ force: true });
          return labels[index];
        }
        if (value.type === "checkbox") {
          const box = entry.locator('input[type="checkbox"]').first();
          if (/^(yes|true|checked|agree|i agree|1)$/i.test(value.value.trim())) await box.check({ force: true });
          else await box.uncheck({ force: true });
          return value.value;
        }
        await entry.locator("input:not([type=file]), textarea").first().fill(value.value);
        return value.value;
      });
      if (written === null) continue;
      filled.push({ key: value.key, label: value.label, value: written, source: value.source, selector: value.selector });
    }
    return filled;
  },
  async submit(page): Promise<SubmitResult> {
    await dismissOverlays(page);
    // Catch an unfilled required field here, before Submit: a form sent half empty is the kind Ashby's spam check dislikes.
    const empty = await emptyRequired(page);
    if (empty.length > 0) throw new NoRetryError(`These required questions are still empty: ${empty.slice(0, 5).join(", ")}`);
    const button = await firstVisible(page, ["button.ashby-application-form-submit-button", "button[type=submit]"], 20000);
    if (!button) throw new NoRetryError("The Submit button never appeared on the Ashby form. Open the form and submit it yourself.");
    await button.scrollIntoViewIfNeeded().catch(() => undefined);
    try {
      await button.click({ timeout: 15000 });
    } catch (error) {
      throw new NoRetryError(`Could not press Submit on the Ashby form: ${friendlyError(error)}`);
    }
    const evidence = await waitForAshbyConfirmation(page);
    return { confirmed: true, evidence };
  },
};
