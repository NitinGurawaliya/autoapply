import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page, Request } from "playwright";
import type { AtsAdapter, FilledField, FormField, ResolvedValue, SubmitResult } from "../adapter";
import { BotCheckError, MaybeSentError, NoRetryError, RefusedError, WindowClosedError } from "../adapter";
import { livePage } from "../browser";
import { assertJobOpen, dismissOverlays, inField } from "./common";

/**
 * Keka career portals (T96): `{company}.keka.com/careers/applyjob/{id}`. A plain server-rendered form with stable ids,
 * described by public JSON (`/careers/{id}/2/applicationform`: each field's identifier, type, required, options), so the
 * fields are read from that and found on the page by id. The resume goes in through the page's own uploader, which
 * parses it and fills the hidden `resume.*` inputs the submit needs.
 *
 * Every Keka form has an image CAPTCHA tied to the browser session (`/careers/Captcha`, checked on submit), so a person
 * types it and presses "Apply Now": Keka is a handoff board (lib/queue.ts), its form filled in a visible Chrome window
 * on a worker with a screen. The worker never presses Apply and never reads the CAPTCHA.
 */

// Keka's field types in the form JSON (read 31 Oct on Jupiter and Keka's own portal).
const TEXT = 1;
const SELECT = 3;
const DATE = 6;
const FILE = 7;
const FILES = 8;
const NUMBER = 9;

type SchemaField = { identifier: string; fieldName: string; fieldType: number; required: boolean; fieldOptions: Array<{ value: string }> };

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
// Repeating sections and tag inputs the agent cannot fill: a form that requires one stops before anything is filled.
const UNSUPPORTED = new Set(["additionalDocuments", "skills", "experienceDetails", "educationDetails"]);

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
  if (!el) return { id, present: false };
  const visible = !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const radios = Array.from(document.querySelectorAll('input[type=radio][name="standardFields.' + id + '.answer"]'));
  const options = el.tagName === 'SELECT' ? Array.from(el.options).map((o) => (o.textContent || '').trim()).filter((t) => t && !/^select an option$/i.test(t)) : radios.map((r) => ((r.closest('label') || r.parentElement || r).textContent || '').trim());
  return { id, present: true, visible, tag: el.tagName.toLowerCase(), type: (el.getAttribute('type') || '').toLowerCase(), radio: radios.length > 0, options };
}))`;

type PageElement = { id: string; present: boolean; visible?: boolean; tag?: string; type?: string; radio?: boolean; options?: string[] };

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
  schema.forEach((field, index) => {
    const id = field.identifier;
    const element = elements[index];
    const label = field.fieldName || id;
    if (UNSUPPORTED.has(id) || (field.fieldType === FILES && id !== "resume")) {
      if (field.required) throw new NoRetryError(`This form has a required question the agent cannot answer yet: ${label.slice(0, 90)}`);
      return;
    }
    if (SKIP_UNLESS_REQUIRED.has(id) && !field.required) return;
    if (id === "resume" || field.fieldType === FILE) {
      fields.push({ selector: "#resume-upload", label, type: "file", required: field.required, hintKey: "resume" });
      return;
    }
    if (!element?.present) {
      if (field.required) throw new NoRetryError(`The Keka form asks "${label.slice(0, 80)}" but it is not on the page`);
      return;
    }
    const selector = id === "phone" ? byId("mobilePhone.number") : byId(id);
    const hintKey = HINTS[id];
    if (id === "phone") fields.push({ selector, label, type: "phone", required: field.required, hintKey });
    else if (id === "workExperience") fields.push({ selector, label: "Years of experience", type: "experience", required: field.required, hintKey });
    else if (id === "currentSalary" || id === "expectedSalary") fields.push({ selector, label, type: "salary", required: field.required, hintKey });
    else if (element.radio) fields.push({ selector: `input[type=radio][name="standardFields.${id}.answer"]`, label, type: "radio", required: field.required, options: element.options, hintKey });
    else if (element.tag === "select" || field.fieldType === SELECT) {
      const options = element.options?.length ? element.options : field.fieldOptions.map((option) => option.value);
      fields.push({ selector, label, type: "select", required: field.required, options, hintKey });
    } else if (element.tag === "textarea") fields.push({ selector, label, type: "textarea", required: field.required, hintKey });
    else if (field.fieldType === DATE) fields.push({ selector, label, type: "date", required: field.required, hintKey });
    else if (field.fieldType === NUMBER || element.type === "number") fields.push({ selector, label, type: "number", required: field.required, hintKey });
    else fields.push({ selector, label, type: "text", required: field.required, hintKey });
  });
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
    case "checkbox":
      if (/^(yes|true|checked|agree|i agree|1)$/i.test(value.value.trim())) await target.check({ force: true });
      else await target.uncheck({ force: true });
      return value.value;
    case "date":
      // A date picker: typed, then closed so it keeps the value.
      await target.fill(value.value);
      await page.keyboard.press("Escape").catch(() => undefined);
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
    // Only a person can answer Keka's CAPTCHA: never pressed by the worker, never on a worker with no screen.
    if (!ctx.handoff) throw new BotCheckError("Keka's form has a CAPTCHA that a person types. Nothing was sent.");
    await dismissOverlays(page);
    const button = page.locator("button:has-text('Apply Now')").first();
    await button.scrollIntoViewIfNeeded().catch(() => undefined);
    await page.locator("#captcha").scrollIntoViewIfNeeded().catch(() => undefined);
    await page.bringToFront().catch(() => undefined);
    await ctx.announceHandoff?.("Ready to send: type the CAPTCHA shown on the Keka form and press Apply Now in the Chrome window on your computer");
    const deadline = Date.now() + HANDOFF_WAIT_MS;
    let invalidSeen = false;
    // Whether Apply was pressed at all (its POST left the window): decides what a timeout means.
    let applied = false;
    const stop = kekaAdapter.watchSubmit!(page, () => {
      applied = true;
    });
    try {
    while (Date.now() < deadline) {
      if (await ctx.cancelled?.()) throw new WindowClosedError("Cancelled by you before Apply was pressed. Nothing was sent.");
      const live = livePage(page);
      if (!live) throw new WindowClosedError("The Keka window was closed before Apply was pressed. Nothing was sent.");
      const evidence = await successShown(live).catch(() => null);
      if (evidence) return { confirmed: true, evidence };
      if (ERROR_URL.test(live.url())) {
        const text = (await live.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 160);
        throw new RefusedError(`Keka refused the application${text ? ` ("${text}")` : ""}. Nothing was sent.`);
      }
      // A wrong CAPTCHA keeps the form as it is: the person types the new one and presses Apply again.
      const invalid = /invalid captcha/i.test(await live.locator("body").innerText().catch(() => ""));
      if (invalid && !invalidSeen) {
        invalidSeen = true;
        await ctx.announceHandoff?.("Keka said the CAPTCHA was wrong: type the new one and press Apply Now again");
      }
      if (!invalid) invalidSeen = false;
      await live.waitForTimeout(1500).catch(() => undefined);
    }
    } finally {
      stop();
    }
    if (!applied) throw new WindowClosedError("Apply Now was not pressed within 15 minutes. Nothing was sent; press Retry when you are ready.");
    throw new MaybeSentError("Apply Now was pressed but Keka's success page was not seen. Check your email before applying again.");
  },
};
