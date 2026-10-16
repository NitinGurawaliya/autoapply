import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Locator, Page } from "playwright";
import { customQuestionKey } from "@/modules/answers";
import type { AtsAdapter, FilledField, FormField, ResolvedValue, SubmitContext, SubmitResult } from "../adapter";
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
    // Ashby reads an attached resume on its server and may overwrite fields when that finishes: let it finish before
    // the fill, or Ashby can drop typed values (15 Oct: "Missing entry for required field: Legal Name" with it on screen).
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
    await page.waitForTimeout(1500);
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

/**
 * A search-list option that is the value asked for: the same text, one that continues it after a comma ("Bengaluru" →
 * "Bengaluru, Karnataka, India"), or one with it as a whole comma-separated part ("India" → "Karnataka, India"). Never
 * a mere substring: "Computer Science" picked "Warsaw School of Computer Science" as a school (16 Oct, Tekion).
 */
function pickSearchOption(options: string[], wanted: string) {
  const target = norm(wanted);
  if (!target) return -1;
  const normalised = options.map(norm);
  const exact = normalised.indexOf(target);
  if (exact >= 0) return exact;
  const starts = normalised.findIndex((option) => option.startsWith(`${target},`));
  if (starts >= 0) return starts;
  return options.findIndex((option) => option.split(",").some((part) => norm(part) === target));
}

// Ashby's location search knows the official names: "Bangalore" finds nothing, "Bengaluru" does (15 Oct, ElevenLabs).
const CITY_NAMES: Record<string, string> = { bangalore: "Bengaluru", bombay: "Mumbai", gurgaon: "Gurugram", calcutta: "Kolkata", madras: "Chennai", poona: "Pune", trivandrum: "Thiruvananthapuram", mysore: "Mysuru", baroda: "Vadodara" };

/** Words to search a combobox with, in order: the value, its official city name, the city alone, the country alone. */
function searchWords(value: string, label = "") {
  const parts = value.split(",").map((part) => part.trim()).filter(Boolean);
  const official = (word: string) => CITY_NAMES[word.toLowerCase()];
  const words = [value, ...parts.map((part) => (official(part) ? parts.map((item) => official(item) ?? item).join(", ") : null)), official(parts[0] ?? "") ?? null];
  if (parts.length > 1) words.push(parts[0], parts[parts.length - 1]);
  // A school is listed under its short name too: "Jaypee University" or "JUIT" for "Jaypee University of Information
  // Technology". Only an exact option counts (pickSearchOption), so a different school with a similar name is never taken.
  if (SCHOOL_PICKER.test(label)) {
    const before = value.split(/\s+of\s+/i)[0].trim();
    const initials = value.split(/\s+/).filter((word) => /^[A-Z]/.test(word) && !/^(of|and|the|for|at)$/i.test(word)).map((word) => word[0]).join("");
    words.push(before, initials.length >= 3 ? initials : "");
  }
  return [...new Set(words.filter((word): word is string => !!word && word.length >= 2))];
}

const SCHOOL_PICKER = /\b(school|college|universit|institution|education|alma mater)/i;
// When the school is not in a company's list (a US list without Indian universities, 16 Oct, Sierra), the list's own
// "Other" is the true answer: the school is not listed.
const NOT_LISTED = /^(other|others|other \(.*\)|not listed|none of the above|my (school|university|college) is not listed.*|school not listed|university not listed)$/i;

async function fillCombobox(page: Page, value: ResolvedValue) {
  const entry = page.locator(value.selector);
  const input = entry.locator('input[role="combobox"]');
  await input.scrollIntoViewIfNeeded();
  const options = page.locator('[role="listbox"] [role="option"]');
  let texts: string[] = [];
  let index = -1;
  // Only an option that matches the word searched: the first suggestion is a guess ("West Bengal, India" for
  // "Bengaluru", 15 Oct), and a guess is a made-up fact about the candidate.
  for (const candidate of searchWords(value.value, value.label)) {
    await input.click();
    await input.fill("");
    await input.pressSequentially(candidate, { delay: 60 });
    await options.first().waitFor({ timeout: 8000 }).catch(() => undefined);
    texts = (await options.allInnerTexts()).map((text) => text.replace(/\s+/g, " ").trim());
    index = pickSearchOption(texts, candidate);
    if (index >= 0) break;
  }
  if (index < 0 && SCHOOL_PICKER.test(value.label)) {
    await input.click();
    await input.fill("");
    await input.pressSequentially("Other", { delay: 60 });
    await options.first().waitFor({ timeout: 8000 }).catch(() => undefined);
    texts = (await options.allInnerTexts()).map((text) => text.replace(/\s+/g, " ").trim());
    index = texts.findIndex((text) => NOT_LISTED.test(text));
  }
  if (index < 0) {
    await input.fill("");
    // Some pickers mark "required" on the input, not the label (16 Oct, Tekion "Education History"): left blank, the run
    // then stopped at the check before Submit instead of asking.
    const required = value.required || (await entry.locator('[class*="_required"], [aria-required="true"], [required]').count()) > 0;
    if (!required) return null;
    const hint = SCHOOL_PICKER.test(value.label)
      ? `"${value.value}" is not in their list and it has no "Other": type the name as they might list it`
      : `nothing matched "${value.value}", try another search word`;
    throw new NeedsAnswerError({ key: customQuestionKey(value.label), label: `${value.label} (${hint})`, type: "text", required: true });
  }
  await options.nth(index).click();
  return texts[index];
}

const CONFIRMATION = /successfully submitted|application (has been )?(submitted|received)|thank you for (applying|your application)/i;
const REFUSED = /flagged as (possible )?spam|couldn.t be submitted|unable to submit your application/i;
const MISSING = /Missing entry for required field:\s*([^\n]+)/g;

/** Ashby's server said required fields were empty: the form was not accepted, so nothing was sent. */
class MissingEntriesError extends NoRetryError {
  constructor(readonly labels: string[]) {
    super(`Ashby said these required fields were empty: ${labels.slice(0, 5).join(", ")}`);
  }
}

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
    const missing = [...body.matchAll(MISSING)].map((match) => match[1].trim());
    if (missing.length > 0 && Date.now() - started > 3000) throw new MissingEntriesError(missing);
    if (await captchaChallengeVisible(page)) throw new NoRetryError("Ashby showed a CAPTCHA. Open the form and submit it yourself.");
    const errors = await entriesWithErrors(page);
    if (errors.length > 0 && Date.now() - started > 6000) {
      throw new NoRetryError(`Ashby rejected the form: ${[...new Set(errors)].slice(0, 5).join(", ")}`);
    }
    await page.waitForTimeout(1000);
  }
  throw new NoRetryError("Submit clicked but no confirmation appeared. Check your email before applying again.");
}

/** Selects a radio or checkbox option by clicking its label, as a person does; a forced check only if that fails. */
async function clickOption(entry: Locator, option: Locator) {
  if (await option.isChecked().catch(() => false)) return;
  const id = await option.getAttribute("id");
  const label = id ? entry.locator(`label[for="${id.replace(/"/g, '\\"')}"]`).first() : null;
  if (label && (await label.count()) > 0) await label.click().catch(() => undefined);
  if (!(await option.isChecked().catch(() => false))) await option.check({ force: true });
}

/** Types again, key by key, the on-screen text of each named entry. Returns how many were typed. */
async function retypeEntries(page: Page, labels: string[]) {
  let typed = 0;
  for (const label of labels) {
    const entry = page.locator("[data-field-path]").filter({ has: page.locator(".ashby-application-form-question-title", { hasText: label }) }).first();
    const input = entry.locator("input:not([type=file]):not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea").first();
    if ((await input.count()) === 0) {
      const radios = entry.locator('input[type="radio"]');
      const chosen = entry.locator('input[type="radio"]:checked').first();
      if ((await chosen.count()) === 0 || (await radios.count()) < 2) continue;
      const chosenId = await chosen.getAttribute("id");
      const other = entry.locator(`input[type="radio"]:not([id="${chosenId}"])`).first();
      await clickOption(entry, other);
      await clickOption(entry, entry.locator(`input[type="radio"][id="${chosenId}"]`));
      typed += 1;
      continue;
    }
    const value = await input.inputValue().catch(() => "");
    if (!value.trim()) continue;
    await input.scrollIntoViewIfNeeded().catch(() => undefined);
    await input.click();
    await input.fill("");
    await input.pressSequentially(value, { delay: 25 });
    await input.press("Tab");
    typed += 1;
  }
  return typed;
}

export const HANDOFF_WAIT_MS = 15 * 60 * 1000;

/**
 * Hand-off (owner, 15 Oct): Ashby's spam check refuses applications an automated browser submits by itself (7 of 26
 * runs to 9 Oct), so the form is filled in a visible Chrome window and the user presses Submit, answering anything Ashby
 * asks. This waits for Ashby's answer: the confirmation, a refusal, the window closed, a cancel, or no Submit in time.
 */
async function waitForUserSubmit(page: Page, ctx: SubmitContext): Promise<SubmitResult> {
  const button = await firstVisible(page, ["button.ashby-application-form-submit-button", "button[type=submit]"], 20000);
  await button?.scrollIntoViewIfNeeded().catch(() => undefined);
  await page.bringToFront().catch(() => undefined);
  await ctx.announceHandoff?.("Ready to send: check the form in the Chrome window on your computer and press Submit");
  const deadline = Date.now() + HANDOFF_WAIT_MS;
  while (Date.now() < deadline) {
    if (page.isClosed()) throw new NoRetryError("The Ashby window was closed before Submit was pressed. Nothing was sent.");
    if (await ctx.cancelled?.()) throw new NoRetryError("Cancelled before Submit was pressed. Nothing was sent.");
    const body = await page.locator("body").innerText().catch(() => "");
    const done = body.match(CONFIRMATION);
    if (done) return { confirmed: true, evidence: `text "${done[0]}" after you pressed Submit` };
    if (REFUSED.test(body)) throw new NoRetryError("Ashby refused the application as possible spam, even with you pressing Submit. Open the posting and apply in your usual browser.");
    await page.waitForTimeout(2000).catch(() => undefined);
  }
  throw new NoRetryError("Submit was not pressed within 15 minutes. Nothing was sent; retry when you are at your computer.");
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
          // A forced check shows the dot but Ashby's form state can miss it ("Missing entry", 15 Oct, ElevenLabs).
          await clickOption(entry, inputs.nth(index));
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
  async submit(page, ctx): Promise<SubmitResult> {
    await dismissOverlays(page);
    // Catch an unfilled required field here, before Submit: a form sent half empty is the kind Ashby's spam check dislikes.
    const empty = await emptyRequired(page);
    if (empty.length > 0) throw new NoRetryError(`These required questions are still empty: ${empty.slice(0, 5).join(", ")}`);
    if (ctx.handoff) return waitForUserSubmit(page, ctx);
    const button = await firstVisible(page, ["button.ashby-application-form-submit-button", "button[type=submit]"], 20000);
    if (!button) throw new NoRetryError("The Submit button never appeared on the Ashby form. Open the form and submit it yourself.");
    const press = async () => {
      await button.scrollIntoViewIfNeeded().catch(() => undefined);
      try {
        await button.click({ timeout: 15000 });
      } catch (error) {
        throw new NoRetryError(`Could not press Submit on the Ashby form: ${friendlyError(error)}`);
      }
    };
    await press();
    try {
      return { confirmed: true, evidence: await waitForAshbyConfirmation(page) };
    } catch (error) {
      // Ashby sometimes keeps a typed value on screen but not in its form state and rejects the form as missing it
      // (15 Oct, Legal Name). Nothing was sent, so type those values again key by key and press Submit once more.
      if (!(error instanceof MissingEntriesError) || (await retypeEntries(page, error.labels)) === 0) throw error;
      await press();
      return { confirmed: true, evidence: `${await waitForAshbyConfirmation(page)} (after Ashby's empty-field check)` };
    }
  },
};
