import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Locator, Page, Request, Response } from "playwright";
import { customQuestionKey } from "@/modules/answers";
import type { AtsAdapter, FilledField, FormField, ResolvedValue, SubmitContext, SubmitResult } from "../adapter";
import { MaybeSentError, NeedsAnswerError, NoRetryError, NotSentError, RefusedError, WindowClosedError } from "../adapter";
import { livePage } from "../browser";
import { categorize, watchAshby } from "./ashbyDiagnostics";
import { assertJobOpen, dismissOverlays, firstVisible, inField, toDatePickerText } from "./common";

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
    // A number box takes digits only (18 Oct: "46lpa" into a EUR salary box failed the run): read it as one.
    if (text) return void rows.push({ path, label, kind: text.tagName === 'TEXTAREA' ? 'textarea' : text.getAttribute('type') === 'number' ? 'number' : 'text', required });
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

/**
 * Ashby's success state: a known phrase, or Ashby's own "Success" banner with the form gone. Companies write their own
 * message under the banner (21 Oct: Bjak's "Thank you so much for your interest in joining Bjak…" matched no phrase, and
 * a sent application was recorded "check your email").
 */
async function successShown(page: Page): Promise<string | null> {
  const body = await page.locator("body").innerText().catch(() => "");
  const known = body.match(CONFIRMATION);
  if (known) return `text "${known[0]}"`;
  if (!/(^|\n)\s*Success\s*(\n|$)/.test(body)) return null;
  const formLeft = await page.locator("button.ashby-application-form-submit-button, [data-field-path]").count().catch(() => 1);
  return formLeft === 0 ? 'Ashby\'s "Success" banner, with the form gone' : null;
}

/** Selects a radio or checkbox option by clicking its label, as a person does; a forced check only if that fails. */
async function clickOption(entry: Locator, option: Locator) {
  if (await option.isChecked().catch(() => false)) return;
  const id = await option.getAttribute("id");
  const label = id ? entry.locator(`label[for="${id.replace(/"/g, '\\"')}"]`).first() : null;
  if (label && (await label.count()) > 0) await label.click().catch(() => undefined);
  if (!(await option.isChecked().catch(() => false))) await option.check({ force: true });
}

export const HANDOFF_WAIT_MS = 15 * 60 * 1000;

/** Ashby's answer to a submission the window sent, read off the network so it survives the page going away. */
type SentSubmission = { ok: boolean; body: string };

// Ashby's submit operation, seen on the network on 21 Oct (an accepted handoff sent it; a refused automated run did not).
const SUBMIT_OPERATION = "ApiSubmitSingleApplicationFormAction";

/** The form's own submission: a POST to Ashby carrying the submit operation. */
function isSubmission(response: Response) {
  const request = response.request();
  if (request.method() !== "POST" || !/ashbyhq\.com/i.test(response.url())) return false;
  return (request.postData() ?? "").includes(`"${SUBMIT_OPERATION}"`);
}

/** Accepted when the server answered OK with no GraphQL errors and no spam refusal in its body. */
function accepted(sent: SentSubmission) {
  return sent.ok && !/"errors"\s*:\s*\[\s*\{/.test(sent.body) && !/spam|captcha/i.test(sent.body);
}

/**
 * What this window sends Ashby: POSTs counted as they leave (once counting is on) and Ashby's answer to each submit,
 * read off the network so it survives the page going away.
 */
function watchSubmissions(page: Page, onFirstPost?: () => void) {
  const context = page.context();
  const state = { counting: false, posts: 0, sent: [] as SentSubmission[] };
  // Counted when a request leaves, not when Ashby answers: a window closed between the two must not read as "nothing sent".
  const onRequest = (request: Request) => {
    if (!state.counting || request.method() !== "POST" || !/ashbyhq\.com/i.test(request.url())) return;
    state.posts += 1;
    if (state.posts === 1) onFirstPost?.();
  };
  const onResponse = (response: Response) => {
    if (!isSubmission(response)) return;
    response.text().then(
      (body) => state.sent.push({ ok: response.ok(), body: body.slice(0, 4000) }),
      () => state.sent.push({ ok: response.ok(), body: "" }),
    );
  };
  context.on("request", onRequest);
  context.on("response", onResponse);
  return {
    state,
    accepted: () => state.sent.some(accepted),
    stop: () => {
      context.off("request", onRequest);
      context.off("response", onResponse);
    },
  };
}

/**
 * Human handoff, the only way an Ashby application is sent: the form is filled in a visible Chrome window and the person
 * presses Submit, answering anything Ashby asks. A Submit the worker pressed itself was stopped by Ashby's reCAPTCHA
 * before anything was sent (21 Oct: 1 of 23 through; a traced run never sent its submit request), while a person's
 * Submit went through 7 of 7. This waits for Ashby's answer: the Success page, a refusal, the window closed, a cancel,
 * or no Submit in time. Only the Success text counts as sent.
 */
async function waitForUserSubmit(page: Page, ctx: SubmitContext): Promise<SubmitResult> {
  // Every submission that leaves this window, with Ashby's answer. 21 Oct: the page often went away right after the
  // user pressed Submit (Success opens as a new page, or the user closed it), and "window closed" was read as "nothing
  // sent": Bjak and Techtorch were recorded failed while Ashby had them, and Techtorch was then sent a second time.
  // "Nothing was sent" is believed only when the window sent Ashby no POST at all once the form was ready.
  // The person presses Submit, so the first request to Ashby once the form is ready is the moment it may have been sent.
  const watcher = watchSubmissions(page, () => void ctx.markAttempted?.());
  const { state } = watcher;
  const outcomeWithoutPage = (): SubmitResult => {
    if (state.sent.length === 0 && state.posts === 0) throw new WindowClosedError("The Ashby window was closed before Submit was pressed. Nothing was sent.");
    // Only Ashby's Success page counts as confirmation: which request is the submit, and what its answer means, are not
    // verified yet, so an OK from the server is reported as unconfirmed, never as sent.
    if (watcher.accepted()) throw new MaybeSentError("Ashby's server answered the submission without an error, but its Success page was not seen. Check your email to confirm.");
    throw new MaybeSentError("The window closed after it sent something to Ashby, so the application may have been sent. Check your email before applying again.");
  };
  try {
    const button = await firstVisible(page, ["button.ashby-application-form-submit-button", "button[type=submit]"], 20000);
    await button?.scrollIntoViewIfNeeded().catch(() => undefined);
    await page.bringToFront().catch(() => undefined);
    state.counting = true;
    await ctx.announceHandoff?.("Ready to send: check the form in the Chrome window on your computer and press Submit");
    const deadline = Date.now() + HANDOFF_WAIT_MS;
    while (Date.now() < deadline) {
      // The page may be replaced by a new one in the same window when Ashby shows Success: follow it.
      const live = livePage(page);
      if (!live) return outcomeWithoutPage();
      if (await ctx.cancelled?.()) {
        if (state.sent.length > 0 || state.posts > 0) return outcomeWithoutPage();
        throw new NotSentError("Cancelled before Submit was pressed. Nothing was sent.");
      }
      const done = await successShown(live);
      if (done) return { confirmed: true, evidence: `${done} after you pressed Submit` };
      const body = await live.locator("body").innerText().catch(() => "");
      if (REFUSED.test(body)) throw new RefusedError("Ashby refused the application as possible spam, even with you pressing Submit. Open the posting and apply in your usual browser.");
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (state.sent.length > 0 || state.posts > 0) return outcomeWithoutPage();
    throw new NotSentError("Submit was not pressed within 15 minutes. Nothing was sent; retry when you are at your computer.");
  } catch (error) {
    // A Playwright error because the page went away mid-wait is decided by what was sent, like a closed window.
    if (!(error instanceof NoRetryError) && !livePage(page)) return outcomeWithoutPage();
    throw error;
  } finally {
    watcher.stop();
  }
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
  // The window is the person's from the moment it opens: they can press Submit while the agent is still filling, or while
  // it waits its turn (21 Oct: Sarvam AI and Matter Labs were sent that way and their runs never saw it).
  watchSubmit(page: Page, onSubmit: () => void) {
    const context = page.context();
    let seen = false;
    const onRequest = (request: Request) => {
      if (seen || request.method() !== "POST" || !/ashbyhq\.com/i.test(request.url())) return;
      if (!(request.postData() ?? "").includes(`"${SUBMIT_OPERATION}"`)) return;
      seen = true;
      onSubmit();
    };
    context.on("request", onRequest);
    return () => context.off("request", onRequest);
  },
  confirmation(page: Page) {
    return successShown(page);
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
        if (value.type === "number") {
          // Digits only; anything else is asked again as a plain number, never guessed.
          const number = value.value.replace(/[\s,]/g, "").match(/^-?\d+(\.\d+)?$/)?.[0];
          if (!number) throw new NeedsAnswerError({ key: customQuestionKey(value.label), label: `${value.label} (a number only)`, type: "number", required: true });
          await entry.locator("input").first().fill(number);
          return number;
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
    // ASHBY_DIAGNOSTICS=1 only (ashbyDiagnostics.ts): watches, never changes anything.
    const diagnostics = watchAshby(page, ctx.diagnosticsTag ?? "-");
    let outcome = "error";
    try {
      await dismissOverlays(page);
      // Catch an unfilled required field here, before Submit: a form sent half empty is the kind Ashby's spam check dislikes.
      const empty = await emptyRequired(page);
      diagnostics.mark(`checked required fields empty=${empty.length}`);
      if (empty.length > 0) throw new NoRetryError(`These required questions are still empty: ${empty.slice(0, 5).join(", ")}`);
      // Always the person's Submit (lib/queue.ts HANDOFF_BOARDS): this adapter never presses it.
      const result = await waitForUserSubmit(page, ctx);
      outcome = "confirmed";
      return result;
    } catch (error) {
      // The error's class and a fixed category: its message can carry a form label or a page's text, so it is not logged.
      outcome = error instanceof Error ? `${error.constructor.name}/${categorize(error.message)}` : "error";
      throw error;
    } finally {
      await diagnostics.finish(outcome);
    }
  },
};
