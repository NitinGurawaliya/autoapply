import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page, Request } from "playwright";
import { z } from "zod";
import { joinChoices, splitChoices } from "@/lib/choices";
import type { AtsAdapter, FilledField, FormField, ResolvedValue, SubmitContext, SubmitResult } from "../adapter";
import { BotCheckError, MaybeSentError, NoRetryError, NotSentError, WindowClosedError } from "../adapter";
import { canShowWindow, livePage } from "../browser";
import { assertJobOpen, dismissOverlays, firstVisible, friendlyError, inField } from "./common";

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
      const selector = field.type === "phone" ? "#input_phone" : `[name="${field.id}"]`;
      const type = field.type === "paragraph" ? "textarea" : "text";
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
    await page.locator(fileInput("resume")).first().setInputFiles(file);
    // The drop zone shows the file's name once Workable has taken it (the input itself has no text).
    await page.waitForFunction((fileName) => document.body.innerText.toLowerCase().includes(fileName.toLowerCase()), name, { timeout: 30000 });
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

const CONFIRMATION = /thank you for (applying|your application)|application (was |has been )?(submitted|received|sent)|we('| ha)ve received your application/i;

async function successShown(page: Page) {
  if (/\/apply\/?(success|thank|confirmation)/i.test(page.url())) return `url ${page.url()}`;
  const body = await page.locator("body").innerText().catch(() => "");
  const match = body.match(CONFIRMATION);
  // The form's own text is never the answer: it must be gone.
  if (match && (await page.locator('[data-ui="apply-button"]').count()) === 0) return `text "${match[0]}"`;
  return null;
}

async function challengeVisible(page: Page) {
  const frames = page.locator('iframe[src*="challenges.cloudflare.com"]');
  const count = await frames.count();
  for (let index = 0; index < count; index += 1) {
    const box = await frames.nth(index).boundingBox({ timeout: 1000 }).catch(() => null);
    if (box && box.height > 40 && (await frames.nth(index).isVisible())) return true;
  }
  return false;
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

const AUTO_WAIT_MS = 60000;
const PERSON_WAIT_MS = 15 * 60 * 1000;
// The application leaves as a POST to the job's own apply endpoint, on Workable's host or the employer's.
const APPLY_POST = /\/api\/v\d\/jobs\/[A-Z0-9]{6,}\/(apply|candidates|applications?)\b/i;

async function submitWorkable(page: Page, ctx: SubmitContext): Promise<SubmitResult> {
  await dismissOverlays(page);
  const button = await firstVisible(page, ['[data-ui="apply-button"]', "button[type=submit]"], 20000);
  if (!button) throw new NoRetryError("The Submit button never appeared on the Workable form. Open the form and submit it yourself.");
  await button.scrollIntoViewIfNeeded().catch(() => undefined);
  let posted = false;
  const stopWatching = workableAdapter.watchSubmit!(page, () => {
    posted = true;
  });
  let withPerson = Boolean(ctx.person);
  let deadline = Date.now() + (withPerson ? PERSON_WAIT_MS : AUTO_WAIT_MS);
  const askPerson = async (what: string) => {
    if (!ctx.handoff || !canShowWindow()) throw new BotCheckError(`${what} when the worker pressed Submit. Nothing was sent.`);
    withPerson = true;
    deadline = Date.now() + PERSON_WAIT_MS;
    await ctx.announceHandoff?.(`${what}: complete it in the Chrome window on your computer, then press Submit if the form is still there`);
  };
  try {
    if (withPerson) {
      await page.bringToFront().catch(() => undefined);
      await ctx.announceHandoff?.("Workable asked to confirm a person is applying: check the form in the Chrome window on your computer and press Submit");
    } else {
      try {
        await button.click({ timeout: 15000 });
      } catch (error) {
        throw new NotSentError(`Could not press Submit on the Workable form: ${friendlyError(error)}`);
      }
    }
    let challenged = false;
    for (;;) {
      const live = livePage(page);
      if (!live) {
        if (posted) throw new MaybeSentError("The Workable window closed after the form was sent, before its thanks page showed. Check your email before applying again.");
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
        const input = page.locator(value.selector).first();
        const text = value.key === "phone" ? nationalNumber(value.value) : value.value;
        await input.scrollIntoViewIfNeeded().catch(() => undefined);
        // The address arrives prefilled from the IP's location ("Jhajjar, India"): replaced, never appended to.
        await input.fill("");
        await input.fill(text);
        if (value.key === "city") await input.press("Escape").catch(() => undefined);
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
