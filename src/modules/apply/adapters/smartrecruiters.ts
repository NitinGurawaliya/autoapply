import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Locator, Page, Request, Response } from "playwright";
import { z } from "zod";
import { splitChoices } from "@/lib/choices";
import type { AtsAdapter, FilledField, FormField, ResolvedValue, SubmitContext, SubmitResult } from "../adapter";
import { BotCheckError, MaybeSentError, NoRetryError, NotSentError, WindowClosedError } from "../adapter";
import { canShowWindow, livePage } from "../browser";
import { assertJobOpen, dismissOverlays, friendlyError, inField } from "./common";

/**
 * SmartRecruiters (Phase M, M7). The job page (`jobs.smartrecruiters.com/<Company>/<postingId>-<title>`) links to the
 * Easy Apply form (`/oneclick-ui/company/<Company>/publication/<uuid>`), an Angular app whose fields are SmartRecruiters'
 * own `spl-*` web components (open shadow roots, which Playwright's CSS pierces). Page 1 holds the standard fields; the
 * form's config (`/oneclick-ui/api/company/<id>/(job|publication)/<id>/config`, fetched by the page) says which are
 * required. "Next" leads to the screening questions, if the job has any, and Submit; the application leaves as a POST
 * to `/oneclick-ui/api/company/<id>/.../application`, and its answer decides the outcome.
 *
 * DataDome guards the form: it blocked the Playwright browser outright (10 Nov) and let the stealthy Chrome through
 * (17 Nov, ARCHITECTURE 6.21). A challenge that does show goes to the person, as on Workable (HANDOFF_BOARDS).
 */

const APPLY_POST = /\/oneclick-ui\/api\/company\/[^/]+\/(?:job\/[^/]+\/)?(?:publication\/[^/]+\/)?application(?:[?#]|$)/;
const CONFIG = /\/oneclick-ui\/api\/company\/[0-9a-f]{24}\/(?:job|publication)\/[^/]+\/config/;
const FIELD_TAGS = "spl-multiselect-autocomplete, spl-number-field, spl-input, spl-textarea, spl-select, spl-autocomplete, spl-phone-field, spl-radio-group, spl-checkbox-group, spl-checkbox, spl-dropzone, spl-datepicker, spl-date-picker";

const flag = z.object({ required: z.boolean().nullish(), visible: z.boolean().nullish() }).passthrough().nullish();
const configSchema = z.object({
  fieldSets: z
    .object({
      firstAndLastName: flag,
      email: flag,
      placeOfResidence: flag,
      phoneNumber: flag,
      experience: flag,
      education: flag,
      socialProfiles: flag,
      resume: flag,
      messageToHiringManager: flag,
    })
    .passthrough(),
});
type Config = z.infer<typeof configSchema>;

type Seen = { config: Config | null; step: number; round: number; page1: Set<string> };
const seen = new WeakMap<Page, Seen>();

/** The page's own config answer, whichever of its two shapes it took. */
function readConfig(page: Page) {
  return page
    .waitForResponse((response) => CONFIG.test(response.url()) && response.request().method() === "GET", { timeout: 30000 })
    .then(async (response) => configSchema.safeParse(await response.json().catch(() => null)))
    .then((parsed) => (parsed.success ? parsed.data : null))
    .catch(() => null);
}

/** From the job page to the Easy Apply form; the form itself is already there on a retry. */
async function openForm(page: Page): Promise<Config | null> {
  if (/\/oneclick-ui\//.test(page.url())) {
    const config = readConfig(page);
    await page.reload({ waitUntil: "domcontentloaded" });
    return config;
  }
  const link = page.locator("a#st-apply, a[href*='oneclick-ui']").first();
  if (!(await link.count())) {
    await assertJobOpen(page);
    throw new NoRetryError("This SmartRecruiters job has no Easy Apply form (it applies on the company's own site). Apply there.");
  }
  const href = await link.getAttribute("href");
  const config = readConfig(page);
  await page.goto(new URL(href!, page.url()).toString(), { waitUntil: "domcontentloaded", timeout: 45000 });
  return config;
}

/** DataDome's block page or challenge frame. */
async function blocked(page: Page) {
  if (page.frames().some((frame) => /captcha-delivery|geo\.captcha|datadome/i.test(frame.url()))) return "challenge";
  const text = await page.locator("body").innerText().catch(() => "");
  return /access is temporarily restricted|we detected unusual activity/i.test(text) ? "block" : null;
}

/**
 * A component's question text: its `label` attribute (page 1), else its slotted `[slot=label-content]` (the screening
 * questions, a consent checkbox), else its aria-label ("Select Gender?"). Never a made-up label: an empty one stops a
 * required question rather than have it guessed blind (17 Nov: an unlabelled "Gender?" was read as "City").
 */
async function labelOf(element: Locator) {
  const own = (await element.getAttribute("label").catch(() => null))?.trim();
  if (own) return own;
  const text = await element.evaluate((node) => {
    const slotted = node.querySelector(":scope > [slot=label-content]");
    const fromSlot = (slotted?.textContent ?? "").replace(/\s+/g, " ").trim();
    if (fromSlot) return fromSlot;
    return (node.getAttribute("aria-label") ?? "").replace(/^select\s+/i, "").replace(/\s+/g, " ").trim();
  });
  return text || "";
}

/** Whether the component sits inside another field component (the input of an autocomplete, a phone field's parts). */
function nestedInField(element: Locator) {
  return element.evaluate((node) => {
    let up: Node | null = node.parentNode;
    while (up) {
      const host = up instanceof ShadowRoot ? up.host : up;
      if (host instanceof Element && host !== node && /^spl-(autocomplete|phone-field|select|radio-group|checkbox-group|dropdown|number-field|multiselect-autocomplete)$/i.test(host.tagName)) return true;
      up = up instanceof ShadowRoot ? up.host.parentNode : up.parentNode;
    }
    return false;
  });
}

/** A dropdown question's options, read by opening it (its spl-select-option list), then closing it. */
async function dropdownOptions(page: Page, element: Locator) {
  const input = element.locator("input").first();
  await centre(input);
  await input.click({ timeout: 5000 });
  await page.locator(OPTIONS).first().waitFor({ timeout: 5000 }).catch(() => undefined);
  // A long list (Avaloq's nationalities, 17 Nov) draws only the rows in view: scroll it to the end, collecting as it
  // goes, or "Indian" is never among the options and the question is left empty.
  const seen = new Set<string>();
  for (let round = 0; round < 80; round += 1) {
    const texts = (await page.locator(OPTIONS).allInnerTexts()).map((text) => text.replace(/\s+/g, " ").trim()).filter((text) => text && !/^no matches$|cannot find your/i.test(text));
    const before = seen.size;
    for (const text of texts) seen.add(text);
    if (round > 0 && seen.size === before) break;
    const moved = await page
      .locator(OPTIONS)
      .last()
      .evaluate((node) => {
        let box: HTMLElement | null = node.parentElement;
        while (box && box.scrollHeight <= box.clientHeight + 2) box = box.parentElement;
        if (!box) return false;
        const top = box.scrollTop;
        box.scrollTop = top + box.clientHeight;
        return box.scrollTop !== top;
      })
      .catch(() => false);
    if (!moved) break;
    await page.waitForTimeout(150);
  }
  await page.keyboard.press("Escape").catch(() => undefined);
  await page.waitForTimeout(200);
  return [...seen];
}

/** The visible option texts of a choice component (its spl-select options, radios or checkboxes). */
async function optionsOf(element: Locator) {
  // No named function inside: tsx wraps named functions in a `__name` helper that the page does not have.
  return element.evaluate((node) => {
    const texts = new Set<string>();
    const roots: Array<Element | ShadowRoot> = [node];
    while (roots.length > 0) {
      const root = roots.pop()!;
      for (const child of Array.from(root.querySelectorAll("[role=option], spl-option, option, spl-radio, spl-checkbox, label"))) {
        const text = (child.getAttribute("label") ?? child.textContent ?? "").replace(/\s+/g, " ").trim();
        if (text && text.length < 200) texts.add(text);
      }
      for (const child of Array.from(root.querySelectorAll("*"))) {
        const shadow = (child as Element & { shadowRoot?: ShadowRoot | null }).shadowRoot;
        if (shadow) roots.push(shadow);
      }
    }
    return [...texts];
  });
}

/** Every field component on the page that is not one of `skip`, tagged `data-sa-q=<n>` for a stable selector. */
async function readComponents(page: Page, skip: Set<string>, start: number): Promise<FormField[]> {
  const fields: FormField[] = [];
  const all = page.locator(FIELD_TAGS);
  const count = await all.count();
  let n = start;
  for (let i = 0; i < count; i += 1) {
    const element = all.nth(i);
    if (!(await element.isVisible().catch(() => false))) continue;
    const tag = (await element.evaluate((node) => node.tagName.toLowerCase())) as string;
    const id = (await element.getAttribute("id")) ?? "";
    const dataTest = (await element.getAttribute("data-test")) ?? "";
    const key = id || `${tag}:${dataTest}:${i}`;
    if (skip.has(key) || (await element.getAttribute("data-sa-q")) !== null) continue; // read in an earlier round
    skip.add(key);
    if (tag === "spl-dropzone" && dataTest === "apply-with-resume-container") continue; // the "autofill from resume" box
    if (await nestedInField(element)) continue; // part of a field already read (an autocomplete's own input)
    const tagged = `[data-sa-q="${n}"]`;
    await element.evaluate((node, value) => node.setAttribute("data-sa-q", value), String(n));
    n += 1;
    const label = await labelOf(element);
    const required = (await element.getAttribute("required")) !== null;
    const location = tag === "spl-autocomplete" && dataTest === "location-autocomplete";
    if (!label && !location && tag !== "spl-phone-field" && tag !== "spl-dropzone") {
      if (required) throw new NoRetryError(`This SmartRecruiters form has a required ${tag.replace("spl-", "")} question whose text the agent could not read, so it is not answered blind. Apply on the company's site.`);
      continue;
    }
    if (tag === "spl-number-field") {
      // A number or currency question (Bosch's CTC in INR): its text is on this wrapper, the unit in the box's addon.
      const unit = ((await element.locator(".c-spl-number-field-input-addon").first().textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
      const needed = required || (await element.locator("spl-input[required]").count()) > 0;
      fields.push({ selector: tagged, label: unit && !label.includes(unit) ? `${label} (${unit})` : label, type: "number", required: needed });
    } else if (tag === "spl-input") {
      const kind = (await element.getAttribute("type")) ?? "text";
      fields.push({ selector: tagged, label, type: kind === "number" ? "number" : "text", required });
    } else if (tag === "spl-textarea") fields.push({ selector: tagged, label, type: "textarea", required });
    else if (location) fields.push({ selector: tagged, label: label || "City", type: "combobox", required, hintKey: "city" });
    // "Which nationality/nationalities are you" (Avaloq, 17 Nov): a multi-select search box, read nowhere before, so a
    // required question went unanswered and Submit sent nothing.
    else if (tag === "spl-multiselect-autocomplete") fields.push({ selector: tagged, label, type: "checkbox-group", required, options: await dropdownOptions(page, element) });
    else if (tag === "spl-autocomplete") fields.push({ selector: tagged, label, type: "select", required, options: await dropdownOptions(page, element) });
    else if (tag === "spl-phone-field") fields.push({ selector: tagged, label: label || "Phone", type: "text", required, hintKey: "phone" });
    else if (tag === "spl-select") fields.push({ selector: tagged, label, type: "select", required, options: await optionsOf(element) });
    else if (tag === "spl-radio-group") fields.push({ selector: tagged, label, type: "radio", required, options: await optionsOf(element) });
    else if (tag === "spl-checkbox-group") fields.push({ selector: tagged, label, type: "checkbox-group", required, options: await optionsOf(element) });
    else if (tag === "spl-checkbox") fields.push({ selector: tagged, label, type: "checkbox", required });
    else if (tag === "spl-dropzone") fields.push({ selector: tagged, label: label || "Resume", type: "file", required, hintKey: dataTest === "resume-upload" ? "resume" : undefined });
    else if (required) throw new NoRetryError(`This SmartRecruiters form requires "${label || tag}" (${tag}), which the agent cannot fill yet. Apply on the company's site.`);
  }
  // A required question in a component the list above does not know is never skipped in silence: Avaloq's multi-select
  // went unread, unanswered, and Submit sent nothing (17 Nov). Anything required, visible, and neither read nor inside
  // a read field stops the run by name.
  const missed = await page
    .locator("[data-test=question-container] [required]:not([data-sa-q])")
    .evaluateAll((nodes) =>
      nodes
        .filter((node) => {
          const box = node.getBoundingClientRect();
          if (!(box.width > 0 && box.height > 0) || !node.tagName.toLowerCase().startsWith("spl-")) return false;
          for (let up: Node | null = node.parentNode; up; up = up instanceof ShadowRoot ? up.host : up.parentNode) if (up instanceof Element && up.hasAttribute("data-sa-q")) return false;
          return true;
        })
        .map((node) => `${node.tagName.toLowerCase()} "${(node.getAttribute("aria-label") ?? node.querySelector(":scope > [slot=label-content]")?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 60)}"`),
    )
    .catch(() => [] as string[]);
  if (missed.length > 0) throw new NoRetryError(`This SmartRecruiters form has a required question the agent cannot read yet (${missed[0]}), so it is not sent half-filled. Apply on the company's site.`);
  return fields;
}

const HINTS: Record<string, string> = { "first-name-input": "first_name", "last-name-input": "last_name", "email-input": "email", "confirm-email-input": "email", "linkedin-input": "linkedin", "website-input": "portfolio" };

async function readFields(page: Page): Promise<FormField[]> {
  await dismissOverlays(page);
  const config = await openForm(page);
  const wall = await blocked(page);
  if (wall === "block") throw new BotCheckError("SmartRecruiters' DataDome refused this browser (\"Access is temporarily restricted\"). Nothing was sent.");
  const form = page.locator("spl-input#first-name-input").first();
  if (!(await form.waitFor({ timeout: 30000 }).then(() => true, () => false))) {
    // DataDome's "Verification Required" slider instead of the form (17 Nov, after many dry runs in a row from one
    // IP). The agent never solves it: the window is on screen, so a person may clear it; if nobody does, the run goes
    // to a person (BotCheckError), never straight back into the same wall. Nothing has been sent.
    const wallNow = await blocked(page);
    if (!wallNow) throw new Error("The SmartRecruiters form did not load in 30 s");
    if (wallNow === "block" || !(await form.waitFor({ timeout: 120_000 }).then(() => true, () => false))) {
      throw new BotCheckError("SmartRecruiters' DataDome showed its bot check instead of the form, and the agent does not solve it. Nothing was sent.");
    }
  }
  await dismissOverlays(page);
  const sets = config?.fieldSets;
  // Experience and education entries are rows added with "Add": when the form requires them, the most recent role and
  // degree are asked for as fields (filled from the resume by id, history.ts) and added by fillEntry.
  // The config is not always caught (17 Nov: one Rodeo FX run read none), so the section's own required mark counts too.
  const entries: FormField[] = [];
  const marked = (section: Section) => page.locator(`div[data-test=${section}] [data-test=section-required-mark]`).first().isVisible().catch(() => false);
  if ((sets?.experience?.required && sets.experience.visible !== false) || (await marked("experience"))) entries.push(...EXPERIENCE_ENTRY);
  if ((sets?.education?.required && sets.education.visible !== false) || (await marked("education"))) entries.push(...EDUCATION_ENTRY);
  const keys = new Set<string>();
  const fields = await readComponents(page, keys, 0);
  for (const field of fields) {
    const id = (await page.locator(field.selector).getAttribute("id").catch(() => null)) ?? "";
    if (HINTS[id]) field.hintKey = HINTS[id];
    if (field.hintKey === "resume" && sets?.resume) field.required = sets.resume.required === true;
    if (field.hintKey === "city" && sets?.placeOfResidence) field.required = sets.placeOfResidence.required === true;
    if (field.hintKey === "phone" && sets?.phoneNumber) field.required = sets.phoneNumber.required === true;
  }
  seen.set(page, { config: config ?? null, step: 0, round: 0, page1: keys });
  return [...fields, ...entries];
}

// One entry's parts, by the ids history.ts answers from the resume. Dates are ISO ("2026-05-01"), "present" for a
// current role. Selectors name no element: fill() hands them to fillEntry.
type Section = "experience" | "education";
const entryField = (section: Section, id: string, label: string, required: boolean, type: FormField["type"] = "text"): FormField => ({ selector: `[data-sa-entry="${section}"][id="${id}"]`, label, type, required });
const EXPERIENCE_ENTRY: FormField[] = [
  entryField("experience", "sr-exp-title", "Experience entry: job title (most recent role)", true),
  entryField("experience", "sr-exp-company", "Experience entry: company", false),
  entryField("experience", "sr-exp-from", "Experience entry: start date (YYYY-MM-DD)", true),
  entryField("experience", "sr-exp-to", "Experience entry: end date (YYYY-MM-DD, or present)", true),
  entryField("experience", "sr-exp-description", "Experience entry: description", false, "textarea"),
];
const EDUCATION_ENTRY: FormField[] = [
  entryField("education", "sr-edu-school", "Education entry: institution", true),
  entryField("education", "sr-edu-degree", "Education entry: degree", false),
  entryField("education", "sr-edu-major", "Education entry: major", false),
  entryField("education", "sr-edu-from", "Education entry: start date (YYYY-MM-DD)", true),
  entryField("education", "sr-edu-to", "Education entry: end date (YYYY-MM-DD)", true),
];
const ENTRY_SELECTOR = /^\[data-sa-entry="(experience|education)"\]\[id="([^"]+)"\]$/;

/**
 * Add one experience or education entry: "Add", each part typed (search boxes keep free text; a suggestion that is
 * exactly the text is clicked), month pickers typed as digits, "I currently work here" for a current role, then
 * "Save", which must close the entry form, or the run stops naming what the form marks.
 */
async function fillEntry(page: Page, section: Section, parts: Map<string, string>) {
  const add = page.locator(`oc-button[data-test=add-${section}] spl-button`).first();
  await centre(add);
  await add.click({ timeout: 5000 });
  const form = page.locator(`[data-test=${section}-edit-form]`).first();
  await form.waitFor({ timeout: 8000 });
  const typeIn = async (where: string, text: string | undefined, search: boolean) => {
    if (!text) return;
    const input = form.locator(`${where} input, ${where} textarea`).first();
    await centre(input);
    await input.click({ timeout: 5000 });
    await input.fill("");
    await input.pressSequentially(text.slice(0, 200), { delay: 15 });
    if (search) {
      // These boxes keep only a picked suggestion (leaving the box clears it), and they echo the typed text back as one
      // ("AI Engineer"), after about 1.5 s: wait for the list, then click the best match (17 Nov, Rodeo FX).
      const options = page.locator(OPTIONS).filter({ hasNotText: /^\s*no matches\s*$/i });
      await options.first().waitFor({ timeout: 5000 }).catch(() => undefined);
      const texts = (await options.allInnerTexts().catch(() => [] as string[])).map((option) => option.replace(/\s+/g, " ").trim());
      const index = pickIndex(texts, text);
      if (index < 0) throw new Error(`the ${section} entry's list offers nothing like "${text.slice(0, 40)}" (it shows: ${texts.slice(0, 4).join(" | ")})`);
      await options.nth(index).click({ timeout: 5000 });
      await page.waitForTimeout(300);
    }
    const now = ((await input.inputValue().catch(() => "")) ?? "").trim();
    if (!now) throw new Error(`the ${section} entry's box kept nothing for "${text.slice(0, 30)}"`);
  };
  const dateIn = async (which: "from" | "to", iso: string) => {
    const box = form.locator(`oc-datepicker[data-test=${section}-date-${which}] input`).first();
    await centre(box);
    await box.click({ timeout: 5000 });
    await box.fill("");
    // Typed with its dashes: bare digits ("20260501") are read as 2030-02 (probed 17 Nov); "2026-05-01" holds.
    await box.pressSequentially(iso.slice(0, 10), { delay: 40 });
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    const now = ((await box.inputValue().catch(() => "")) ?? "").trim();
    if (!now.startsWith(iso.slice(0, 7))) throw new Error(`the ${section} ${which} date shows "${now}" instead of ${iso.slice(0, 7)}`);
  };
  const id = section === "experience" ? "exp" : "edu";
  if (section === "experience") {
    await typeIn("spl-autocomplete[data-test=job-title-autocomplete]", parts.get("sr-exp-title"), true);
    await typeIn("spl-autocomplete[data-test=company-autocomplete]", parts.get("sr-exp-company"), true);
    const about = parts.get("sr-exp-description");
    if (about) await form.locator("oc-textarea[data-test=experience-description] textarea").first().fill(about);
  } else {
    await typeIn("spl-autocomplete[data-test=institution-autocomplete]", parts.get("sr-edu-school"), true);
    await typeIn("oc-input[data-test=education-major]", parts.get("sr-edu-major"), false);
    await typeIn("oc-input[data-test=education-degree]", parts.get("sr-edu-degree"), false);
  }
  const from = parts.get(`sr-${id}-from`);
  const to = parts.get(`sr-${id}-to`);
  if (from) await dateIn("from", from);
  if (to && /^present$/i.test(to)) {
    const current = form.locator(`oc-checkbox[data-test=${section}-current] spl-checkbox`).first();
    await centre(current);
    await current.locator("input[type=checkbox]").first().click({ timeout: 5000, force: true }).catch(() => current.click({ timeout: 5000, position: { x: 8, y: 8 } }));
    await page.waitForTimeout(300);
  } else if (to) await dateIn("to", to);
  const save = form.locator(`oc-button[data-test=${section}-save] spl-button`).first();
  await centre(save);
  await save.click({ timeout: 5000 });
  const closed = await form.waitFor({ state: "detached", timeout: 6000 }).then(() => true, () => false);
  if (!closed) {
    const marks = ((await form.evaluate((node) => (node.textContent ?? "").replace(/\s+/g, " ")).catch(() => "")) as string).match(/[^.]*(required|invalid|must)[^.]*/i)?.[0]?.trim();
    throw new Error(`the ${section} entry was not saved${marks ? ` (the form says: ${marks.slice(0, 80)})` : ""}`);
  }
}

/** A typed value must still be in the box after typing. */
async function readBack(input: Locator, expected: string) {
  const now = ((await input.inputValue().catch(() => "")) ?? "").trim();
  const digits = (text: string) => text.replace(/\D/g, "");
  if (!now || (expected.length <= 60 && digits(expected).length > 0 && !digits(now).endsWith(digits(expected).slice(-10)) && now !== expected.trim())) throw new Error(`the box kept "${now.slice(0, 30)}" instead of the answer`);
}

// A visible choice in an open list: SmartRecruiters' spl-select-option (the location box, dropdowns).
const OPTIONS = "spl-select-option:visible";

const centre = (locator: Locator) => locator.evaluate((element) => element.scrollIntoView({ block: "center" })).catch(() => undefined);
const norm = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();

function pickIndex(options: string[], wanted: string) {
  const target = norm(wanted);
  const list = options.map(norm);
  const exact = list.indexOf(target);
  if (exact >= 0) return exact;
  const starts = list.findIndex((option) => option.startsWith(target) || target.startsWith(option));
  return starts >= 0 ? starts : list.findIndex((option) => option.includes(target));
}

/** The phone component's own number box: the national number only (its country picker starts on the IP's country). */
function nationalNumber(value: string) {
  const digits = value.replace(/[^\d+]/g, "");
  return digits.replace(/^\+?91(?=\d{10}$)/, "").replace(/^0(?=\d{10}$)/, "");
}

/** A location search: typed key by key, then the first suggestion that starts with the city. */
async function fillAutocomplete(page: Page, element: Locator, value: string) {
  const input = element.locator("input").first();
  await centre(input);
  await input.fill("");
  const city = value.split(",")[0].trim();
  await input.pressSequentially(city, { delay: 40 });
  // The suggestions are spl-select-option components ("Mohali, Punjab, India"); their role=option wrappers have no text.
  const option = page.locator(OPTIONS).filter({ hasText: new RegExp(`^\\s*${city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i") }).first();
  await option.waitFor({ timeout: 10000 }).catch(() => undefined);
  if (!(await option.isVisible().catch(() => false))) throw new Error(`no place matching "${city}" in the location list`);
  const picked = (await option.innerText()).replace(/\s+/g, " ").trim();
  await option.click({ timeout: 5000 });
  await page.waitForTimeout(400);
  if (!norm(await input.inputValue().catch(() => "")).includes(norm(city))) throw new Error(`the location box kept "${(await input.inputValue().catch(() => "")).slice(0, 30)}"`);
  return picked;
}

/** A choice component: its option clicked by visible text, then checked. */
async function fillChoice(page: Page, element: Locator, value: ResolvedValue) {
  // Choices are one per line (lib/choices). Options hold commas ("Other production management, HR, finance, or
  // business platforms", Rodeo FX, 17 Nov): split on commas, each piece clicked the same option again and unticked it.
  // A comma split is only a fallback for an older joined answer that matches no option whole.
  const wanted = value.type === "checkbox-group" ? splitChoices(value.value) : [value.value];
  const picked: string[] = [];
  const multi = (await element.evaluate((node) => node.tagName.toLowerCase())) === "spl-multiselect-autocomplete";
  const splitLater = (choice: string) => {
    if (value.type !== "checkbox-group" || !choice.includes(",")) return false;
    wanted.push(...choice.split(/\s*,\s*/).filter(Boolean));
    return true;
  };
  for (let at = 0; at < wanted.length; at += 1) {
    const choice = wanted[at];
    if (value.type === "select" || multi) {
      // A dropdown question (spl-select, or a screening spl-autocomplete): open it from its input, pick the option.
      const opener = element.locator("input").first();
      await centre(opener);
      await ((await opener.count()) ? opener : element).click({ timeout: 5000 });
      const options = page.locator(OPTIONS).filter({ hasNotText: /cannot find your|^\s*no matches\s*$/i });
      await options.first().waitFor({ timeout: 5000 });
      let texts = (await options.allInnerTexts()).map((text) => text.replace(/\s+/g, " ").trim());
      let index = pickIndex(texts, choice);
      if (index < 0 && (await opener.count())) {
        // Not among the rows drawn (a long list): type it to filter the list down, then pick.
        await opener.pressSequentially(choice.slice(0, 30), { delay: 40 });
        await page.waitForTimeout(800);
        texts = (await options.allInnerTexts()).map((text) => text.replace(/\s+/g, " ").trim());
        index = pickIndex(texts, choice);
      }
      if (index < 0 || picked.includes(texts[index])) {
        await page.keyboard.press("Escape").catch(() => undefined);
        if (index >= 0 || splitLater(choice)) continue; // already picked: a second click would undo it
        throw new Error(`No option "${choice}" for "${value.label}" (the list shows: ${texts.slice(0, 6).join(" | ")})`);
      }
      const optionId = multi ? await options.nth(index).getAttribute("value") : null;
      await options.nth(index).click({ timeout: 5000 });
      await page.waitForTimeout(300);
      if (multi) {
        // A multi-select keeps its picks as option ids in its own `value` ("5fc47d07-...", Avaloq): the pick must be there.
        const held = (await element.getAttribute("value")) ?? "";
        if (!held || (optionId && !held.includes(optionId))) throw new Error(`"${texts[index]}" was not added to "${value.label.slice(0, 40)}"`);
        await page.keyboard.press("Escape").catch(() => undefined);
        picked.push(texts[index]);
        continue;
      }
      const shown = ((await opener.inputValue().catch(() => "")) ?? "").trim();
      if ((await opener.count()) && norm(shown) !== norm(texts[index])) throw new Error(`the box kept "${shown.slice(0, 30)}" instead of "${texts[index].slice(0, 30)}"`);
      picked.push(texts[index]);
      continue;
    }
    // Radios and checkboxes carry their text as a `label` attribute ("Yes", "No"), not as inner text.
    const items = element.locator("spl-radio, spl-checkbox");
    const texts = (await items.evaluateAll((nodes) => nodes.map((node) => (node.getAttribute("label") ?? node.textContent ?? "").replace(/\s+/g, " ").trim())));
    const index = pickIndex(texts, choice);
    if (index >= 0 && picked.includes(texts[index])) continue; // already ticked: a second click would untick it
    if (index < 0) {
      if (splitLater(choice)) continue;
      throw new Error(`No option "${choice}" for "${value.label}" (the form shows: ${texts.slice(0, 6).join(" | ")})`);
    }
    const item = items.nth(index);
    // Selected: the radio's own state, its input, or the group's value naming it. Polled: the group settles late.
    const isOn = async () => {
      if ((await item.getAttribute("aria-checked")) === "true" || (await item.getAttribute("checked")) !== null) return true;
      if (await item.locator("input").first().isChecked().catch(() => false)) return true;
      const groupValue = (await element.getAttribute("value")) ?? "";
      const own = (await item.getAttribute("value")) ?? texts[index];
      return groupValue !== "" && (groupValue === own || norm(groupValue) === norm(texts[index]));
    };
    const until = async (ms: number) => {
      for (const end = Date.now() + ms; Date.now() < end; await page.waitForTimeout(150)) if (await isOn()) return true;
      return isOn();
    };
    // A click on a radio right after a number box was typed into was swallowed twice on Bosch (17 Nov) though the same
    // click works on a fresh page: each way is tried in turn, and checked, until the radio holds.
    const ways: Array<() => Promise<unknown>> = [
      () => item.click({ timeout: 5000 }),
      () => item.click({ timeout: 5000, position: { x: 12, y: 10 } }), // the circle itself
      async () => {
        await item.focus();
        await page.keyboard.press("Space");
      },
      () => item.evaluate((node) => (node as HTMLElement).click()),
    ];
    let held = false;
    for (const way of ways) {
      await centre(item);
      await way().catch(() => undefined);
      if ((held = await until(1500))) break;
    }
    if (!held) {
      const state = await element.evaluate((node) => `group value="${node.getAttribute("value")}"; ` + Array.from(node.querySelectorAll("spl-radio, spl-checkbox")).map((radio) => `${radio.getAttribute("label")}:${radio.getAttribute("aria-checked")}`).join(" "));
      throw new Error(`"${texts[index]}" did not stay selected (${state})`);
    }
    picked.push(texts[index]);
  }
  return picked.join(", ");
}

async function fillOne(page: Page, value: ResolvedValue) {
  const element = page.locator(value.selector).first();
  const tag = (await element.evaluate((node) => node.tagName.toLowerCase())) as string;
  if (tag === "spl-autocomplete" && value.type === "combobox") return fillAutocomplete(page, element, value.value);
  if (tag === "spl-select" || tag === "spl-autocomplete" || tag === "spl-multiselect-autocomplete" || tag === "spl-radio-group" || tag === "spl-checkbox-group") return fillChoice(page, element, value);
  if (tag === "spl-checkbox") {
    const want = /^(yes|true|y|1|agree|i agree|accept|accepted|checked)$/i.test(value.value.trim());
    // Anything but a clear yes or no is a wrong value, not a "no": a box left unticked that way stopped Submit.
    if (!want && !/^(no|false|n|0|unchecked)$/i.test(value.value.trim())) throw new Error(`"${value.value.slice(0, 40)}" is not a yes or a no for a box`);
    if (!want && value.required) throw new Error("a required box was answered No, so the form cannot be sent");
    const checked = async () => (await element.getAttribute("value")) === "true" || (await element.getAttribute("aria-checked")) === "true" || (await element.locator("input[type=checkbox]").first().isChecked().catch(() => false));
    // The box itself first, not the label's centre: a consent label carries the privacy-notice link, and a click there
    // opens the notice instead of ticking (17 Nov, QAD and NielsenIQ).
    const box = element.locator("input[type=checkbox]").first();
    const clicks = [() => box.click({ timeout: 5000, force: true }), () => element.click({ timeout: 5000, position: { x: 8, y: 8 } }), () => element.click({ timeout: 5000 })];
    for (const click of clicks) {
      if ((await checked()) === want) break;
      await centre(element);
      await click().catch(() => undefined);
      await page.waitForTimeout(250);
    }
    for (const extra of page.context().pages()) if (extra !== page) await extra.close().catch(() => undefined);
    if ((await checked()) !== want) throw new Error(`the box stayed ${want ? "unticked" : "ticked"}`);
    return want ? "Yes" : "No";
  }
  const input = element.locator(tag === "spl-textarea" ? "textarea" : tag === "spl-phone-field" ? "input[type=tel], input:not([type=hidden])" : "input").last();
  await centre(input);
  // A profile link with a typographic dash ("nitin–n", read from a resume) is refused by SmartRecruiters ("cannot
  // contain following characters: –", 17 Nov); a real profile address only ever has a plain hyphen.
  const isLink = /^(linkedin|portfolio|website|github)$/.test(value.key) || /linkedin|website|url|link|github|portfolio/i.test(value.label);
  const text = value.key === "phone" ? nationalNumber(value.value) : isLink ? value.value.replace(/[‐-―−]/g, "-").trim() : value.value;
  await input.fill("");
  await input.fill(text);
  await input.press("Tab").catch(() => undefined);
  await readBack(input, text);
  return text;
}

/** Attach the resume to the form's resume dropzone and wait for its name to show (SmartRecruiters uploads it at once). */
async function attachFile(page: Page, value: ResolvedValue, bytes: Uint8Array) {
  const name = value.fileName ?? "resume.pdf";
  const dir = await mkdtemp(join(tmpdir(), "swipeapply-"));
  const cleanup = async () => {
    await rm(dir, { recursive: true, force: true });
  };
  try {
    const file = join(dir, name);
    await writeFile(file, bytes);
    const zone = page.locator(value.selector).first();
    const uploaded = page.waitForResponse((response) => /\/oneclick-ui\/api\/company\/[^/]+\/attachment\/resume/.test(response.url()), { timeout: 60000 }).catch(() => null);
    await zone.locator("input[type=file]").first().setInputFiles(file);
    const answer = await uploaded;
    if (answer && answer.status() >= 400) throw new Error(`SmartRecruiters refused the file (${answer.status()})`);
    await page.waitForFunction((fileName) => document.body.innerText.toLowerCase().includes(fileName.toLowerCase().slice(0, 20)), name, { timeout: 30000 }).catch(() => undefined);
    return cleanup;
  } catch (error) {
    await cleanup();
    throw new Error(`Resume upload failed: ${error instanceof Error ? error.message.split("\n")[0] : "no confirmation"}`);
  }
}

/** The primary button at the bottom of the form, by its text (Next, Submit, Apply). */
function primaryButton(page: Page, text: RegExp) {
  return page.locator("spl-button[type=primary], button[type=submit], spl-button").filter({ hasText: text }).last();
}

/** Page 1 filled: Next, then the screening questions it shows (null when it goes straight to Submit). */
async function nextStep(page: Page): Promise<FormField[] | null> {
  const state = seen.get(page);
  if (!state) return null;
  // Questions an answer revealed on this page ("Yes" to English proficiency → its spoken and written levels, Rodeo FX,
  // 17 Nov) are read and answered before moving on; each such round is numbered apart.
  await page.waitForTimeout(600);
  state.round += 1;
  const revealed = await readComponents(page, state.page1, 1000 * (state.round + 1));
  if (revealed.length > 0) return revealed;
  if (state.step > 0) return null;
  state.step = 1;
  const next = primaryButton(page, /^\s*next\s*$/i);
  if (!(await next.isVisible().catch(() => false))) return null;
  await centre(next);
  await next.click({ timeout: 10000 });
  // The page re-renders: wait for Next to go, or for the form's own error lines when page 1 is not accepted.
  await page.waitForFunction(() => !Array.from(document.querySelectorAll("spl-button")).some((b) => /^\s*next\s*$/i.test((b as HTMLElement).innerText)), undefined, { timeout: 15000 }).catch(() => undefined);
  if (await next.isVisible().catch(() => false)) {
    const errors = await page.locator("[role=alert]:visible, .error:visible, spl-form-field [slot=error]:visible").allInnerTexts().catch(() => [] as string[]);
    throw new NotSentError(`SmartRecruiters did not accept the first page: ${errors.map((e) => e.trim()).filter(Boolean).slice(0, 4).join("; ") || "Next did nothing"}`);
  }
  await page.waitForTimeout(1500);
  state.round += 1;
  return readComponents(page, state.page1, 1000 * (state.round + 1));
}

export const CONFIRMATION = /thank you for (applying|your application|your interest)|application (has been |was )?(successfully )?(submitted|sent|received)|we('| ha)ve received your application|you('| ha)ve (already|successfully) applied/i;

async function successShown(page: Page) {
  if (/\/(success|confirmation|thank)/i.test(page.url())) return `url ${page.url()}`;
  const text = await page.locator("body").innerText().catch(() => "");
  const match = text.match(CONFIRMATION);
  return match && !(await page.locator("spl-input#first-name-input").isVisible().catch(() => false)) ? `text "${match[0]}"` : null;
}

export type SmartRecruitersReply = { kind: "sent" | "refused" | "unknown"; status: number; reason: string };

/** SmartRecruiters' answer to the application POST: 2xx is sent; 4xx a refusal with its words (or a duplicate: sent). */
export function readReply(status: number, body: string): SmartRecruitersReply {
  let reason = "";
  try {
    const json = JSON.parse(body) as Record<string, unknown>;
    const pick = (value: unknown): string => (typeof value === "string" ? value : Array.isArray(value) ? value.map(pick).filter(Boolean).join("; ") : value && typeof value === "object" ? Object.values(value).map(pick).filter(Boolean).join("; ") : "");
    reason = pick(json.message ?? json.errors ?? json.error ?? "");
  } catch {
    reason = "";
  }
  reason = reason.replace(/\s+/g, " ").trim().slice(0, 160);
  if (/already applied|already (submitted|exists)|duplicate/i.test(reason)) return { kind: "sent", status, reason };
  if (status >= 200 && status < 300) return { kind: "sent", status, reason };
  if (status >= 400 && status < 500) return { kind: "refused", status, reason };
  return { kind: "unknown", status, reason };
}

const AUTO_WAIT_MS = 90000;
const PERSON_WAIT_MS = 15 * 60 * 1000;

// The questions the form itself marks as wrong after Submit ("This field is required.", "Value is required"): each
// field component in an error state, by its question text. A string, not a function: tsx's `__name` helper does not
// exist in the page.
const FORM_ERRORS = String.raw`(() => {
  const out = [];
  const roots = [document];
  const tags = /^SPL-(INPUT|TEXTAREA|SELECT|AUTOCOMPLETE|PHONE-FIELD|RADIO-GROUP|CHECKBOX-GROUP|CHECKBOX|NUMBER-FIELD|DATEPICKER|DATE-PICKER|DROPZONE)$/;
  while (roots.length > 0) {
    const root = roots.pop();
    for (const el of Array.from(root.querySelectorAll("*"))) {
      if (el.shadowRoot) roots.push(el.shadowRoot);
      if (!tags.test(el.tagName)) continue;
      const shadowText = el.shadowRoot ? el.shadowRoot.textContent || "" : "";
      const flagged = el.hasAttribute("errorstate") || el.getAttribute("aria-invalid") === "true" || /is required|required\.|invalid|must be/i.test(shadowText.replace(/\s+/g, " "));
      const r = el.getBoundingClientRect();
      if (!flagged || !(r.width > 0 && r.height > 0)) continue;
      const slot = el.querySelector(":scope > [slot=label-content]");
      const label = (el.getAttribute("label") || (slot ? slot.textContent : "") || el.getAttribute("aria-label") || el.tagName.toLowerCase()).replace(/\s+/g, " ").trim();
      if (label && out.indexOf(label) < 0) out.push(label.slice(0, 80));
    }
  }
  return out;
})()`;

/** The form's own error marks, for the message when Submit sent nothing. */
async function formErrors(page: Page) {
  const labels = (await page.evaluate(FORM_ERRORS).catch(() => [])) as string[];
  return labels.length ? ` (the form marks: ${labels.slice(0, 4).map((label) => `"${label}"`).join(", ")})` : "";
}

async function submitSmartRecruiters(page: Page, ctx: SubmitContext): Promise<SubmitResult> {
  await dismissOverlays(page);
  // Past page 1 already (nextStep), or a form with one page: the last primary button sends it.
  const button = primaryButton(page, /submit|apply|send/i);
  if (!(await button.isVisible().catch(() => false))) throw new NoRetryError("The Submit button never appeared on the SmartRecruiters form. Open the form and submit it yourself.");
  let posted = false;
  const stopWatching = smartRecruitersAdapter.watchSubmit!(page, () => {
    posted = true;
  });
  let reply: SmartRecruitersReply | null = null;
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
    if (!ctx.handoff || !canShowWindow()) throw new BotCheckError(`${what}. Nothing was sent.`);
    withPerson = true;
    deadline = Date.now() + PERSON_WAIT_MS;
    await ctx.announceHandoff?.(`${what}: finish it in the Chrome window on your computer, then press Submit`);
  };
  try {
    await page.bringToFront().catch(() => undefined);
    if (withPerson) await ctx.announceHandoff?.("Check the SmartRecruiters form in the Chrome window on your computer and press Submit");
    else {
      try {
        await centre(button);
        await button.click({ timeout: 15000 });
      } catch (error) {
        throw new NotSentError(`Could not press Submit on the SmartRecruiters form: ${friendlyError(error)}`);
      }
    }
    for (;;) {
      const answer = reply as SmartRecruitersReply | null;
      if (answer?.kind === "sent") return { confirmed: true, evidence: `SmartRecruiters answered ${answer.status} to the application${answer.reason ? `: ${answer.reason}` : ""}` };
      if (answer?.kind === "refused") throw new NotSentError(`SmartRecruiters refused the application (${answer.status}${answer.reason ? `: ${answer.reason}` : ""}). Nothing was sent.`);
      const live = livePage(page);
      if (!live) {
        if (posted) throw new MaybeSentError("The SmartRecruiters window closed after the form was sent, before it answered. Check your email before applying again.");
        throw new WindowClosedError("The SmartRecruiters window was closed before the form was sent. Nothing was sent.");
      }
      const evidence = posted ? await successShown(live) : null;
      if (evidence) return { confirmed: true, evidence };
      if (!posted && !withPerson && (await blocked(live)) === "challenge") await askPerson("SmartRecruiters' DataDome showed a challenge");
      if (Date.now() >= deadline) {
        if (posted) throw new MaybeSentError("Submit was pressed but SmartRecruiters did not answer. Check your email before applying again.");
        if (!withPerson) {
          await askPerson(`Nothing reached SmartRecruiters after the worker pressed Submit${await formErrors(live)}`);
          continue;
        }
        throw new NotSentError("Submit was not pressed within 15 minutes. Nothing was sent; press Retry when you are ready.");
      }
      if (await ctx.cancelled?.()) {
        if (posted) throw new MaybeSentError("Cancelled after the form was sent to SmartRecruiters, before it answered. Check your email before applying again.");
        throw new WindowClosedError("Cancelled by you before the form was sent. Nothing was sent.");
      }
      await live.waitForTimeout(1000).catch(() => undefined);
    }
  } finally {
    stopWatching();
    context.off("response", onResponse);
  }
}

export const smartRecruitersAdapter: AtsAdapter = {
  source: "smartrecruiters",
  matches(url: string) {
    return /^https:\/\/(jobs|careers)\.smartrecruiters\.com\//i.test(url);
  },
  // Upload first: the form may fill fields from the resume; our values are typed after.
  uploadFirst: true,
  uploadFile: attachFile,
  inspect(page: Page) {
    return readFields(page);
  },
  async fill(page, values) {
    const filled: FilledField[] = [];
    await dismissOverlays(page);
    const entries = new Map<Section, ResolvedValue[]>();
    for (const value of values) {
      if (value.type === "file") continue;
      const entry = value.selector.match(ENTRY_SELECTOR);
      if (entry) {
        entries.set(entry[1] as Section, [...(entries.get(entry[1] as Section) ?? []), value]);
        continue;
      }
      const written = await inField(value.label, () => fillOne(page, value));
      filled.push({ key: value.key, label: value.label, value: written, source: value.source, selector: value.selector, basis: value.basis });
    }
    for (const [section, parts] of entries) {
      await inField(`${section} entry`, () => fillEntry(page, section, new Map(parts.map((part) => [part.selector.match(ENTRY_SELECTOR)![2], part.value]))));
      for (const part of parts) filled.push({ key: part.key, label: part.label, value: part.value, source: part.source, selector: part.selector, basis: part.basis });
    }
    return filled;
  },
  nextStep,
  watchSubmit(page: Page, onSubmit: () => void) {
    const context = page.context();
    let fired = false;
    const onRequest = (request: Request) => {
      if (fired || request.method() !== "POST" || !APPLY_POST.test(request.url())) return;
      fired = true;
      onSubmit();
    };
    context.on("request", onRequest);
    return () => context.off("request", onRequest);
  },
  confirmation(page: Page) {
    return successShown(page);
  },
  submit: submitSmartRecruiters,
};
