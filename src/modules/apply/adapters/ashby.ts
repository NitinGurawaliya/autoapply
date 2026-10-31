import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Locator, Page, Request, Response } from "playwright";
import { protectionLevel, UNPROTECTED } from "@/lib/ashby-protection";
import { joinChoices, splitChoices } from "@/lib/choices";
import { customQuestionKey } from "@/modules/answers";
import type { AtsAdapter, FilledField, FormField, ResolvedValue, SubmitContext, SubmitResult } from "../adapter";
import { BotCheckError, MaybeSentError, NeedsAnswerError, NoRetryError, NotSentError, RefusedError, WindowClosedError } from "../adapter";
import { autoSubmitAshby, canShowWindow, livePage } from "../browser";
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
    if (boxes.length > 1 || (boxes.length === 1 && entry.querySelector('.ashby-application-form-input-checkbox-group'))) {
      const options = boxes.map(optionText);
      // A group of one box with no text of its own: the question is what the box says (27 Oct, OakNorth "Please confirm you
      // have read and understood our privacy policy."). Asked with its empty option, the user had nothing to pick.
      if (boxes.length === 1 && !options[0]) return void rows.push({ path, label, kind: 'checkbox', required });
      return void rows.push({ path, label, kind: 'checkbox-group', required, options });
    }
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
    const combo = entry.querySelector('input[role=combobox]');
    let empty = false;
    // A Yes/No pair keeps a hidden checkbox that stays unticked for "No": judge it by the pressed button.
    if (entry.querySelector('.ashby-application-form-input-yesno')) empty = !entry.querySelector('[aria-pressed="true"]');
    // A picker shows its choice in its box. Ashby's "Education History" is a School picker with optional degree, field and
    // month and year boxes: judged by the first box (an empty start month), a picked school read as empty (27 Oct, Ramp).
    else if (combo) empty = !combo.value.trim();
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

// Ashby's own description of the form, the query the page itself sends (atsfill, read 29 Oct): which questions are
// required, straight from Ashby. The page's markup marks some required pickers on the input, not the title (16 Oct, Tekion).
// Also a picker's fixed choices (ValueSelect): the page shows them only after typing, so the agent matched blind and the
// user was asked with no choices to pick from (30 Oct, Netgear "How did you hear": "Job board" and "Company website" missed).
const READ_SCHEMA = `(async () => {
  const [org, job] = location.pathname.split('/').filter(Boolean);
  const query = 'query ApiJobPosting($org: String!, $job: String!) { jobPosting(organizationHostedJobsPageName: $org, jobPostingId: $job) { applicationForm { ...Form } surveyForms { ...Form } } } fragment Form on FormRender { sections { fieldEntries { isRequired field } } }';
  const response = await fetch('/api/non-user-graphql?op=ApiJobPosting', { method: 'POST', headers: { 'content-type': 'application/json', 'apollographql-client-name': 'frontend_non_user' }, body: JSON.stringify({ operationName: 'ApiJobPosting', query, variables: { org, job } }) });
  const posting = (await response.json()).data.jobPosting;
  const out = {};
  for (const form of [posting.applicationForm, ...(posting.surveyForms || [])]) for (const section of form.sections) for (const entry of section.fieldEntries) {
    const values = (entry.field.selectableValues || []).filter((v) => v && !v.isArchived).map((v) => String(v.label || v.value || '').trim()).filter(Boolean);
    out[entry.field.path] = { required: Boolean(entry.isRequired), options: values.length ? values : null };
  }
  return out;
})()`;

/** Per question path, whether Ashby requires it and its fixed choices; null when the query fails (the markup decides then). */
async function readSchema(page: Page): Promise<Record<string, { required: boolean; options: string[] | null }> | null> {
  return ((await page.evaluate(READ_SCHEMA).catch(() => null)) as Record<string, { required: boolean; options: string[] | null }> | null) ?? null;
}

async function readFields(page: Page): Promise<FormField[]> {
  await page
    .locator("#_systemfield_name, .ashby-application-form-field-entry")
    .first()
    .waitFor({ timeout: 25000 })
    .catch(async (error) => {
      await assertJobOpen(page);
      const blocked = pageBlock(await page.locator("body").innerText().catch(() => ""));
      if (blocked) throw new NoRetryError(blocked);
      throw error;
    });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
  const rows = (await page.evaluate(READ_FORM)) as Row[];
  if (rows.length === 0) throw new Error("The application form did not load properly (it had no fields)");
  const schema = await readSchema(page);
  const fields: FormField[] = [];
  for (const raw of rows) {
    const known = schema?.[raw.path];
    // A picker's choices come from Ashby when the page does not list them (a type-to-search box).
    const row = known ? { ...raw, required: known.required, options: raw.options ?? (raw.kind === "combobox" ? known.options ?? undefined : undefined) } : raw;
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

const firstLine = (text: string) => text.trim().split("\n")[0].replace(/\s+/g, " ").trim();

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
    const shown = await options.allInnerTexts();
    texts = shown.map((text) => text.replace(/\s+/g, " ").trim());
    // A school option is its name with the country and website on lines below ("Jaypee University of Information
    // Technology", "India", "juit.ac.in", 25 Oct, Applied Intuition): the name line is the option.
    index = pickSearchOption(texts, candidate);
    if (index < 0) index = pickSearchOption(shown.map(firstLine), candidate);
    if (index >= 0) break;
  }
  if (index < 0 && SCHOOL_PICKER.test(value.label)) {
    await input.click();
    await input.fill("");
    await input.pressSequentially("Other", { delay: 60 });
    await options.first().waitFor({ timeout: 8000 }).catch(() => undefined);
    const shown = await options.allInnerTexts();
    texts = shown.map((text) => text.replace(/\s+/g, " ").trim());
    index = shown.findIndex((text) => NOT_LISTED.test(firstLine(text)));
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
// 24 Oct, ElevenLabs: "We couldn't submit your application … you have applied for a position in this domain within the
// last 90 days" — the company's own limit, nothing sent.
const REFUSED = /flagged as (possible )?spam|couldn.t be submitted|couldn.t submit your application|unable to submit your application/i;
// Ashby's page, or the network in front of it, turned this connection away: a person in the same window would be too.
const ACCESS_DENIED = /access denied|403 forbidden|you (don.t|do not) have permission to (access|view)/i;
const RATE_LIMITED = /too many (requests|attempts|submissions|applications)|rate limit(ed)?\b/i;
// A code Ashby emailed to confirm the address: only a person with that inbox can give it.
const CODE_ASKED = /(enter|type) the (\d-digit |verification |security |one-time )?code|we (sent|emailed) (you )?a (\d-digit )?(verification |security |one-time )?code|verify your email/i;

/** Why Ashby's page turned the run away before any form (access denied, rate limited), or null. */
function pageBlock(body: string) {
  if (ACCESS_DENIED.test(body)) return "Ashby denied access to the application page from this connection. Nothing was sent; open the posting and apply in your usual browser.";
  if (RATE_LIMITED.test(body)) return "Ashby is limiting requests from this connection right now. Nothing was sent; press Retry in a while.";
  return null;
}

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

/**
 * Gives a choice question's current answer again, as a person correcting it does: another option first, then the answer,
 * so Ashby saves it anew. For a Yes/No pair, a radio group or a select; false when there is no answer on screen to give.
 */
export async function repick(entry: Locator) {
  const pair = entry.locator("button.ashby-application-form-input-yesno-option");
  if ((await pair.count()) === 2) {
    const pressed = (await entry.locator('button.ashby-application-form-input-yesno-option[aria-pressed="true"]').first().textContent({ timeout: 2000 }).catch(() => null))?.trim();
    if (!pressed) return false;
    await entry.locator('button.ashby-application-form-input-yesno-option[aria-pressed="false"]').first().click();
    await pair.filter({ hasText: new RegExp(`^${pressed}$`) }).first().click();
    return true;
  }
  const radios = entry.locator('input[type="radio"]');
  const count = await radios.count();
  if (count > 1) {
    let checked = -1;
    for (let index = 0; index < count && checked < 0; index += 1) if (await radios.nth(index).isChecked().catch(() => false)) checked = index;
    if (checked < 0) return false;
    await clickOption(entry, radios.nth(checked === 0 ? 1 : 0));
    await clickOption(entry, radios.nth(checked));
    return true;
  }
  const select = entry.locator("select").first();
  if ((await select.count()) > 0) {
    const value = await select.inputValue().catch(() => "");
    if (!value) return false;
    await select.selectOption({ index: 0 });
    await select.selectOption(value);
    return true;
  }
  return false;
}

/**
 * Gives the named questions' answers again so Ashby's form state takes them: a text box typed key by key, a choice picked
 * anew (repick). Returns how many it gave again.
 */
async function retypeEntries(page: Page, labels: string[]) {
  let typed = 0;
  for (const label of labels) {
    const entry = page.locator("[data-field-path]").filter({ has: page.locator(".ashby-application-form-question-title", { hasText: label }) }).first();
    if (await giveAgain(entry)) typed += 1;
  }
  return typed;
}

/** Gives one question's answer on screen again: a text box typed key by key, a choice picked anew (repick). */
async function giveAgain(entry: Locator) {
  const input = entry.locator("input:not([type=file]):not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea").first();
  // 27 Oct, Writer: "Missing entry" for a radio group and a Yes/No pair answered on screen; only text boxes were typed again.
  if ((await input.count()) === 0) return repick(entry).catch(() => false);
  // A picker's box is not typed into: its answer is the option picked, and typing would only open its list.
  if ((await input.getAttribute("role").catch(() => null)) === "combobox") return false;
  const value = await input.inputValue().catch(() => "");
  if (!value.trim()) return false;
  await input.scrollIntoViewIfNeeded().catch(() => undefined);
  await input.click();
  await input.fill("");
  await input.pressSequentially(value, { delay: 25 });
  await input.press("Tab");
  return true;
}

const SAVE_OPERATION = /"operationName"\s*:\s*"ApiSetFormValue"/;
// Every request that changes the form on Ashby's side: answers, and a file's handle and its setting.
const FORM_CHANGE = /"operationName"\s*:\s*"Api(SetFormValue\w*|CreateFileUploadHandle)"/;

/** Per question path, whether a form Ashby returned holds a value for it. */
function heldIn(body: string) {
  const held = new Map<string, boolean>();
  try {
    const data = (JSON.parse(body) as { data?: Record<string, unknown> }).data ?? {};
    for (const render of Object.values(data)) {
      const sections = (render as { sections?: Array<{ fieldEntries?: Array<{ field?: { path?: string }; fieldValue?: unknown }> }> } | null)?.sections;
      for (const entry of (Array.isArray(sections) ? sections : []).flatMap((section) => section.fieldEntries ?? [])) {
        if (entry.field?.path) held.set(entry.field.path, entry.fieldValue != null);
      }
    }
  } catch {
    // not a form
  }
  return held;
}

/**
 * Ashby saves each answer on its server as it is given, one "ApiSetFormValue" per question, and Submit sends only the
 * form's id (28 Oct, read off Writer's form). An answer whose save failed is "Missing entry for required field" with the
 * answer still on screen (27 Oct: Writer's office-hub radio and office Yes/No, twice). This records, per question path,
 * whether its latest save was accepted, and what Ashby holds: each save's answer is the whole form as Ashby has it
 * (29 Oct, read off Writer's live form), so it is the read-back. Saves in flight together can overwrite each other at
 * Ashby (atsfill's notes), so the fill makes one change at a time and waits for its save (afterChange).
 */
export function watchSaves(page: Page) {
  const context = page.context();
  const saved = new Map<string, boolean>();
  const answered = new Map<string, number>();
  const held = new Map<string, boolean>();
  let forms = 0;
  const inFlight = new Set<Request>();
  const pathOf = (request: Request) => {
    if (request.method() !== "POST" || !/ashbyhq\.com/i.test(request.url())) return null;
    const body = request.postData() ?? "";
    if (!SAVE_OPERATION.test(body)) return null;
    try {
      const path = (JSON.parse(body) as { variables?: { path?: unknown } }).variables?.path;
      return typeof path === "string" ? path : null;
    } catch {
      return null;
    }
  };
  const changes = (request: Request) => request.method() === "POST" && /ashbyhq\.com/i.test(request.url()) && FORM_CHANGE.test(request.postData() ?? "");
  const onRequest = (request: Request) => {
    if (changes(request)) inFlight.add(request);
  };
  const onFinished = (request: Request) => {
    if (!changes(request)) return;
    const path = pathOf(request);
    void request
      .response()
      .then(async (response) => {
        const body = response ? await response.text().catch(() => "") : "";
        const form = heldIn(body);
        if (form.size > 0) forms += 1;
        for (const [key, value] of form) held.set(key, value);
        if (!path) return;
        saved.set(path, Boolean(response?.ok()) && !/"errors"\s*:\s*\[\s*\{/.test(body));
        answered.set(path, (answered.get(path) ?? 0) + 1);
      })
      .catch(() => path && saved.set(path, false))
      .finally(() => inFlight.delete(request));
  };
  const onFailed = (request: Request) => {
    if (!changes(request)) return;
    const path = pathOf(request);
    if (path) saved.set(path, false);
    if (path) answered.set(path, (answered.get(path) ?? 0) + 1);
    inFlight.delete(request);
  };
  context.on("request", onRequest);
  context.on("requestfinished", onFinished);
  context.on("requestfailed", onFailed);
  const settled = async (ms: number) => {
    const until = Date.now() + ms;
    while (inFlight.size > 0 && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 200));
  };
  return {
    accepted: (path: string) => saved.get(path) === true,
    /** Whether the last form Ashby returned holds an answer for the path; undefined when no returned form had it. */
    held: (path: string) => held.get(path),
    /** How many forms Ashby returned: none means the read-back was not seen, so it decides nothing. */
    forms: () => forms,
    /** How many saves of the path Ashby has answered. */
    answers: (path: string) => answered.get(path) ?? 0,
    /**
     * After a change to the path: waits for its save to be answered (an unchanged value sends none, so not long), then
     * for anything else in flight, so the next change never overlaps it.
     */
    async afterChange(path: string, before: number) {
      const until = Date.now() + 3000;
      while ((answered.get(path) ?? 0) <= before && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 100));
      await settled(15000);
    },
    /** Waits for the saves already sent to be answered, up to `ms`. */
    settled,
    stop: () => {
      context.off("request", onRequest);
      context.off("requestfinished", onFinished);
      context.off("requestfailed", onFailed);
    },
  };
}

/** The question path in an entry selector (entryOf). */
const pathIn = (selector: string | undefined) => selector?.match(/data-field-path="((?:[^"\\]|\\.)+)"/)?.[1]?.replace(/\\"/g, '"') ?? "";
// Choice answers, which a click can leave unsaved while the page shows them picked. Text boxes are typed again after Submit.
const CHOICE_TYPES = new Set(["yesno", "radio", "select"]);

export const HANDOFF_WAIT_MS = 15 * 60 * 1000;
const AUTO_WAIT_MS = 2 * 60 * 1000;

/** A reCAPTCHA challenge (the image grid) is on screen: its "bframe" frame is shown at a real size. */
async function challengeShown(page: Page) {
  const frames = page.locator('iframe[src*="recaptcha"][src*="bframe"]');
  const count = await frames.count().catch(() => 0);
  for (let index = 0; index < count; index += 1) {
    const box = await frames.nth(index).boundingBox().catch(() => null);
    if (box && box.width > 100 && box.height > 100 && (await frames.nth(index).isVisible().catch(() => false))) return true;
  }
  return false;
}

/** What Ashby's answer to a submit says: sent, a bot-check score too low, the candidate refused, the form invalid, or unread. */
export type SubmitAnswer = { kind: "sent" | "captcha" | "refused" | "invalid" | "unknown"; detail?: string };

/**
 * Reads Ashby's answer to a submit (atsfill's notes, 29 Oct): `applicationFormResult` is "FormSubmitSuccess" when sent, else
 * a form whose `errorMessages` / `formErrors` say why; `messages.blockMessageForCandidateHtml` is Ashby refusing the
 * candidate; a reCAPTCHA score too low answers "RECAPTCHA_SCORE_BELOW_THRESHOLD" and nothing is sent.
 */
export function readSubmitAnswer(body: string): SubmitAnswer {
  if (/RECAPTCHA_SCORE_BELOW_THRESHOLD/.test(body)) return { kind: "captcha" };
  type Action = { applicationFormResult?: { __typename?: string; errorMessages?: unknown[]; formErrors?: unknown[] }; messages?: { blockMessageForCandidateHtml?: string | null } };
  let action: Action | undefined;
  try {
    action = Object.values((JSON.parse(body) as { data?: Record<string, Action> }).data ?? {})[0];
  } catch {
    return { kind: "unknown" };
  }
  const block = action?.messages?.blockMessageForCandidateHtml;
  if (block) return { kind: "refused", detail: block.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200) };
  const result = action?.applicationFormResult;
  if (result?.__typename === "FormSubmitSuccess") return { kind: "sent" };
  const errors = [...(result?.errorMessages ?? []), ...(result?.formErrors ?? [])];
  if (errors.length > 0) return { kind: "invalid", detail: JSON.stringify(errors).slice(0, 200) };
  return { kind: "unknown" };
}

/** Ashby's answer to a submission the window sent, read off the network so it survives the page going away. */
type SentSubmission = { ok: boolean; status: number; body: string; answer: SubmitAnswer };

// Ashby's submit operations: "ApiSubmitSingleApplicationFormAction" (seen 21 Oct: an accepted handoff sent it, a refused
// automated run did not), and "ApiSubmitMultipleFormsAction" for a form in sections (28 Oct, Writer: missed until then, so
// a sent Writer form read as "nothing reached Ashby"). Resume uploads and saved answers are other operations.
const SUBMIT_OPERATION = /"operationName"\s*:\s*"ApiSubmit\w*Action"/;

/** Whether a request's body is Ashby's submit. */
export function carriesSubmit(body: string | null | undefined) {
  return SUBMIT_OPERATION.test(body ?? "");
}

/** The form's own submission: a POST to Ashby carrying a submit operation. */
function isSubmission(response: Response) {
  const request = response.request();
  if (request.method() !== "POST" || !/ashbyhq\.com/i.test(response.url())) return false;
  return carriesSubmit(request.postData());
}

/** Accepted when the server answered OK with no GraphQL errors and no spam refusal in its body. */
function accepted(sent: SentSubmission) {
  // Ashby's own answer turning it away (29 Oct: ElevenLabs' and Sarvam's block messages read as accepted until then).
  if (["captcha", "refused", "invalid"].includes(sent.answer.kind)) return false;
  return sent.ok &&!/"errors"\s*:\s*\[\s*\{/.test(sent.body) && !/spam|captcha|missing entry/i.test(sent.body);
}

/**
 * What this window sends Ashby: POSTs counted as they leave (once counting is on) and Ashby's answer to each submit,
 * read off the network so it survives the page going away.
 */
function watchSubmissions(page: Page, onFirstPost?: () => void) {
  const context = page.context();
  const state = { counting: false, posts: 0, sent: [] as SentSubmission[] };
  // Counted when a request leaves, not when Ashby answers: a window closed between the two must not read as "nothing sent".
  // Only the submit itself: 27 Oct, Resend's form uploaded the resume again behind a challenge, that upload counted as "sent"
  // and a run that sent nothing was recorded "may have been sent". The submit carries its operation name (watchSubmit).
  const onRequest = (request: Request) => {
    if (!state.counting || request.method() !== "POST" || !/ashbyhq\.com/i.test(request.url())) return;
    if (!carriesSubmit(request.postData())) return;
    state.posts += 1;
    if (state.posts === 1) onFirstPost?.();
  };
  const onResponse = (response: Response) => {
    if (!isSubmission(response)) return;
    // Read whole: the result comes after the form in the body, past any slice kept.
    response.text().then(
      (body) => state.sent.push({ ok: response.ok(), status: response.status(), body: body.slice(0, 4000), answer: response.ok() ? readSubmitAnswer(body) : { kind: "unknown" } }),
      () => state.sent.push({ ok: response.ok(), status: response.status(), body: "", answer: { kind: "unknown" } }),
    );
  };
  context.on("request", onRequest);
  context.on("response", onResponse);
  return {
    state,
    accepted: () => state.sent.some(accepted),
    /** Ashby's own answer that the application was sent (FormSubmitSuccess). */
    sentConfirmed: () => state.sent.some((sent) => sent.answer.kind === "sent"),
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
    // Ashby's own answer decides when it was read: sent, or every submit turned away (a bot-check score, the candidate
    // refused, the form invalid), which sends nothing.
    if (watcher.sentConfirmed()) return { confirmed: true, evidence: "Ashby's server answered FormSubmitSuccess (the page was gone before its Success showed)" };
    if (state.sent.length === state.posts && state.sent.every((sent) => ["captcha", "refused", "invalid"].includes(sent.answer.kind))) {
      throw new WindowClosedError("The Ashby window was closed after Ashby turned the submission away. Nothing was sent.");
    }
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
    // ASHBY_AUTO_SUBMIT=1 (browser.ts autoSubmitAshby): the worker presses Submit once itself, a plain click with nothing
    // about the browser changed, and reCAPTCHA decides. 24 Oct, visible Chrome: 8 clicks, none blocked, 4 sent. Never on a
    // run Ashby already asked a person for (ctx.person): a person presses Submit and answers Ashby's check.
    let auto = autoSubmitAshby() && !ctx.person;
    // Without a screen (headless Chromium), the company's own spam protection decides before any click. Every Ashby Submit
    // from 21 to 27 Oct: headless, "none" sent 8 of 8 and "low" or above was challenged 31 of 31 (Windows and Docker, 11
    // reruns included); in a visible Chrome window the worker's click at "low" was challenged 0 of 6 (24 Oct, Sardine and
    // OpenGov sent). So only a headless run is held back: anything but "none", an unreadable level included, goes to a
    // person with no click. With a screen the worker clicks, and a challenge hands this window to the person (askPerson).
    if (auto && !canShowWindow()) {
      const level = await protectionLevel(page.url());
      if (level !== UNPROTECTED) {
        throw new BotCheckError(
          level
            ? `This company's Ashby spam protection (${level}) needs a person to press Submit. Nothing was sent.`
            : "This company's Ashby spam protection could not be read, so a person presses Submit. Nothing was sent.",
        );
      }
    }
    if (auto && button) {
      await button.click().catch(() => undefined);
      setTimeout(() => console.log(`ashby auto submit: posts=${state.posts} submits=${state.sent.length} accepted=${watcher.accepted()}`), 15000);
    } else if (ctx.person) {
      await ctx.announceHandoff?.("Ashby asked to confirm a person is applying: check the form in the Chrome window on your computer, press Submit and complete Ashby's check");
    } else {
      await ctx.announceHandoff?.("Ready to send: check the form in the Chrome window on your computer and press Submit");
    }
    let retyped = false;
    // How many submits Ashby had answered when its reCAPTCHA score turned the worker's away (-1: never).
    let scoredAt = -1;
    // Ashby answers a click within seconds; the 15 minutes are for a person.
    let deadline = Date.now() + (auto ? AUTO_WAIT_MS : HANDOFF_WAIT_MS);
    // Ashby wants a person: a reCAPTCHA challenge on the worker's Submit (24-25 Oct, Docker: 8 applications, and none of the 7
    // immediate reruns got past it), or a code emailed to the candidate. Never solved or worked around. With a screen this
    // same window becomes a handoff, the filled form kept as it is; without one the run stops as not sent and the runner
    // passes it to a worker with a screen (runner.ts).
    const askPerson = async (what: string) => {
      if (!canShowWindow()) throw new BotCheckError(`${what} when the worker pressed Submit. Nothing was sent.`);
      auto = false;
      deadline = Date.now() + HANDOFF_WAIT_MS;
      await ctx.announceHandoff?.(`${what}: complete it in the Chrome window on your computer, then press Submit if the form is still there`);
    };
    for (;;) {
      if (Date.now() >= deadline) {
        // 24 Oct, Airbound: nothing at all left the page after the worker's click, the challenge not even on screen.
        if (!auto || state.sent.length > 0 || state.posts > 0) break;
        await askPerson("Nothing reached Ashby after the worker pressed Submit (its bot check may have stopped it)");
        continue;
      }
      // The page may be replaced by a new one in the same window when Ashby shows Success: follow it.
      const live = livePage(page);
      if (!live) return outcomeWithoutPage();
      if (await ctx.cancelled?.()) {
        if (state.sent.length > 0 || state.posts > 0) return outcomeWithoutPage();
        throw new NotSentError("Cancelled before Submit was pressed. Nothing was sent.");
      }
      const done = await successShown(live);
      if (done) return { confirmed: true, evidence: `${done} after ${auto ? "the worker pressed Submit" : "you pressed Submit"}` };
      if (watcher.sentConfirmed()) return { confirmed: true, evidence: `Ashby's server answered FormSubmitSuccess after ${auto ? "the worker pressed Submit" : "you pressed Submit"}` };
      const refusedBy = state.sent.find((sent) => sent.answer.kind === "refused");
      if (refusedBy) throw new RefusedError(`Ashby refused the application ("${refusedBy.answer.detail}"). Nothing was sent. Open the posting and apply in your usual browser.`);
      // Ashby's reCAPTCHA scored the worker's click too low: nothing was sent, and only a person gets past it.
      // The page then shows "flagged as possible spam" until the person's own Submit is answered: that notice is not theirs.
      const scored = state.sent.filter((sent) => sent.answer.kind === "captcha").length;
      if (auto && scored > 0) {
        scoredAt = state.sent.length;
        await askPerson("Ashby's reCAPTCHA turned the submission away");
        continue;
      }
      // Ashby's own answer to the submit turned it away, so it was not taken: rate limited, or this connection refused.
      const turnedAway = state.sent.find((sent) => sent.status === 429 || sent.status === 403);
      if (turnedAway) {
        throw new RefusedError(
          turnedAway.status === 429
            ? "Ashby is limiting applications from this connection right now (HTTP 429). Nothing was sent; press Retry in a while."
            : "Ashby turned the submission away (HTTP 403). Nothing was sent. Open the posting and apply in your usual browser.",
        );
      }
      if (auto && state.posts === 0 && (await challengeShown(live))) {
        await askPerson("Ashby asked to confirm a person is applying (a reCAPTCHA check)");
        continue;
      }
      const body = await live.locator("body").innerText().catch(() => "");
      if (REFUSED.test(body) && state.sent.length > scoredAt) {
        const refusal = body.match(REFUSED)?.[0] ?? "refused";
        throw new RefusedError(`Ashby refused the application ("${refusal}"). Nothing was sent. Open the posting and apply in your usual browser.`);
      }
      if (auto && CODE_ASKED.test(body)) {
        await askPerson("Ashby emailed you a code to confirm your address");
        continue;
      }
      // The worker's click met Ashby's own validation, so nothing was accepted. With a person at the window they fix the
      // field and press Submit again, so a handoff keeps waiting.
      const missing = [...body.matchAll(/Missing entry for required field:\s*([^\n]+)/g)].map((match) => match[1].trim());
      if (missing.length > 0 && auto) {
        // The box shows the value but Ashby's form state does not have it (24 Oct: DDN's Notice Period showed "7").
        // Typed again key by key it registers; then Submit once more, once.
        if (retyped) throw new NotSentError(`Ashby did not accept the form: missing ${missing.join(", ").slice(0, 120)}. Nothing was sent.`);
        retyped = true;
        const typed = await retypeEntries(live, missing);
        console.log(`ashby auto submit: retyped ${typed} of ${missing.length} field(s), pressing Submit again`);
        await live.locator("button.ashby-application-form-submit-button").first().click().catch(() => undefined);
        // Let Ashby replace the old notice before it is read again.
        await new Promise((resolve) => setTimeout(resolve, 8000));
        continue;
      }
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

/** Fills each value into its question, one save at a time; the files are attached by the runner (uploadFile). */
async function fillValues(page: Page, values: ResolvedValue[], saves: ReturnType<typeof watchSaves>) {
  const filled: FilledField[] = [];
  await dismissOverlays(page);
  for (const value of values) {
    if (value.type === "file") continue;
    const path = pathIn(value.selector);
    const before = saves.answers(path);
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
        // A checkbox group may hold several choices, one per line (lib/choices.ts); a radio holds one.
        const wanted = value.type === "checkbox-group" ? splitChoices(value.value) : [value.value];
        const picked: string[] = [];
        for (const choice of wanted) {
          const index = pickLabel(labels, choice);
          if (index < 0) throw new Error(`No option "${choice}" for "${value.label}"`);
          // A forced check shows the dot but Ashby's form state can miss it ("Missing entry", 15 Oct, ElevenLabs).
          await clickOption(entry, inputs.nth(index));
          picked.push(labels[index]);
        }
        return joinChoices(picked);
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
      // A profile link saved without its scheme ("linkedin.com/in/…") is the same link with https://: Ashby dropped the
      // bare form and answered "Missing entry for required field: LinkedIn URL" (24 Oct, Sardine).
      const text = /^(linkedin|github|portfolio|website)$/.test(value.key) && /^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+\/\S*$/i.test(value.value.trim()) ? `https://${value.value.trim()}` : value.value;
      await entry.locator("input:not([type=file]), textarea").first().fill(text);
      return text;
    });
    // Ashby saves a typed answer when its box loses focus: leave it, then wait for that save before the next question.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.()).catch(() => undefined);
    await saves.afterChange(path, before);
    if (written === null) continue;
    filled.push({ key: value.key, label: value.label, value: written, source: value.source, selector: value.selector });
  }
  return filled;
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
      if (!carriesSubmit(request.postData())) return;
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
    const saves = watchSaves(page);
    try {
      const filled = await fillValues(page, values, saves);
      await saves.settled(10000);
      // Every answer given here must be held by Ashby before Submit: a choice whose save failed, or any answer the form
      // Ashby returned last does not hold, is given again, once.
      const typeOf = (field: FilledField) => values.find((value) => value.selector === field.selector)?.type ?? "";
      const lost = (field: FilledField) => (CHOICE_TYPES.has(typeOf(field)) && !saves.accepted(pathIn(field.selector))) || saves.held(pathIn(field.selector)) === false;
      const unsaved = filled.filter(lost);
      if (unsaved.length > 0) {
        for (const field of unsaved) {
          const path = pathIn(field.selector);
          const before = saves.answers(path);
          await giveAgain(page.locator(field.selector!)).catch(() => false);
          await saves.afterChange(path, before);
        }
        const still = unsaved.filter(lost);
        console.log(`ashby saves: ${unsaved.length} of ${filled.length} answer(s) not held by Ashby, given again; ${still.length} still not held`);
        // A required answer Ashby still does not hold would be "Missing entry" after Submit, with reCAPTCHA already spent on
        // it: stop here instead. Nothing was sent, so the run may be retried. Only when Ashby's forms were seen at all.
        const required = still.filter((field) => values.find((value) => value.selector === field.selector)?.required && saves.held(pathIn(field.selector)) === false);
        if (required.length > 0 && saves.forms() > 0) throw new Error(`Ashby did not keep the answers to: ${required.map((field) => field.label).join(", ").slice(0, 160)}`);
      }
      const kept = filled.filter((field) => saves.held(pathIn(field.selector)) === true).length;
      console.log(`ashby saves: ${kept} of ${filled.length} answer(s) held by Ashby (${saves.forms()} form(s) read back)`);
      return filled;
    } finally {
      saves.stop();
    }
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
      // The person's Submit (lib/queue.ts HANDOFF_BOARDS), or the worker's own with ASHBY_AUTO_SUBMIT=1.
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
