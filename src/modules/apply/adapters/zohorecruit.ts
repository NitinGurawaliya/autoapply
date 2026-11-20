import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page, Request, Response } from "playwright";
import { z } from "zod";
import type { AtsAdapter, FilledField, FormField, ResolvedValue, SubmitContext, SubmitResult } from "../adapter";
import { BotCheckError, MaybeSentError, NoRetryError, NotSentError, WindowClosedError } from "../adapter";
import { canShowWindow, livePage } from "../browser";
import { assertJobOpen, dismissOverlays, firstVisible, friendlyError, inField } from "./common";
import { numberText } from "./workable";

/**
 * Zoho Recruit (Phase M, M13). A job page (`{company}.zohorecruit.in/jobs/<Portal>/<jobId>/<title>`) opens the guest
 * form on the same page with "I'm interested". The form is public JSON
 * (`/recruit/v2/public/Job_Openings/<jobId>/apply/<webform_id>`, the id from the job page's settings), so its fields are
 * read from there, as Workable's are. Every field sits in a row `div.crc-rec-form_<id>`: text, email, phone, website and
 * numbers are an `input[name=rec-form_<id>]`, a picklist is a `lyte-dropdown#<id>` whose list is appended to the body
 * (`lyte-drop-body#<api_name>`), a yes/no is a `lyte-checkbox` around `input#rec-form_<id>`, and the resume is
 * `input[type=file][name=rec-form_<attachmentId>_file]`.
 *
 * Survey of 30 India portals (17 Nov): 20 forms carry an image CAPTCHA, 6 add an assessment page after the form, none
 * requires the education or experience tables. A CAPTCHA is typed by a person (a handoff, lib/queue.ts HANDOFF_BOARDS):
 * nothing here reads or solves it. A form without one is submitted by the worker. Either way the application leaves as a
 * POST to `/recruit/v2/public/Job_Openings/<jobId>/apply/<webform_id>`, and Zoho's answer to it decides the outcome.
 */

const APPLY_POST = /\/recruit\/v2\/public\/Job_Openings\/\d+\/apply\/\d+(?:[?#]|$)/;
const CAPTCHA_INPUT = 'input[placeholder="Type below image text"]';
const INTERESTED = ["button:has-text(\"I'm interested\")", "text=\"I'm interested\"", "button:has-text('Apply')"];

const idSchema = z.union([z.string(), z.number()]).transform(String);
const fieldSchema = z.object({
  api_name: z.string(),
  field_label: z.string(),
  data_type: z.string(),
  required: z.boolean().nullish(),
  id: idSchema,
  pick_list_values: z.array(z.object({ display_value: z.string() })).nullish(),
});
const attachmentSchema = z.object({ id: idSchema, api_name: z.string().nullish(), field_label: z.string().nullish(), required: z.boolean().nullish() });
const formSchema = z.object({
  meta: z.object({ assessment_id: z.unknown().nullish() }).passthrough().nullish(),
  webforms: z
    .array(z.object({ sections: z.array(z.object({ display_label: z.string().nullish(), fields: z.array(z.unknown()).nullish(), attachmenttypes: z.array(z.unknown()).nullish() })) }))
    .min(1),
});

// The fixed fields, by the api_name Zoho gives them: the answer key each is.
const HINTS: Record<string, string> = { First_Name: "first_name", Last_Name: "last_name", Email: "email", Mobile: "phone", Phone: "phone", City: "city" };
const TEXT_TYPES = new Set(["text", "email", "website", "phone"]);
const NUMBER_TYPES = new Set(["double", "integer", "currency", "decimal", "bigint", "percent"]);

export type ZohoForm = { fields: FormField[]; captcha: boolean; assessment: boolean };

const row = (id: string) => `.crc-rec-form_${id}`;
const idOf = (selector: string) => selector.match(/crc-rec-form_(\d+)|rec-form_(\d+)_file/)?.slice(1).find(Boolean) ?? "";

/** Zoho's form JSON → the FormField shape the runner resolves (selectors on the rendered form). */
export function fromZoho(body: unknown): ZohoForm {
  const parsed = formSchema.parse(body);
  const fields: FormField[] = [];
  let captcha = false;
  for (const section of parsed.webforms[0].sections) {
    const items = (section.fields ?? []).map((item) => fieldSchema.safeParse(item)).flatMap((result) => (result.success ? [result.data] : []));
    // The education and experience tables (a `tabular` field and the columns after it): rows are added by hand on the
    // page. Never required on the 30 forms read; a required one stops the run rather than leaving it for Zoho to refuse.
    if (items.some((field) => field.data_type === "tabular")) {
      const required = items.find((field) => field.required);
      if (required) throw new NoRetryError(`This Zoho Recruit form requires "${section.display_label ?? required.field_label}" entries, which the agent cannot fill yet. Apply on the company's site.`);
      continue;
    }
    for (const field of items) {
      const label = field.field_label.replace(/\s+/g, " ").trim();
      const required = field.required === true;
      const hintKey = HINTS[field.api_name];
      const type = field.data_type;
      if (type === "captcha") {
        captcha = true;
        continue;
      }
      if (TEXT_TYPES.has(type)) fields.push({ selector: row(field.id), label, type: "text", required, hintKey });
      else if (NUMBER_TYPES.has(type)) fields.push({ selector: row(field.id), label, type: "number", required });
      else if (type === "textarea") fields.push({ selector: row(field.id), label, type: "textarea", required });
      else if (type === "boolean") fields.push({ selector: row(field.id), label, type: "checkbox", required });
      else if (type === "picklist") {
        const options = (field.pick_list_values ?? []).map((option) => option.display_value.replace(/\s+/g, " ").trim()).filter((option) => option && option !== "-None-");
        fields.push({ selector: row(field.id), label, type: "select", required, options });
      } else if (required) {
        // A multi-select, date, lookup or anything else not seen on the 30 forms read: asked of no one, never guessed.
        throw new NoRetryError(`This Zoho Recruit form requires "${label}" (${type}), which the agent cannot fill yet. Apply on the company's site.`);
      }
    }
    for (const item of section.attachmenttypes ?? []) {
      const parsedAttachment = attachmentSchema.safeParse(item);
      if (!parsedAttachment.success) continue;
      const attachment = parsedAttachment.data;
      const label = (attachment.field_label ?? attachment.api_name ?? "Attachment").trim();
      const selector = `input[type=file][name="rec-form_${attachment.id}_file"]`;
      if (attachment.api_name === "RESUME" || /resume|\bcv\b/i.test(label)) fields.push({ selector, label, type: "file", required: attachment.required === true, hintKey: "resume" });
      // Any other file a form asks for: asked, never guessed (the runner has no file but the resume).
      else if (attachment.required) fields.push({ selector, label, type: "file", required: true });
    }
  }
  return { fields, captcha, assessment: Boolean(parsed.meta?.assessment_id) };
}

/** Zoho's cookie banner is a plain element, not a button: its non-essential cookies are declined. */
async function declineCookies(page: Page) {
  const decline = page.getByText("Decline non-essential", { exact: true }).first();
  if (await decline.isVisible().catch(() => false)) {
    await decline.click({ timeout: 3000 }).catch(() => undefined);
    await page.waitForTimeout(300);
  }
  await dismissOverlays(page);
}

// What each open page's form carries, for submit (a CAPTCHA means a person types it).
const formsSeen = new WeakMap<Page, ZohoForm>();

async function readFields(page: Page): Promise<FormField[]> {
  await declineCookies(page);
  if ((await page.locator('[class*="crc-rec-form_"]').count()) === 0) {
    const interested = await firstVisible(page, INTERESTED, 30000);
    if (!interested) {
      await assertJobOpen(page);
      throw new Error("The Zoho Recruit job page has no \"I'm interested\" button");
    }
    await interested.click();
    await page.locator('[class*="crc-rec-form_"]').first().waitFor({ timeout: 30000 });
  }
  const body = await page.evaluate(async () => {
    const html = document.documentElement.innerHTML;
    const webform = html.match(/webform_id(?:\\?"|&quot;|&#34;)\s*:\s*(?:\\?"|&quot;|&#34;)(\d+)/)?.[1];
    const [, , portal, jobId] = location.pathname.split("/");
    if (!webform || !jobId) return null;
    const response = await fetch(`/recruit/v2/public/Job_Openings/${jobId}/apply/${webform}?pagename=${encodeURIComponent(portal ?? "Careers")}&source=CareerSite`, { headers: { Accept: "application/json" } });
    return response.ok ? response.json() : null;
  });
  if (!body) throw new Error("Zoho Recruit did not return this job's form");
  const form = fromZoho(body);
  if (form.assessment) throw new NoRetryError("This Zoho Recruit job continues to an assessment after the form, which the agent cannot fill yet. Apply on the company's site.");
  // Only what the page really shows. A required field the page does not show is a selector the form outgrew: the run
  // stops here rather than leaving it empty for Zoho to refuse.
  const shown: FormField[] = [];
  const missing: string[] = [];
  for (const field of form.fields) {
    if ((await page.locator(field.selector).count()) > 0) shown.push(field);
    else if (field.required) missing.push(field.label);
  }
  if (missing.length > 0) throw new Error(`The Zoho Recruit form's required fields were not found on the page: ${missing.slice(0, 5).join(", ")}`);
  formsSeen.set(page, { ...form, captcha: form.captcha || (await page.locator(CAPTCHA_INPUT).count()) > 0 });
  return shown;
}

const norm = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();

function pickIndex(options: string[], wanted: string) {
  const target = norm(wanted).replace(/\.$/, "");
  const list = options.map((option) => norm(option).replace(/\.$/, ""));
  const exact = list.indexOf(target);
  if (exact >= 0) return exact;
  const starts = list.findIndex((option) => option.startsWith(target));
  return starts >= 0 ? starts : list.findIndex((option) => option.includes(target));
}

/** The phone box sits beside a dial-code picker already on India (+91): the national number only. */
function nationalNumber(value: string) {
  const digits = value.replace(/[^\d+]/g, "");
  return digits.replace(/^\+?91(?=\d{10}$)/, "").replace(/^0(?=\d{10}$)/, "");
}

/** A typed value must still be in the box after typing; an empty box here would only show up as Zoho's refusal. */
async function readBack(input: ReturnType<Page["locator"]>, expected: string) {
  const now = ((await input.inputValue().catch(() => "")) ?? "").trim();
  const digits = (text: string) => text.replace(/\D/g, "");
  const short = expected.trim().length <= 60;
  if (!now || (short && digits(expected).length > 0 && digits(now) !== digits(expected) && now !== expected.trim())) throw new Error(`the box kept "${now.slice(0, 30)}" instead of the answer`);
}

const centre = (locator: ReturnType<Page["locator"]>) => locator.evaluate((element) => element.scrollIntoView({ block: "center" })).catch(() => undefined);

/**
 * A picklist: the dropdown's `role=combobox` opens a list appended to the body (`lyte-drop-body#<api_name>`, named by
 * the combobox's aria-controls) of `lyte-drop-item`s; the pick shows in the dropdown's `lyte-drop-button`. A click that
 * misses falls back to a DOM click on the item, as on Workable.
 */
async function fillPicklist(page: Page, value: ResolvedValue) {
  const id = idOf(value.selector);
  const dropdown = page.locator(`lyte-dropdown[id="${id}"]`).first();
  const trigger = dropdown.locator('[role="combobox"]').first();
  const shown = async () => ((await dropdown.locator("lyte-drop-button").first().innerText().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await centre(trigger);
    if ((await trigger.getAttribute("aria-expanded")) !== "true") await trigger.click({ timeout: 5000 });
    const controls = await trigger.getAttribute("aria-controls");
    const items = page.locator(controls ? `lyte-drop-body[id="${controls}"] lyte-drop-item` : "lyte-drop-box lyte-drop-item");
    await items.first().waitFor({ state: "attached", timeout: 5000 });
    const texts = (await items.allInnerTexts()).map((text) => text.replace(/\s+/g, " ").trim());
    const index = pickIndex(texts, value.value);
    if (index < 0 || texts[index] === "-None-") {
      await page.keyboard.press("Escape").catch(() => undefined);
      throw new Error(`No option "${value.value}" for "${value.label}" (the list shows: ${texts.filter((text) => text !== "-None-").slice(0, 6).join(" | ")})`);
    }
    if (attempt < 2) await items.nth(index).click({ timeout: 5000 }).catch(() => undefined);
    else await items.nth(index).evaluate((element) => (element as HTMLElement).click()).catch(() => undefined);
    await page.waitForTimeout(300);
    if ((await trigger.getAttribute("aria-expanded")) === "true") await page.keyboard.press("Escape").catch(() => undefined);
    if (norm(await shown()) === norm(texts[index])) return texts[index];
  }
  throw new Error(`the box kept "${(await shown()).slice(0, 30)}" instead of the answer`);
}

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A text-like field, in the three shapes Zoho draws (17 Nov): an `input|textarea[name=rec-form_<id>]`; the skills box
 * (`rec-skills-component`, one tag per skill, each added with Enter); or a box with suggestions (`lyte-autocomplete`,
 * City and State, no name), typed key by key so its search runs, and its suggestion taken when one matches.
 */
async function fillTextLike(page: Page, value: ResolvedValue, text: string) {
  const id = idOf(value.selector);
  const named = page.locator(`[name="rec-form_${id}"]`).first();
  if ((await named.count()) > 0) {
    await centre(named);
    await named.fill("");
    await named.fill(text);
    await readBack(named, text);
    return text;
  }
  const holder = page.locator(row(id)).first();
  const skills = holder.locator("rec-skills-component input").first();
  if ((await skills.count()) > 0) {
    // Typed key by key: the box adds a tag (`li.skl-selected-skill-li`) on Enter only after real key input (17 Nov: an
    // instant fill left it empty). It matches against Zoho's skills list: "Python" is kept, a sentence is not, so an
    // optional box that keeps nothing is left empty and only a required one stops the run.
    const items = text.split(/\s*[,;\n]\s*/).map((item) => item.trim()).filter((item) => item && item.length <= 40).slice(0, 15);
    await centre(skills);
    for (const item of items) {
      await skills.click();
      await skills.pressSequentially(item, { delay: 20 });
      await skills.press("Enter");
      await page.waitForTimeout(250);
    }
    const kept = (await holder.locator("li.skl-selected-skill-li").allInnerTexts()).map((tag) => tag.trim()).filter(Boolean);
    if (kept.length === 0 && value.required) throw new Error("the skills box did not keep the skills");
    return kept.join(", ");
  }
  const box = holder.locator('input[type="text"]:not([readonly]), textarea').first();
  if ((await box.count()) === 0) throw new Error("no box to type into on this row");
  await centre(box);
  await box.fill("");
  await box.pressSequentially(text, { delay: 30 });
  await page.waitForTimeout(900);
  const suggestion = page.locator('lyte-drop-box lyte-drop-item:visible, [role="listbox"] [role="option"]:visible').filter({ hasText: new RegExp(`^\\s*${escapeRegex(text)}`, "i") }).first();
  if (await suggestion.isVisible().catch(() => false)) await suggestion.click({ timeout: 3000 }).catch(() => undefined);
  else await box.press("Tab").catch(() => undefined);
  await readBack(box, text);
  return ((await box.inputValue().catch(() => text)) ?? text).trim() || text;
}

/** A yes/no: the `lyte-checkbox` label is clicked until the box says what the answer says. */
async function fillCheckbox(page: Page, value: ResolvedValue) {
  const id = idOf(value.selector);
  const want = /^(yes|true|y|1|agree|i agree|accept|accepted|checked)$/i.test(value.value.trim());
  // The id sits on the input in one form and only on the component in another: the row's one checkbox either way.
  const box = page.locator(`${row(id)} input[type=checkbox]`).first();
  const label = page.locator(`${row(id)} lyte-checkbox label`).first();
  for (let attempt = 0; attempt < 2 && (await box.isChecked()) !== want; attempt += 1) {
    await centre(label);
    await label.click({ timeout: 5000 }).catch(() => box.evaluate((element) => (element as HTMLInputElement).click()));
    await page.waitForTimeout(200);
  }
  if ((await box.isChecked()) !== want) throw new Error(`the box stayed ${want ? "unticked" : "ticked"}`);
  return want ? "Yes" : "No";
}

/** Attach the resume to the form's own file field and wait for its name to show in that row (Zoho uploads it at once). */
async function attachFile(page: Page, value: ResolvedValue, bytes: Uint8Array) {
  const name = value.fileName ?? "resume.pdf";
  const dir = await mkdtemp(join(tmpdir(), "swipeapply-"));
  const cleanup = async () => {
    await rm(dir, { recursive: true, force: true });
  };
  try {
    const file = join(dir, name);
    await writeFile(file, bytes);
    await page.locator(value.selector).first().setInputFiles(file);
    const holder = page.locator(row(idOf(value.selector))).first();
    await holder.filter({ hasText: name }).first().waitFor({ timeout: 60000 });
    // The upload is a request of its own (`/recruit/v2/public/Attachments`): a moment for it before anything else.
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
    return cleanup;
  } catch (error) {
    await cleanup();
    throw new Error(`Resume upload failed: ${error instanceof Error ? error.message.split("\n")[0] : "no confirmation"}`);
  }
}

export const CONFIRMATION = /thank you for (applying|your (application|interest))|application (has been |was )?(successfully )?(submitted|received)|successfully (applied|submitted)|you have (already|successfully) applied/i;

async function successShown(page: Page) {
  const body = await page.locator("body").innerText().catch(() => "");
  const match = body.match(CONFIRMATION);
  // The form's own words are never the answer: its Submit button must be gone.
  if (match && !(await page.locator('[class*="crc-rec-form_"]').first().isVisible().catch(() => false))) return `text "${match[0]}"`;
  return null;
}

/** The form's own error lines after a Submit that did not leave (a required field, a wrong CAPTCHA). */
async function formErrors(page: Page) {
  const texts = await page
    .locator('.crc-form-row [class*="error" i]:visible, .lyteErrorMessage:visible, [class*="errorMsg" i]:visible')
    .allInnerTexts()
    .catch(() => [] as string[]);
  return [...new Set(texts.map((text) => text.replace(/\s+/g, " ").trim()).filter(Boolean))].slice(0, 5);
}

export type ZohoReply = { kind: "sent" | "refused" | "unknown"; status: number; reason: string };

/**
 * Zoho's answer to the application's POST. Its API answers `{ data: [{ code, status, message }] }` or a top-level
 * `{ code, status, message }`: a 2xx without an error status is the application received; an error status or a 4xx is a
 * refusal with its words, unless they say the candidate already applied (the application on file: sent). Anything else
 * is unknown. Only the words are kept, never the body.
 */
export function readZohoReply(status: number, body: string): ZohoReply {
  let reason = "";
  let failed = false;
  try {
    const json = JSON.parse(body) as Record<string, unknown>;
    const first = (Array.isArray(json.data) ? (json.data[0] as Record<string, unknown> | undefined) : undefined) ?? json;
    const statusWord = String(first.status ?? json.status ?? "").toLowerCase();
    const code = String(first.code ?? json.code ?? "").toUpperCase();
    reason = String(first.message ?? json.message ?? "");
    failed = statusWord === "error" || (code !== "" && code !== "SUCCESS");
  } catch {
    reason = "";
  }
  reason = reason.replace(/\s+/g, " ").trim().slice(0, 160);
  if (/already (applied|submitted|exists)|duplicate (application|candidate)/i.test(reason)) return { kind: "sent", status, reason };
  if (status >= 200 && status < 300 && !failed) return { kind: "sent", status, reason };
  if ((status >= 400 && status < 500) || failed) return { kind: "refused", status, reason };
  return { kind: "unknown", status, reason };
}

const AUTO_WAIT_MS = 90000;
const PERSON_WAIT_MS = 15 * 60 * 1000;

async function submitZoho(page: Page, ctx: SubmitContext): Promise<SubmitResult> {
  await declineCookies(page);
  const button = await firstVisible(page, ["form button[type=submit]", "button[type=submit]"], 20000);
  if (!button) throw new NoRetryError("The Submit button never appeared on the Zoho Recruit form. Open the form and submit it yourself.");
  const captcha = formsSeen.get(page)?.captcha ?? (await page.locator(CAPTCHA_INPUT).count()) > 0;
  let posted = false;
  const stopWatching = zohoAdapter.watchSubmit!(page, () => {
    posted = true;
  });
  let reply: ZohoReply | null = null;
  const context = page.context();
  const onResponse = (response: Response) => {
    if (response.request().method() !== "POST" || !APPLY_POST.test(response.url())) return;
    void response
      .text()
      .catch(() => "")
      .then((body) => {
        reply = readZohoReply(response.status(), body);
      });
  };
  context.on("response", onResponse);
  let withPerson = Boolean(ctx.person) || captcha;
  let deadline = Date.now() + (withPerson ? PERSON_WAIT_MS : AUTO_WAIT_MS);
  const askPerson = async (what: string) => {
    if (!ctx.handoff || !canShowWindow()) throw new BotCheckError(`${what}. Nothing was sent.`);
    withPerson = true;
    deadline = Date.now() + PERSON_WAIT_MS;
    await ctx.announceHandoff?.(`${what}: finish it in the Chrome window on your computer, then press Submit Application`);
  };
  try {
    await page.bringToFront().catch(() => undefined);
    await centre(button);
    if (captcha) {
      // A person types the CAPTCHA and presses Submit; nothing here reads the image.
      if (!ctx.handoff || !canShowWindow()) throw new BotCheckError("This Zoho Recruit form has a CAPTCHA, which a person types at a worker with a screen. Nothing was sent.");
      await page.locator(CAPTCHA_INPUT).first().focus().catch(() => undefined);
      await ctx.announceHandoff?.("Zoho Recruit's form is filled: type the CAPTCHA in the Chrome window on your computer, then press Submit Application");
    } else if (withPerson) {
      await ctx.announceHandoff?.("Check the Zoho Recruit form in the Chrome window on your computer and press Submit Application");
    } else {
      try {
        await button.click({ timeout: 15000 });
      } catch (error) {
        throw new NotSentError(`Could not press Submit on the Zoho Recruit form: ${friendlyError(error)}`);
      }
    }
    const pressedAt = Date.now();
    for (;;) {
      const answer = reply as ZohoReply | null;
      if (answer?.kind === "sent") return { confirmed: true, evidence: `Zoho Recruit answered ${answer.status} to the application${answer.reason ? `: ${answer.reason}` : ""}` };
      if (answer?.kind === "refused") {
        reply = null;
        posted = false;
        const what = `Zoho Recruit refused the submission (${answer.status}${answer.reason ? `: ${answer.reason}` : ""})`;
        // A wrong CAPTCHA is typed again by the person in the same window; any other refusal ends the run.
        if (!(withPerson && /captcha/i.test(answer.reason)) || !livePage(page)) throw new NotSentError(`${what}. Nothing was sent.`);
      }
      const live = livePage(page);
      if (!live) {
        if (posted) throw new MaybeSentError("The Zoho Recruit window closed after the form was sent, before Zoho answered. Check your email before applying again.");
        throw new WindowClosedError("The Zoho Recruit window was closed before the form was sent. Nothing was sent.");
      }
      const evidence = posted ? await successShown(live) : null;
      if (evidence) return { confirmed: true, evidence };
      if (!posted && !withPerson && Date.now() - pressedAt > 6000) {
        const errors = await formErrors(live);
        if (errors.length > 0) throw new NotSentError(`Zoho Recruit did not take the form: ${errors.join("; ")}`);
      }
      if (Date.now() >= deadline) {
        if (posted) throw new MaybeSentError("Submit was pressed but Zoho Recruit did not answer. Check your email before applying again.");
        if (!withPerson) {
          await askPerson("Nothing reached Zoho Recruit after the worker pressed Submit");
          continue;
        }
        throw new NotSentError("Submit was not pressed within 15 minutes. Nothing was sent; press Retry when you are ready.");
      }
      if (await ctx.cancelled?.()) {
        if (posted) throw new MaybeSentError("Cancelled after the form was sent to Zoho Recruit, before it answered. Check your email before applying again.");
        throw new WindowClosedError("Cancelled by you before the form was sent. Nothing was sent.");
      }
      await live.waitForTimeout(1000).catch(() => undefined);
    }
  } finally {
    stopWatching();
    context.off("response", onResponse);
  }
}

export const zohoAdapter: AtsAdapter = {
  source: "zohorecruit",
  matches(url: string) {
    return /^https:\/\/[a-z0-9-]+\.zohorecruit\.(in|com|eu|com\.au|jp)\//i.test(url);
  },
  // Upload first: Zoho may fill fields from the resume; our values are typed after.
  uploadFirst: true,
  uploadFile: attachFile,
  attachesBySelector: true,
  inspect(page: Page) {
    return readFields(page);
  },
  async fill(page, values) {
    const filled: FilledField[] = [];
    await declineCookies(page);
    for (const value of values) {
      if (value.type === "file") continue;
      const written = await inField(value.label, async () => {
        if (value.type === "select") return fillPicklist(page, value);
        if (value.type === "checkbox") return fillCheckbox(page, value);
        const text = value.key === "phone" ? nationalNumber(value.value) : value.type === "number" ? numberText(value.value, value.label) : value.value;
        return fillTextLike(page, value, text);
      });
      filled.push({ key: value.key, label: value.label, value: written, source: value.source, selector: value.selector, basis: value.basis });
    }
    return filled;
  },
  watchSubmit(page: Page, onSubmit: () => void) {
    const context = page.context();
    let seen = false;
    const onRequest = (request: Request) => {
      if (seen || request.method() !== "POST" || !APPLY_POST.test(request.url())) return;
      seen = true;
      onSubmit();
    };
    context.on("request", onRequest);
    return () => context.off("request", onRequest);
  },
  confirmation(page: Page) {
    return successShown(page);
  },
  submit: submitZoho,
};
