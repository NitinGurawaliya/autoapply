import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Locator, Page, Request } from "playwright";
import { joinChoices, splitChoices } from "@/lib/choices";
import type { AtsAdapter, FilledField, FormField, ResolvedValue, SubmitResult } from "../adapter";
import { BotCheckError, MaybeSentError, NoRetryError, RefusedError, WindowClosedError } from "../adapter";
import { livePage } from "../browser";
import { assertJobOpen, dismissOverlays, inField } from "./common";
import { analyzeTestImage } from "../captcha/ai";
/**
 * Keka career portals (T96): `{company}.keka.com/careers/applyjob/{id}`. A plain server-rendered form with stable ids,
 * described by public JSON (`/careers/{id}/2/applicationform`: each field's identifier, type, required, options), so the
 * fields are read from that and found on the page by id. The resume goes in through the page's own uploader, which
 * parses it and fills the hidden `resume.*` inputs the submit needs.
 *
 * Every Keka form has an image CAPTCHA tied to the browser session (`/careers/Captcha`, checked on submit). Keka is a
 * handoff board (lib/queue.ts): the form is filled in a visible Chrome window on a worker with a screen, the CAPTCHA is
 * read and typed in the captcha step (../captcha), then the worker presses "Apply Now"; a person steps in only when
 * that check fails.
 */

// Keka's field types in the form JSON (read 31 Oct on Jupiter and Keka's own portal).
const TEXT = 1;
const LONG_TEXT = 2;
const SELECT = 3;
const CHECKBOXES = 4;
const RADIO = 5;
const DATE = 6;
const FILE = 7;
const FILES = 8;
const NUMBER = 9;
// A link box: Keka checks it on change and refuses anything but http(s)://, ftp:// or www. (validateUrlInput).
const LINK = 10;

export type SchemaField = { identifier: string; fieldName: string; fieldType: number; required: boolean; fieldOptions: Array<{ value: string }> };

// The fixed fields Keka names itself: what each one is, so the mapper does not have to guess.
const HINTS: Record<string, string> = {
  email: "email",
  phone: "phone",
  firstName: "first_name",
  lastName: "last_name",
  gender: "gender",
  resume: "resume",
  workExperience: "years_experience",
  currentSalary: "current_ctc",
  expectedSalary: "expected_ctc",
  // "Available To Join (in days)" is the notice period in days.
  availability: "notice_period",
  currentLocation: "city",
};
// Optional by default and not facts we hold, or widgets the agent does not fill yet: left blank unless required.
const SKIP_UNLESS_REQUIRED = new Set(["middleName", "additionalDocuments", "skills", "experienceDetails", "educationDetails", "dateOfBirth", "locationPreference"]);
// Documents we do not hold (degree certificates and the like): a form that requires them stops before anything is filled.
const UNSUPPORTED = new Set(["additionalDocuments"]);

// The first row of Keka's work-history and education sections (1 Nov, Aiden AI's form), filled from the resume's most
// recent role and degree (history.ts, by id). Labels say which row they belong to, so a field the resume cannot fill
// is not mapped to another answer ("Date of Joining" is not the availability date). Locations are left out: the
// resume does not say where a role or degree was.
type RowField = { id: string; label: string; type: string; key?: boolean };
const SECTIONS: Record<string, { add: RegExp; first: string; fields: RowField[] }> = {
  experienceDetails: {
    add: /add experience details/i,
    first: "companyName_0",
    fields: [
      { id: "companyName_0", label: "Most recent job: company name", type: "text", key: true },
      { id: "designation_0", label: "Most recent job: job title", type: "text", key: true },
      { id: "isCurrentlyWorking_0", label: "Most recent job: currently working here", type: "checkbox" },
      { id: "experienceDateOfJoining_0", label: "Most recent job: start month", type: "month-year" },
      { id: "dateOfRelieving_0", label: "Most recent job: end month", type: "month-year" },
    ],
  },
  educationDetails: {
    add: /add education details/i,
    first: "degree_0",
    fields: [
      { id: "degree_0", label: "Highest degree: course", type: "text", key: true },
      { id: "branch_0", label: "Highest degree: branch or specialization", type: "text" },
      { id: "university_0", label: "Highest degree: university or college", type: "text", key: true },
    ],
  },
};

/** The section's first row, added with its own "+ Add" link when the form does not show one yet. */
async function sectionRow(page: Page, section: (typeof SECTIONS)[string]) {
  const first = page.locator(byId(section.first));
  if (await first.count()) return true;
  await page.locator("#jobApplicationForm a, #jobApplicationForm button").filter({ hasText: section.add }).first().click({ timeout: 10000 }).catch(() => undefined);
  return first.waitFor({ state: "attached", timeout: 10000 }).then(() => true, () => false);
}

const byId = (id: string) => `[id="${id.replace(/"/g, '\\"')}"]`;
const norm = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();

/** `slug:id` (fetchers/keka.ts) → the job's application form. */
function formUrl(job: { applyUrl: string; externalId: string }) {
  const [slug, id] = job.externalId.split(":");
  if (slug && id) return `https://${slug}.keka.com/careers/applyjob/${id}`;
  return job.applyUrl.replace("/jobdetails/", "/applyjob/");
}



const jobIdOf = (url: string) => url.match(/\/applyjob\/(\d+)/)?.[1] ?? null;

async function readSchema(page: Page): Promise<SchemaField[]> {
  const jobId = jobIdOf(page.url());
  if (!jobId) throw new NoRetryError("This is not a Keka application form.");
  const body = await page.evaluate(async (id) => {
    const response = await fetch(`/careers/${id}/2/applicationform`, { headers: { Accept: "application/json" } });
    return response.ok ? response.json() : null;
  }, jobId);
  if (!Array.isArray(body)) throw new Error("Keka did not describe its application form");
  return (body as Array<Record<string, unknown>>).map((field) => ({
    identifier: String(field.identifier ?? ""),
    fieldName: String(field.fieldName ?? field.identifier ?? ""),
    fieldType: Number(field.fieldType ?? TEXT),
    required: field.required === true || field.requirementType === 1,
    fieldOptions: Array.isArray(field.fieldOptions) ? (field.fieldOptions as Array<{ value?: unknown }>).map((option) => ({ value: String(option.value ?? "") })).filter((option) => option.value) : [],
  }));
}

// Runs inside the page: what each field's element is, by the identifier the form JSON gives (also a custom question's
// GUID). A plain string on purpose: tsx would wrap named helpers in a function the page does not have.
const READ_ELEMENTS = `((ids) => ids.map((id) => {
  const el = document.getElementById(id) || document.querySelector('[name="standardFields.' + id + '.answer"]');
  const boxes = Array.from(document.querySelectorAll('input[type=checkbox][name^="standardFields.' + id + '.multipleAnswers"]'));
  if (!el && boxes.length) return { id, present: true, visible: true, tag: 'input', type: 'checkbox', checkboxes: true, options: boxes.map((b) => ((b.closest('label') || b.parentElement || b).textContent || '').replace(/\\s+/g, ' ').trim()) };
  if (!el) return { id, present: false };
  const visible = !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const radios = Array.from(document.querySelectorAll('input[type=radio][name="standardFields.' + id + '.answer"]'));
  const options = el.tagName === 'SELECT' ? Array.from(el.options).map((o) => (o.textContent || '').trim()).filter((t) => t && !/^select an option$/i.test(t)) : radios.map((r) => ((r.closest('label') || r.parentElement || r).textContent || '').trim());
  return { id, present: true, visible, tag: el.tagName.toLowerCase(), type: (el.getAttribute('type') || '').toLowerCase(), radio: radios.length > 0, options };
}))`;

export type PageElement = { id: string; present: boolean; visible?: boolean; tag?: string; type?: string; radio?: boolean; checkboxes?: boolean; options?: string[] };

/**
 * The form's fields from Keka's own description of it, Keka's field type deciding the kind (1 Nov: the types of 406
 * forms, one per company: 1 text, 2 long text, 3 list, 4 tick boxes, 5 one choice, 6 date, 7 resume, 8 documents,
 * 9 number, 10 link). `elements` is what the page shows for each field, in the same order; without it (the offline
 * check, scripts/keka-forms-check.ts) every field counts as shown. `company` is the portal's subdomain.
 */
export function fieldsFromSchema(schema: SchemaField[], elements: Array<PageElement | undefined> | null, company: string): FormField[] {
  const fields: FormField[] = [];
  schema.forEach((field, index) => {
    const id = field.identifier;
    const element: PageElement = elements ? (elements[index] ?? { id, present: false }) : { id, present: true };
    const label = field.fieldName || id;
    const required = field.required;
    if (UNSUPPORTED.has(id) || (field.fieldType === FILES && id !== "resume")) {
      if (required) throw new NoRetryError(`This form has a required question the agent cannot answer yet: ${label.slice(0, 90)}`);
      return;
    }
    if (SKIP_UNLESS_REQUIRED.has(id) && !required) return;
    if (SECTIONS[id]) {
      for (const row of SECTIONS[id].fields) fields.push({ selector: byId(row.id), label: row.label, type: row.type, required: required && row.key === true });
      return;
    }
    if (id === "skills") {
      fields.push({ selector: byId("skills"), label, type: "skills", required });
      return;
    }
    if (id === "resume" || field.fieldType === FILE) {
      fields.push({ selector: "#resume-upload", label, type: "file", required, hintKey: "resume" });
      return;
    }
    if (!element.present) {
      if (required) throw new NoRetryError(`The Keka form asks "${label.slice(0, 80)}" but it is not on the page`);
      return;
    }
    const selector = id === "phone" ? byId("mobilePhone.number") : byId(id);
    const hintKey = HINTS[id];
    const options = element.options?.length ? element.options : field.fieldOptions.map((option) => option.value);
    if (id === "phone") fields.push({ selector, label, type: "phone", required, hintKey });
    else if (id === "workExperience") fields.push({ selector, label: "Years of experience", type: "experience", required, hintKey });
    else if (id === "currentSalary" || id === "expectedSalary") fields.push({ selector, label, type: "salary", required, hintKey });
    // Each company lists its own offices under the same label: the answer is kept per company, or one company's
    // office is offered to the next (1 Nov: Olyv's "IndiQube Gamma" twice refused by Aiden AI).
    else if (id === "locationPreference") fields.push({ selector, label: `${label} (${company})`, type: "select", required, options });
    else if (element.radio || field.fieldType === RADIO) fields.push({ selector: `input[type=radio][name="standardFields.${id}.answer"]`, label, type: "radio", required, options, hintKey });
    else if (element.checkboxes || field.fieldType === CHECKBOXES) fields.push({ selector: `input[type=checkbox][name^="standardFields.${id}.multipleAnswers"]`, label, type: "checkbox-group", required, options, hintKey });
    else if (element.tag === "select" || field.fieldType === SELECT) fields.push({ selector, label, type: "select", required, options, hintKey });
    else if (element.tag === "textarea" || field.fieldType === LONG_TEXT) fields.push({ selector, label, type: "textarea", required, hintKey });
    else if (field.fieldType === DATE) fields.push({ selector, label, type: "date", required, hintKey });
    else if (field.fieldType === LINK) fields.push({ selector, label, type: "url", required, hintKey });
    else if (field.fieldType === NUMBER || element.type === "number") fields.push({ selector, label, type: "number", required, hintKey });
    else fields.push({ selector, label, type: "text", required, hintKey });
  });
  return fields;
}

async function readFields(page: Page): Promise<FormField[]> {
  await page
    .locator("#jobApplicationForm")
    .waitFor({ timeout: 25000 })
    .catch(async (error) => {
      await assertJobOpen(page);
      throw error;
    });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
  const schema = await readSchema(page);
  const ids = schema.map((field) => (field.identifier === "phone" ? "mobilePhone.number" : field.identifier));
  const elements = (await page.evaluate(`${READ_ELEMENTS}(${JSON.stringify(ids)})`)) as PageElement[];
  const fields: FormField[] = [];
  // Rows of a required work-history or education section, added on the page before the fields are read.
  for (const field of schema) {
    const section = SECTIONS[field.identifier];
    if (!section || !field.required) continue;
    if (!(await sectionRow(page, section))) throw new NoRetryError(`The Keka form asks "${field.fieldName.slice(0, 80)}" but its first row did not open`);
  }
  fields.push(...fieldsFromSchema(schema, elements, new URL(page.url()).hostname.split(".")[0]));
  const captcha = page.locator("#captcha");

  


if (await captcha.count()) {
  const visible = await captcha.isVisible();

  console.log("[Keka] CAPTCHA input:", {
    detected: true,
    visible,
  });
}
  // The privacy consent: Apply stays disabled until it is ticked. A privacy-notice acknowledgement (acknowledgement.ts):
  // ticked only under the user's standing permission, asked otherwise.
  const consent = page.locator("#candidateConsent");
  if (await consent.count()) {
    // Its own sentence only: the nearest container whose text says something, before it grows into the whole form (a
    // first dry run read the page from "Back to all job openings" on, and the mapper took the box for a salary field).
    const text = await consent.evaluate((box) => {
      for (let node: Element | null = box.parentElement; node; node = node.parentElement) {
        const words = (node.textContent ?? "").replace(/\s+/g, " ").trim();
        if (words.length > 600) break;
        if (/consent|privacy|terms|agree|accept/i.test(words)) return words;
      }
      return "";
    });
    fields.push({ selector: "#candidateConsent", label: text || "I accept the data processing terms under the Privacy Policy", type: "checkbox", required: true });
  }

  return fields;
}


/** Through the page's own uploader: it parses the resume and fills the hidden `resume.*` inputs the submit sends. */
async function attachFile(page: Page, value: ResolvedValue, bytes: Uint8Array) {
  const name = value.fileName ?? "resume.pdf";
  const dir = await mkdtemp(join(tmpdir(), "swipeapply-"));
  const cleanup = async () => {
    await rm(dir, { recursive: true, force: true });
  };
  try {
    const file = join(dir, name);
    await writeFile(file, bytes);
    await page.locator("#resume-upload").setInputFiles(file);
    await page.waitForFunction(() => Boolean((document.querySelector('input[name="resume.location"]') as HTMLInputElement | null)?.value), undefined, { timeout: 60000 });
    // The parser may write what it read into the form; the fill comes after, so our values win.
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => undefined);
    return cleanup;
  } catch (error) {
    await cleanup();
    throw new Error(`Resume upload failed: ${error instanceof Error ? error.message.split("\n")[0] : "no confirmation"}`);
  }
}

/** "+91 98765 43210" → country code and number; a bare 10-digit number is Indian (Keka is an Indian suite). */
export function splitPhone(value: string, codes: string[]) {
  const digits = value.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) {
    // The longest code on the list the number starts with ("+1-684" before "+1").
    const known = codes.map((code) => ({ code, plain: code.replace(/[^\d]/g, "") })).filter((item) => item.plain && digits.slice(1).startsWith(item.plain)).sort((a, b) => b.plain.length - a.plain.length)[0];
    if (known) return { code: known.code, number: digits.slice(1 + known.plain.length) };
    return { code: null, number: digits.slice(1) };
  }
  const local = digits.replace(/^0+/, "");
  if (local.length === 12 && local.startsWith("91")) return { code: "+91", number: local.slice(2) };
  return { code: local.length === 10 ? "+91" : null, number: local };
}

/** Pay as Keka wants it, a whole amount: a figure of up to 1,000 is lakhs a year, as our onboarding saves it ("12" → 1200000). */
export function salaryAmount(value: string) {
  const match = value.replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*(lpa|lakhs?|lacs?|l\b|cr|crores?)?/i);
  if (!match) return null;
  const n = Number(match[1]);
  const unit = (match[2] ?? "").toLowerCase();
  if (unit.startsWith("cr")) return String(Math.round(n * 1e7));
  if (unit || n <= 1000) return String(Math.round(n * 1e5));
  return String(Math.round(n));
}

async function selectByLabel(page: Page, selector: string, wanted: string) {
  const select = page.locator(selector).first();
  const labels = (await select.locator("option").allInnerTexts()).map((text) => text.trim());
  const target = norm(wanted);
  const index = labels.findIndex((label) => norm(label) === target) >= 0 ? labels.findIndex((label) => norm(label) === target) : labels.findIndex((label) => norm(label).startsWith(target));
  if (index < 0) throw new Error(`No option "${wanted}"`);
  await select.selectOption({ index });
  return labels[index];
}

/**
 * Keka's date fields are read-only jQuery UI pickers (Date of Birth "dd-mm-yy", the history rows "MM yy"), so typing
 * does nothing: the date is read in the picker's own format, else as 2003-05-14 or 14/05/2003, and set through the
 * picker, which writes the text the form sends and runs the page's own checks (the minimum age). Null when unreadable.
 */
async function setPicker(target: Locator, text: string): Promise<string | null> {
  return target.evaluate((el, wanted) => {
    const input = el as HTMLInputElement;
    const $ = (window as unknown as { jQuery?: JQueryLike }).jQuery;
    if (!$ || !input.classList.contains("hasDatepicker")) {
      input.value = wanted;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return wanted;
    }
    let date: Date | null = null;
    try {
      date = $.datepicker.parseDate($(input).datepicker("option", "dateFormat") as string, wanted);
    } catch {
      date = null;
    }
    const iso = wanted.match(/^(\d{4})-(\d{2})-(\d{2})/);
    const dmy = wanted.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
    if (!date && iso) date = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    if (!date && dmy) date = new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
    if (!date) return null;
    $(input).datepicker("setDate", date);
    $(input).trigger("change");
    return input.value || null;
  }, text);
}
type JQueryLike = ((el: Element) => { datepicker: (...args: unknown[]) => unknown; trigger: (event: string) => void }) & { datepicker: { parseDate: (format: string, text: string) => Date | null } };

async function fillValue(page: Page, value: ResolvedValue): Promise<string | null> {
  const target = page.locator(value.selector).first();
  switch (value.type) {
    case "phone": {
      const codes = (await page.locator(byId("mobilePhone.countryCode")).locator("option").allInnerTexts()).map((text) => text.trim()).filter(Boolean);
      const { code, number } = splitPhone(value.value, codes);
      if (code) await page.locator(byId("mobilePhone.countryCode")).selectOption({ label: code }).catch(() => undefined);
      await target.fill(number);
      return code ? `${code} ${number}` : number;
    }
    case "experience": {
      const years = Number(value.value.match(/\d+(?:\.\d+)?/)?.[0] ?? NaN);
      if (Number.isNaN(years)) return null;
      const whole = Math.floor(years);
      const months = Math.min(11, Math.round((years - whole) * 12));
      await target.fill(String(whole));
      await page.locator('select[name="workExperience.months"]').selectOption(String(months)).catch(() => undefined);
      return `${whole} years ${months} months`;
    }
    case "salary": {
      const amount = salaryAmount(value.value);
      if (!amount) return null;
      const prefix = value.selector.includes("currentSalary") ? "currentSalary" : "expectedSalary";
      await page.locator(byId(`${prefix}.currency`)).evaluate((el, code) => {
        if (el instanceof HTMLSelectElement) {
          el.value = code;
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }, "INR").catch(() => undefined);
      await target.fill(amount);
      return `INR ${amount}`;
    }
    case "select":
      return selectByLabel(page, value.selector, value.value);
    case "radio": {
      const labels = await page.locator(value.selector).evaluateAll((nodes) => nodes.map((node) => ((node.closest("label") ?? node.parentElement)?.textContent ?? "").replace(/\s+/g, " ").trim()));
      const index = labels.findIndex((label) => norm(label) === norm(value.value));
      if (index < 0) throw new Error(`No option "${value.value}"`);
      await page.locator(value.selector).nth(index).check({ force: true });
      return labels[index];
    }
    case "checkbox-group": {
      const boxes = page.locator(value.selector);
      const labels = await boxes.evaluateAll((nodes) => nodes.map((node) => ((node.closest("label") ?? node.parentElement)?.textContent ?? "").replace(/\s+/g, " ").trim()));
      const picked: string[] = [];
      for (const want of splitChoices(value.value)) {
        const index = labels.findIndex((label) => norm(label) === norm(want));
        if (index < 0) throw new Error(`No option "${want}"`);
        await boxes.nth(index).check({ force: true });
        picked.push(labels[index]);
      }
      return joinChoices(picked);
    }
    case "skills": {
      // A tag input: Enter turns what was typed into a tag (a hidden `skills[n].name`). One per line from the resume,
      // or comma-separated as a person types them in the needs-you sheet.
      const added: string[] = [];
      for (const skill of value.value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean)) {
        await target.fill(skill);
        await target.press("Enter");
        added.push(skill);
      }
      const tags = await page.locator('#skills-container input[type=hidden][name^="skills["]').count();
      if (tags < added.length) throw new Error(`Only ${tags} of ${added.length} skills were added`);
      return added.join(", ");
    }
    case "url": {
      // Keka refuses "linkedin.com/in/x" without a scheme; a value that is no address at all is not filled.
      const text = value.value.trim();
      if (/\s/.test(text) || !/\.[a-z]{2,}/i.test(text)) throw new Error(`"${text.slice(0, 40)}" is not a link`);
      const link = /^(https?|ftp):\/\//i.test(text) || /^www\./i.test(text) ? text : `https://${text}`;
      await target.fill(link);
      await target.dispatchEvent("change");
      return link;
    }
    case "month-year":
      // Keka's month pickers show "June 2014"; anything else is not a month the resume gave.
      if (!/^[A-Z][a-z]+ \d{4}$/.test(value.value.trim())) return null;
      return setPicker(target, value.value.trim());
    case "date":
      return setPicker(target, value.value.trim());
    case "checkbox":
      if (/^(yes|true|checked|agree|i agree|1)$/i.test(value.value.trim())) await target.check({ force: true });
      else await target.uncheck({ force: true });
      return value.value;
    default:
      await target.fill(value.value);
      return value.value;
  }
}

const SUCCESS_URL = /\/careers\/success\//i;
const ERROR_URL = /\/careers\/error\b/i;

/** Keka's own success state: its success page after Apply. */
async function successShown(page: Page) {
  if (SUCCESS_URL.test(page.url())) return `Keka's success page (${new URL(page.url()).pathname.replace(/\d+/g, "<id>")})`;
  const text = await page.locator("body").innerText().catch(() => "");
  const match = text.match(/(application (has been )?(submitted|received)|thank you for applying|successfully applied)/i);
  return match ? `text "${match[0]}"` : null;
}


async function captureKekaCaptcha(page: Page): Promise<Buffer> {
  const captchaImage = page.locator("#imgCaptcha");
  await captchaImage.waitFor({ state: "visible", timeout: 10000 });
  // A new image after "Invalid captcha" (Keka clicks its own refresh): read it once it has loaded.
  await captchaImage.evaluate((img) => (img as HTMLImageElement).complete || new Promise((done) => img.addEventListener("load", done, { once: true }))).catch(() => undefined);
  return captchaImage.screenshot({ type: "png" });
}

/**
 * Keka's own messages on the form that mean Apply Now sent nothing (read from app.min.js, 2 Nov): the red box at the top
 * (`#validation-text`, its duplicate check, e.g. this email or phone already applied), the resume's messages at the top,
 * and the per-field ones of its jQuery validation ("Email already exists", "This field is required.", a link it
 * refuses). Before 2 Nov none was read: the run waited 15 minutes, then the window was closed and opened again
 * (toddle, deccanaiauto, infra360). The CAPTCHA's own messages are handled apart (#invalidCaptcha, #noCaptcha).
 */
const FORM_ERRORS = "#validation-text, #resume-error, #resume-size-error, label.error, [id^='label-'], [id^='url-error-']";

/** The visible ones, as "Field: message". */
export async function formErrors(page: Page): Promise<string[]> {
  return page
    .locator(FORM_ERRORS)
    .evaluateAll((nodes) => {
      const lines: string[] = [];
      for (const node of nodes as HTMLElement[]) {
        const text = (node.innerText || "").replace(/\s+/g, " ").trim();
        if (!node.offsetParent || text.length < 3) continue;
        const target = node.getAttribute("for");
        const label = target ? document.querySelector(`label[for="${CSS.escape(target)}"]:not(.error)`) : node.closest(".form-group")?.querySelector("label:not(.error)");
        const field = (label?.textContent ?? "").replace(/\*/g, "").replace(/\s+/g, " ").trim();
        const line = (field && !text.toLowerCase().includes(field.toLowerCase()) ? `${field}: ${text}` : text).slice(0, 160);
        if (!lines.includes(line)) lines.push(line);
      }
      return lines.slice(0, 5);
    })
    .catch(() => []);
}

/** Keka's error page after Apply (`/careers/error?message=...`): its own message, else the page's text. */
async function refusal(page: Page) {
  const message = new URL(page.url()).searchParams.get("message")?.trim();
  const text = message || (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").trim();
  return text.slice(0, 200);
}

const APPLY_BUTTON = "#jobApplicationSubmitButton, button:has-text('Apply Now')";
const CAPTCHA_TRIES = 3;
/** How long a person has to fix what Keka showed before the run stops with it. */
const FIX_WAIT_MS = 2 * 60 * 1000;

export const HANDOFF_WAIT_MS = 15 * 60 * 1000;

export const kekaAdapter: AtsAdapter = {
  source: "keka",
  matches(url: string) {
    return /^https:\/\/[a-z0-9-]+\.keka\.com\/careers\//i.test(url);
  },
  formUrl,
  uploadFirst: true,
  uploadFile: attachFile,
  inspect(page: Page) {
    return readFields(page);
  },
  // The window is the person's from the moment it opens: Apply sends a POST to /careers/applyjob/{id}.
  watchSubmit(page: Page, onSubmit: () => void) {
    const context = page.context();
    let seen = false;
    const onRequest = (request: Request) => {
      if (seen || request.method() !== "POST" || !/\.keka\.com\/careers\/applyjob\/\d+/i.test(request.url())) return;
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
      const written = await inField(value.label, () => fillValue(page, value));
      if (written === null) continue;
      filled.push({ key: value.key, label: value.label, value: written, source: value.source, selector: value.selector });
    }
    return filled;
  },
  async submit(page, ctx): Promise<SubmitResult> {
    if (!ctx.handoff) throw new BotCheckError("Keka requires a person to enter the CAPTCHA. Nothing was sent.");
    await dismissOverlays(page);
    const captcha = page.locator("#captcha");
    try {
      await captcha.waitFor({ state: "visible", timeout: 10000 });
    } catch {
      throw new BotCheckError("Keka CAPTCHA input was not visible. Manual submission cannot continue.");
    }
    await page.locator(APPLY_BUTTON).first().waitFor({ state: "visible", timeout: 10000 });

    // The CAPTCHA read from its image (../captcha) and Apply Now pressed; after "Invalid captcha" Keka shows a new image,
    // which is read again, up to CAPTCHA_TRIES times, then the person types it.
    let tries = 0;
    const tryCaptcha = async (live: Page) => {
      tries += 1;
      const text = (await analyzeTestImage(await captureKekaCaptcha(live))).trim();
      // Hidden first, so a later "Invalid captcha" is this answer's.
      await live.locator("#invalidCaptcha, #noCaptcha").evaluateAll((nodes) => nodes.forEach((node) => ((node as HTMLElement).style.display = "none")));
      await live.locator("#captcha").fill(text);
      const button = live.locator(APPLY_BUTTON).first();
      await button.scrollIntoViewIfNeeded().catch(() => undefined);
      await button.click({ timeout: 10000 });
    };

    let applied = false;
    // Registered before Apply is pressed, so a quick submission is not missed.
    const stop = kekaAdapter.watchSubmit!(page, () => {
      applied = true;
    });
    let shown: string[] = [];
    let shownSince = 0;
    let shot: Buffer | undefined;
    let askedForCaptcha = false;
    try {
      await page.bringToFront();
      await tryCaptcha(page);
      await ctx.announceHandoff?.("The form is filled and Apply Now was pressed. If Keka asks for the CAPTCHA again, type it in the Chrome window and press Apply Now.");

      const deadline = Date.now() + HANDOFF_WAIT_MS;
      while (Date.now() < deadline) {
        if (await ctx.cancelled?.()) throw new WindowClosedError("Cancelled before Apply was pressed. Nothing was sent.");
        const live = livePage(page);
        if (!live) {
          // Closed while Keka showed why it sent nothing: that is the outcome, and opening the form again would show it again.
          if (shown.length) throw new RefusedError(`Keka did not send the application. It said: ${shown.join(" | ")}`, shot);
          throw new WindowClosedError("The Keka window was closed before Apply was pressed.");
        }
        const evidence = await successShown(live).catch(() => null);
        if (evidence) return { confirmed: true, evidence };
        if (ERROR_URL.test(live.url())) {
          const said = await refusal(live);
          throw new RefusedError(`Keka refused the application${said ? `: "${said}"` : ""}.`);
        }

        const captchaWrong = await live.locator("#invalidCaptcha, #noCaptcha").first().isVisible().catch(() => false);
        if (captchaWrong) {
          if (tries < CAPTCHA_TRIES) {
            await tryCaptcha(live).catch(() => undefined);
          } else if (!askedForCaptcha) {
            askedForCaptcha = true;
            await ctx.announceHandoff?.("Keka did not accept the CAPTCHA. Type the new one in the Chrome window and press Apply Now.");
          }
        }

        // Keka's own messages: recorded when they change, the person gets a short while to fix them in the window, then
        // the run stops with them as its reason.
        const errors = await formErrors(live);
        if (!errors.length) {
          shown = [];
          shownSince = 0;
        } else if (errors.join("|") !== shown.join("|")) {
          shown = errors;
          // The form as it showed them, for the application page if the window is closed before the run stops.
          shot = await live.screenshot({ type: "jpeg", quality: 72, fullPage: true, timeout: 10000 }).catch(() => shot);
          shownSince ||= Date.now();
          await ctx.announceHandoff?.(`Keka did not send the application. It said: ${errors.join(" | ")}. Fix it in the Chrome window and press Apply Now, or it stops in 2 minutes.`.slice(0, 500));
        }
        if (shown.length && Date.now() - shownSince > FIX_WAIT_MS) throw new RefusedError(`Keka did not send the application. It said: ${shown.join(" | ")}`, shot);

        await live.waitForTimeout(1500).catch(() => undefined);
      }
    } finally {
      stop();
    }
    if (!applied) throw new WindowClosedError("Apply Now was not pressed within 15 minutes. Nothing was sent.");
    throw new MaybeSentError("Apply Now was pressed, but Keka's success page was not detected. Check your email before retrying.");
  },
};
