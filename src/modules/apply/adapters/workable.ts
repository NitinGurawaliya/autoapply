import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page, Request, Response } from "playwright";
import { z } from "zod";
import { joinChoices, splitChoices } from "@/lib/choices";
import type { AtsAdapter, FilledField, FormField, ResolvedValue, SubmitContext, SubmitResult } from "../adapter";
import { BotCheckError, MaybeSentError, NoRetryError, NotSentError, WindowClosedError } from "../adapter";
import { canShowWindow, livePage } from "../browser";
import { assertJobOpen, dismissOverlays, firstVisible, friendlyError, inField, toDatePickerText } from "./common";

/**
 * Workable (Phase M, M12). One page: personal information, optional Education and Experience lists, the resume, and the
 * employer's questions (`QA_<id>`). The form is public JSON (`/api/v1/jobs/<shortcode>/form`), so its fields are read
 * from there, as Keka's are, and the runner can ask before the browser opens (questions.ts). Some employers serve the
 * same form on their own domain (Apna: careers.apna.co/_/j/<shortcode>/apply); the form is the same.
 * Turnstile decides on Submit, as Lever's hCaptcha does: the worker presses Submit once in a visible window, and a
 * challenge hands the window to the person (lib/queue.ts HANDOFF_BOARDS).
 */

const FORM_API = "https://apply.workable.com/api/v1/jobs";

const fieldSchema = z.object({
  id: z.string(),
  label: z.string().nullish(),
  required: z.boolean().nullish(),
  type: z.string(),
  options: z.array(z.object({ name: z.string(), value: z.string() })).nullish(),
  singleOption: z.boolean().nullish(),
});
const formSchema = z.array(z.object({ name: z.string().nullish(), fields: z.array(z.unknown()) }));

// The fixed fields, by the id the form gives them: the answer key each is.
const HINTS: Record<string, string> = {
  firstname: "first_name",
  lastname: "last_name",
  email: "email",
  phone: "phone",
  address: "city",
  resume: "resume",
  cover_letter: "cover_letter",
};
// Optional fields that are no fact we hold: left blank (an empty optional field is never asked).
const SKIP = new Set(["headline", "summary", "education", "experience"]);

const shortcodeOf = (url: string) => url.match(/\/j\/([A-Z0-9]{6,})/i)?.[1]?.toUpperCase() ?? null;
// A file field's `data-ui` is on the file input itself (`<input type=file data-ui="resume">`, 10 Nov: the first real run
// sent no resume because a selector looked for an input inside it); inside a wrapper too, should a form nest it.
const fileInput = (id: string) => `input[type=file][data-ui="${id}"], [data-ui="${id}"] input[type=file]`;

/** Workable's form JSON → the FormField shape the runner resolves (selectors on the rendered form). */
export function fromWorkable(body: unknown): FormField[] {
  const fields: FormField[] = [];
  for (const section of formSchema.parse(body)) {
    for (const item of section.fields) {
      const parsed = fieldSchema.safeParse(item);
      if (!parsed.success) continue;
      const field = parsed.data;
      const required = field.required === true;
      if (field.type === "group") {
        // Never required on the 60 India forms read on 10 Nov; a required list would need its own filling.
        if (required) throw new NoRetryError(`This Workable form requires "${field.label ?? field.id}" entries, which the agent cannot fill yet. Apply on the company's site.`);
        continue;
      }
      if (SKIP.has(field.id) && !required) continue;
      const label = (field.label ?? field.id).replace(/\s+/g, " ").trim();
      const hintKey = HINTS[field.id];
      if (field.type === "file") {
        if (field.id === "resume") fields.push({ selector: fileInput("resume"), label, type: "file", required, hintKey });
        // Any other file a question asks for: asked, never guessed (the runner has no file but the resume).
        else if (required) fields.push({ selector: fileInput(field.id), label, type: "file", required });
        continue;
      }
      if (field.type === "boolean") {
        fields.push({ selector: `[data-ui="${field.id}"]`, label, type: "radio", required, options: ["Yes", "No"] });
        continue;
      }
      if (field.type === "multiple") {
        const options = (field.options ?? []).map((option) => option.value.replace(/\s+/g, " ").trim()).filter(Boolean);
        fields.push({ selector: `[data-ui="${field.id}"]`, label, type: field.singleOption ? "radio" : "checkbox-group", required, options });
        continue;
      }
      if (field.type === "dropdown") {
        // A custom select: a read-only combobox that opens a listbox (Zyte's "English Level", smartstream's "Title",
        // 17 Nov: typed as text, the box kept ""). Picked from its list in fill (fillDropdown).
        const options = (field.options ?? []).map((option) => option.value.replace(/\s+/g, " ").trim()).filter(Boolean);
        fields.push({ selector: `[data-ui="${field.id}"]`, label, type: "select", required, options });
        continue;
      }
      const selector = field.type === "phone" ? "#input_phone" : `[name="${field.id}"]`;
      // A date question is a text box masked MM/DD/YYYY with a calendar (Lokal's "How soon can you join?", 10 Nov).
      // A "number" question is a text box that drops every non-digit as it is typed ("1.5 years" became "1.5" and the
      // read-back failed, docyt 17 Nov): resolved and typed as a bare number (valueResolver fitNumber, guess.ts).
      const type = field.type === "paragraph" ? "textarea" : field.type === "date" ? "date" : field.type === "number" ? "number" : "text";
      fields.push({ selector, label, type, required, hintKey });
    }
  }
  return fields;
}

/** The form's fields for a job, by its shortcode, without a browser; null when Workable does not answer. */
export async function workableForm(shortcode: string): Promise<FormField[] | null> {
  const response = await fetch(`${FORM_API}/${encodeURIComponent(shortcode)}/form`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15000) }).catch(() => null);
  if (!response?.ok) return null;
  return fromWorkable(await response.json());
}

const norm = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();

function pickIndex(options: string[], wanted: string) {
  const target = norm(wanted);
  const list = options.map(norm);
  const exact = list.indexOf(target);
  if (exact >= 0) return exact;
  const starts = list.findIndex((option) => option.startsWith(target));
  return starts >= 0 ? starts : list.findIndex((option) => option.includes(target));
}

async function readFields(page: Page): Promise<FormField[]> {
  await page
    .locator('[data-ui="apply-button"], form [name="firstname"]')
    .first()
    .waitFor({ timeout: 30000 })
    .catch(async (error) => {
      await assertJobOpen(page);
      throw error;
    });
  await dismissOverlays(page);
  const shortcode = shortcodeOf(page.url());
  if (!shortcode) throw new Error("Not a Workable application form (no job code in its address)");
  const fields = await workableForm(shortcode);
  if (!fields) throw new Error("Workable did not return this job's form");
  // Only what the page really shows. A required field the page does not show is a selector the form outgrew: the run
  // stops here rather than leaving it empty for Workable to refuse (the resume, 10 Nov).
  const shown: FormField[] = [];
  const missing: string[] = [];
  for (const field of fields) {
    if ((await page.locator(field.selector).count()) > 0) shown.push(field);
    else if (field.required) missing.push(field.label);
  }
  if (missing.length > 0) throw new Error(`The Workable form's required fields were not found on the page: ${missing.slice(0, 5).join(", ")}`);
  return shown;
}

/** Attach the resume to the form's own resume field and wait for its name to show. */
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
    // The drop zone shows the file's name once Workable has taken it (the input itself has no text).
    await page.waitForFunction((fileName) => document.body.innerText.toLowerCase().includes(fileName.toLowerCase()), name, { timeout: 30000 });
    // The name shows at once, but Workable keeps uploading the file and holds Submit disabled until it is done (11 Nov:
    // 1.8 s for a one-page file; the worker's Submit on Lokal hit a disabled button). Done means Submit is enabled again.
    if (!(await waitSubmitEnabled(page, 60000))) throw new Error("Workable did not finish taking the file within a minute");
    return cleanup;
  } catch (error) {
    await cleanup();
    throw new Error(`Resume upload failed: ${error instanceof Error ? error.message.split("\n")[0] : "no confirmation"}`);
  }
}

/** The phone box sits beside a country picker already on India: the national number only. */
function nationalNumber(value: string) {
  const digits = value.replace(/[^\d+]/g, "");
  return digits.replace(/^\+?91(?=\d{10}$)/, "").replace(/^0(?=\d{10}$)/, "");
}

async function fillChoices(page: Page, value: ResolvedValue) {
  const group = page.locator(value.selector);
  const labels = (await group.locator("label").allInnerTexts()).map((text) => text.replace(/\s+/g, " ").trim());
  const wanted = value.type === "checkbox-group" ? splitChoices(value.value) : [/^(yes|true)$/i.test(value.value.trim()) ? "Yes" : /^(no|false)$/i.test(value.value.trim()) ? "No" : value.value];
  const picked: string[] = [];
  for (const choice of wanted) {
    const index = pickIndex(labels, choice);
    if (index < 0) throw new Error(`No option "${choice}" for "${value.label}"`);
    const label = group.locator("label").nth(index);
    const input = label.locator("input");
    if (!(await input.isChecked().catch(() => false))) await label.click();
    picked.push(labels[index]);
  }
  return joinChoices(picked);
}

/**
 * Workable's dropdown: `[data-ui=ID][data-input-type=select]` holds a read-only `input[role=combobox]` that opens a
 * `ul[role=listbox]` of `li[role=option]`; the chosen option's label shows in the combobox and its id lands in the
 * hidden `input[name=ID]`. Escape closes a list left open, as the date picker's calendar did.
 *
 * The box is centred before the list opens: at the window's top edge the list sat under Workable's sticky
 * "Overview / Application" bar and the option click timed out (pricelabs, 17 Nov, one run in two). A click that still
 * fails falls back to a DOM click on the option, which needs it neither visible nor unobstructed. The keyboard is no
 * fallback: ArrowDown opens the list but does not move its highlight, and Enter moves focus to the first field.
 */
async function fillDropdown(page: Page, value: ResolvedValue) {
  const wrapper = page.locator(value.selector).first();
  const box = wrapper.locator('input[role="combobox"]').first();
  const shown = async () => ((await box.inputValue().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
  const close = async () => {
    if ((await wrapper.getAttribute("data-open").catch(() => null)) === "true") await box.press("Escape").catch(() => undefined);
  };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await box.evaluate((element) => element.scrollIntoView({ block: "center" })).catch(() => undefined);
    await page.waitForTimeout(150);
    if ((await wrapper.getAttribute("data-open")) !== "true") await box.click({ timeout: 5000 });
    const owns = await box.getAttribute("aria-owns");
    const listbox = (owns ? page.locator(`#${owns}`) : wrapper.locator('[role="listbox"]')).first();
    await listbox.waitFor({ timeout: 5000 });
    const options = listbox.locator('[role="option"]');
    const texts = (await options.allInnerTexts()).map((text) => text.replace(/\s+/g, " ").trim());
    const index = pickIndex(texts, value.value);
    if (index < 0) {
      await close();
      throw new Error(`No option "${value.value}" for "${value.label}" (the list shows: ${texts.slice(0, 6).join(" | ")})`);
    }
    if (attempt < 2) await options.nth(index).click({ timeout: 5000 }).catch(() => undefined);
    else await options.nth(index).evaluate((element) => (element as HTMLElement).click()).catch(() => undefined);
    await page.waitForTimeout(300);
    const now = await shown();
    await close();
    if (norm(now) === norm(texts[index])) return texts[index];
  }
  throw new Error(`the box kept "${(await shown()).slice(0, 30)}" instead of the answer`);
}

/**
 * What a Workable number box can hold: the first number in the answer ("1.5 years" → "1.5", "6,00,000" → "600000",
 * "6 LPA" → "600000"); "none", "no", "NA", "nil", "fresher" and "immediate" are 0. Anything else needs a number.
 */
export function numberText(answer: string, label: string) {
  const text = answer.trim();
  if (/^(none|no|n\/?a|nil|nothing|fresher|immediate(ly)?|not applicable)\b/i.test(text) || text === "") return "0";
  const plain = text.replace(/(\d),(?=\d)/g, "$1");
  const match = plain.match(/\d+(?:\.\d+)?/);
  if (!match) throw new NoRetryError(`"${label}" takes a number only, and the answer "${text.slice(0, 40)}" has none`);
  const lakhs = /\b(lpa|lakh|lacs?|lakhs)\b/i.test(plain) || /^\s*₹?\s*\d+(?:\.\d+)?\s*l\b/i.test(plain);
  return String(lakhs ? Math.round(Number(match[0]) * 100000) : Number(match[0]));
}

/** A typed value must still be in the box after typing; an empty box here would only show up as Workable's refusal. */
async function readBack(input: ReturnType<Page["locator"]>, expected: string) {
  const now = ((await input.inputValue().catch(() => "")) ?? "").trim();
  const digits = (text: string) => text.replace(/\D/g, "");
  // Short answers must come back with the same digits (a date, a phone, a number); long ones only non-empty, since a
  // box may cut text at its length limit.
  const short = expected.trim().length <= 60;
  if (!now || (short && digits(expected).length > 0 && digits(now) !== digits(expected) && now !== expected.trim())) throw new Error(`the box kept "${now.slice(0, 30)}" instead of the answer`);
}

// "Already applied/submitted/received" counts as applied too: the application is on file (a duplicate, never a refusal).
export const CONFIRMATION = /thank you for (applying|your application)|application (was |has been )?(already )?(submitted|received|sent)|we('| ha)ve received your application|you('| ha)ve already applied/i;

async function successShown(page: Page) {
  // Workable's own success marker is the strongest sign: it shows only once the application is taken.
  if (await page.locator('[data-ui="application-success"]').first().isVisible().catch(() => false)) return "marker [data-ui=application-success]";
  if (/\/apply\/?(success|thank|confirmation)/i.test(page.url())) return `url ${page.url()}`;
  const body = await page.locator("body").innerText().catch(() => "");
  const match = body.match(CONFIRMATION);
  // The form's own text is never the answer: it must be gone.
  if (match && (await page.locator('[data-ui="apply-button"]').count()) === 0) return `text "${match[0]}"`;
  return null;
}

/**
 * Wait until Workable's Submit is enabled (true), a Turnstile challenge shows ("challenge", when `challenge` is given),
 * or the time is up (false). Submit is disabled while a file uploads and while the form is being sent.
 */
async function waitSubmitEnabled(page: Page, ms: number, challenge?: () => Promise<boolean>): Promise<boolean | "challenge"> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const enabled = await page
      .evaluate(() => {
        const button = document.querySelector('[data-ui="apply-button"]') as HTMLButtonElement | null;
        return Boolean(button && !button.disabled && button.getAttribute("aria-disabled") !== "true");
      })
      .catch(() => false);
    if (enabled) return true;
    if (challenge && (await challenge().catch(() => false))) return "challenge";
    await page.waitForTimeout(500).catch(() => undefined);
  }
  return false;
}

async function challengeVisible(page: Page) {
  const frames = page.locator('iframe[src*="challenges.cloudflare.com"]');
  const count = await frames.count();
  for (let index = 0; index < count; index += 1) {
    const box = await frames.nth(index).boundingBox({ timeout: 1000 }).catch(() => null);
    if (box && box.height > 40 && (await frames.nth(index).isVisible())) return true;
  }
  // The frame tree catches a widget whose iframe the locator's src glob misses (Cloudflare rewrites it as it loads).
  for (const frame of page.frames()) {
    if (!/challenges\.cloudflare\.com/.test(frame.url())) continue;
    const element = await frame.frameElement().catch(() => null);
    const box = element ? await element.boundingBox().catch(() => null) : null;
    if (box && box.height > 40) return true;
  }
  // A full-page challenge (possible on an employer's own domain) carries the words as page text; the widget's own
  // words sit inside its cross-origin iframe and never reach the body's text.
  const body = await page.locator("body").innerText().catch(() => "");
  return /verify you are human/i.test(body);
}

async function invalidFieldLabels(page: Page) {
  return page.evaluate(
    `Array.from(document.querySelectorAll('form [aria-invalid="true"], form :invalid')).map((el) => {
      const id = el.getAttribute('aria-labelledby');
      const label = id ? document.getElementById(id.split(' ')[0]) : null;
      return ((label && label.textContent) || el.getAttribute('name') || '').replace(/\\s+/g, ' ').trim();
    }).filter(Boolean)`,
  ) as Promise<string[]>;
}

// Turnstile can hold the worker's own Submit for over a minute before the form goes (10 Nov: the POST left 108 s after
// the click), so the worker waits two minutes before handing the window to a person.
const AUTO_WAIT_MS = 120000;
const PERSON_WAIT_MS = 15 * 60 * 1000;
// The application leaves as a POST to the job's own apply endpoint, on Workable's host or the employer's.
const APPLY_POST = /\/api\/v\d\/jobs\/[A-Z0-9]{6,}\/(apply|candidates|applications?)\b/i;

export type WorkableReply = { kind: "sent" | "refused" | "unknown"; status: number; reason: string };

/**
 * Workable's own answer to the application's POST: a 2xx is the application received (the thanks page is only its
 * echo, and the window may close before it shows, 10 Nov); a 4xx is a refusal with nothing recorded (a failed bot check,
 * a field it rejects) unless it says the application was already submitted or received: that is the application already
 * on file, counted as sent. Anything else leaves the outcome unknown. Only the error's words are kept, never the body.
 */
export function readReply(status: number, body: string): WorkableReply {
  if (status >= 200 && status < 300) return { kind: "sent", status, reason: "" };
  let reason = "";
  try {
    const json = JSON.parse(body) as Record<string, unknown>;
    const pick = (value: unknown): string =>
      typeof value === "string" ? value : Array.isArray(value) ? value.map(pick).filter(Boolean).join("; ") : value && typeof value === "object" ? Object.values(value).map(pick).filter(Boolean).join("; ") : "";
    reason = pick(json.error ?? json.message ?? json.errors ?? "");
  } catch {
    reason = "";
  }
  reason = reason.replace(/\s+/g, " ").trim().slice(0, 160);
  // A duplicate is the application already on file (an earlier run, a person's own try): applied, never a refusal.
  if (status >= 400 && status < 500) {
    if (/already (submitted|received|applied)|have already applied/i.test(reason)) return { kind: "sent", status, reason };
    return { kind: "refused", status, reason };
  }
  return { kind: "unknown", status, reason };
}

async function submitWorkable(page: Page, ctx: SubmitContext): Promise<SubmitResult> {
  await dismissOverlays(page);
  const button = await firstVisible(page, ['[data-ui="apply-button"]', "button[type=submit]"], 20000);
  if (!button) throw new NoRetryError("The Submit button never appeared on the Workable form. Open the form and submit it yourself.");
  await button.scrollIntoViewIfNeeded().catch(() => undefined);
  let posted = false;
  const stopWatching = workableAdapter.watchSubmit!(page, () => {
    posted = true;
  });
  // Workable's answer to each submission, read off the response (it stays readable after the window closes).
  let reply: WorkableReply | null = null;
  const context = page.context();
  const onResponse = (response: Response) => {
    if (response.request().method() !== "POST" || !APPLY_POST.test(response.url())) return;
    void response
      .text()
      .catch(() => "")
      .then((body) => {
        reply = readReply(response.status(), body);
      });
  };
  context.on("response", onResponse);
  let withPerson = Boolean(ctx.person);
  let deadline = Date.now() + (withPerson ? PERSON_WAIT_MS : AUTO_WAIT_MS);
  const askPerson = async (what: string) => {
    if (!ctx.handoff || !canShowWindow()) throw new BotCheckError(`${what} when the worker pressed Submit. Nothing was sent.`);
    withPerson = true;
    deadline = Date.now() + PERSON_WAIT_MS;
    await ctx.announceHandoff?.(`${what}: complete it in the Chrome window on your computer, then press Submit if the form is still there`);
  };
  try {
    // As Ashby (adapters/ashby.ts): the window in front, then one plain click, and the bot check decides. A window in the
    // background is scored lower by these checks.
    await page.bringToFront().catch(() => undefined);
    if (withPerson) {
      await ctx.announceHandoff?.("Workable asked to confirm a person is applying: check the form in the Chrome window on your computer and press Submit");
    } else {
      // Submit stays disabled while anything is still uploading or Turnstile is still deciding: wait for it, never force it.
      const ready = await waitSubmitEnabled(page, 60000, () => challengeVisible(page));
      if (ready === "challenge") await askPerson("Workable's Turnstile showed a challenge");
      else if (!ready) await askPerson("Workable kept Submit locked (its human check did not clear)");
      else {
        try {
          await button.click({ timeout: 15000 });
        } catch (error) {
          throw new NotSentError(`Could not press Submit on the Workable form: ${friendlyError(error)}`);
        }
      }
    }
    let challenged = false;
    for (;;) {
      // Workable's own answer first: it settles the outcome whatever the window does next.
      const answer = reply as WorkableReply | null;
      if (answer?.kind === "sent") return { confirmed: true, evidence: `Workable answered ${answer.status} to the application${answer.reason ? `: ${answer.reason}` : ""}` };
      if (answer?.kind === "refused") {
        reply = null;
        posted = false;
        const what = `Workable refused the submission (${answer.status}${answer.reason ? `: ${answer.reason}` : ""})`;
        // A refused bot check can be passed by a person in the same window; with a person already there, they try again.
        if (!withPerson) await askPerson(what);
        else if (!livePage(page)) throw new NotSentError(`${what}. Nothing was sent.`);
      }
      const live = livePage(page);
      if (!live) {
        if (posted) throw new MaybeSentError("The Workable window closed after the form was sent, before Workable answered. Check your email before applying again.");
        throw new WindowClosedError("The Workable window was closed before the form was sent. Nothing was sent.");
      }
      const evidence = posted ? await successShown(live) : null;
      if (evidence) return { confirmed: true, evidence };
      if (!challenged && (await challengeVisible(live))) {
        challenged = true;
        if (!withPerson) await askPerson("Workable's Turnstile showed a challenge");
      }
      if (!posted && !withPerson) {
        const invalid = await invalidFieldLabels(live);
        if (invalid.length > 0 && Date.now() > deadline - AUTO_WAIT_MS + 6000) throw new NotSentError(`Workable rejected the form: ${[...new Set(invalid)].slice(0, 5).join(", ")}`);
      }
      if (Date.now() >= deadline) {
        if (posted) throw new MaybeSentError("Submit was pressed but Workable's thanks page did not show. Check your email before applying again.");
        if (!withPerson) {
          await askPerson("Nothing reached Workable after the worker pressed Submit (its Turnstile may have stopped it)");
          continue;
        }
        throw new NotSentError("Submit was not pressed within 15 minutes. Nothing was sent; press Retry when you are ready.");
      }
      if (await ctx.cancelled?.()) {
        if (posted) throw new MaybeSentError("Cancelled after the form was sent to Workable, before its thanks page showed. Check your email before applying again.");
        throw new WindowClosedError("Cancelled by you before the form was sent. Nothing was sent.");
      }
      await live.waitForTimeout(1000).catch(() => undefined);
    }
  } finally {
    stopWatching();
    context.off("response", onResponse);
  }
}

export const workableAdapter: AtsAdapter = {
  source: "workable",
  matches(url: string) {
    return /apply\.workable\.com|\.workable\.com\//i.test(url);
  },
  formUrl(job) {
    return `https://apply.workable.com/j/${encodeURIComponent(job.externalId)}/apply`;
  },
  // Upload first: our values are typed after anything the page takes from the resume.
  uploadFirst: true,
  uploadFile: attachFile,
  attachesBySelector: true,
  inspect(page: Page) {
    return readFields(page);
  },
  async fill(page, values) {
    const filled: FilledField[] = [];
    await dismissOverlays(page);
    for (const value of values) {
      if (value.type === "file") continue;
      const written = await inField(value.label, async () => {
        if (value.type === "radio" || value.type === "checkbox-group") return fillChoices(page, value);
        if (value.type === "select") return fillDropdown(page, value);
        const input = page.locator(value.selector).first();
        await input.scrollIntoViewIfNeeded().catch(() => undefined);
        if (value.type === "date") {
          // "20" (days of notice) or a date → MM/DD/YYYY, typed into the mask; Escape closes its calendar, which
          // otherwise stays open over the next field (10 Nov: the field below it was then left empty).
          const date = /^\d{2}\/\d{2}\/\d{4}$/.test(value.value.trim()) ? value.value.trim() : toDatePickerText(value.value);
          if (!date) throw new Error(`needs a date (MM/DD/YYYY), and the answer "${value.value.slice(0, 40)}" is not one`);
          await input.click();
          await input.fill("");
          await input.pressSequentially(date, { delay: 40 });
          await input.press("Escape").catch(() => undefined);
          await readBack(input, date);
          return date;
        }
        const text = value.key === "phone" ? nationalNumber(value.value) : value.type === "number" ? numberText(value.value, value.label) : value.value;
        // The address arrives prefilled from the IP's location ("Jhajjar, India"): replaced, never appended to.
        await input.fill("");
        await input.fill(text);
        await readBack(input, text);
        return text;
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
  submit: submitWorkable,
};
