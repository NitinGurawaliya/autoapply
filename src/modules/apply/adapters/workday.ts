import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Locator, Page } from "playwright";
import { runAccountStep, type AccountOutcome, type AccountPage } from "../accountStep";
import { MaybeSentError, NeedsAnswerError, RefusedError, type AtsAdapter, type FilledField, type FormField, type ResolvedValue } from "../adapter";

/**
 * Workday (Phase U, U4; docs/accounts/TDD.md 4.6). "Apply Manually" is a wizard behind an employer account: Create
 * Account/Sign In, My Information, My Experience, Application Questions, Voluntary Disclosures, (Self Identify), Review.
 * Every question is a `[data-automation-id^="formField-"]` block; the footer's `pageFooterNextButton` is "Save and
 * Continue" on each page and "Submit" on Review. Element ids checked live on 21-23 Nov (Cotality, wd115): the sign-up and
 * sign-in buttons sit under a `click_filter` layer that takes the click, and `beecatcher` is a decoy input for robots
 * that is never filled. Runs in the stealthy Chrome (browser.ts) with the worker's own clicks at a person's pace.
 */

const HOST = /^[a-z0-9-]+\.wd\d{1,3}\.myworkdayjobs\.com$/i;
const id = (name: string) => `[data-automation-id="${name}"]`;
const FIELD = "data-swipe-field";
const ERRORS = [id("errorMessage"), id("inputAlert"), "[role='alert']"].join(", ");
const TYPE_DELAY = 25;

/** The employer an account belongs to: the tenant, the first label of `{tenant}.wdN.myworkdayjobs.com`. */
export function workdayTenant(url: string) {
  return new URL(url).hostname.split(".")[0].toLowerCase();
}

/** The posting's "Apply Manually" page: `{posting}/apply/applyManually`, query and any apply path dropped. */
export function workdayFormUrl(applyUrl: string) {
  const url = new URL(applyUrl);
  url.search = "";
  url.hash = "";
  url.pathname = `${url.pathname.replace(/\/+$/, "").replace(/\/apply(\/.*)?$/, "")}/apply/applyManually`;
  return url.toString();
}

/** What a sign-in or sign-up said, from its own words (exported for workday-test). */
export function readAccountMessage(text: string): AccountOutcome | null {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return null;
  // Phrases only: the Create Account form's own label "Verify New Password" must not read as a verify-your-email message
  // (23 Nov dry run: it did, before any message was shown).
  if (/verify your (email|account|e-mail)|verification (email|link|code)|activate your account|account (is )?not (yet )?(verified|activated)|sent (you )?an? (email|link|verification)|check your (email|inbox)/i.test(t)) return "verify";
  if (/already (exists|in use|registered|been used)|account (with|for) this email|email address is (already|in use)/i.test(t)) return "exists";
  if (/password/i.test(t) && /(requirement|must|invalid|incorrect|wrong|not meet|doesn.t meet|does not match)/i.test(t)) return "refused";
  if (/incorrect|invalid (email|credentials|sign)|wrong|locked/i.test(t)) return "refused";
  return { error: t.slice(0, 200) };
}

const norm = (text: string) => text.replace(/\*/g, "").replace(/\s+/g, " ").trim().toLowerCase();

async function visible(page: Page, selector: string) {
  return page.locator(selector).first().isVisible().catch(() => false);
}

async function errorText(page: Page) {
  const texts = await page.locator(ERRORS).allInnerTexts().catch(() => [] as string[]);
  // Workday announces good news in the same alert role ("resume.pdf successfully uploaded", 23 Nov): not an error.
  return texts.map((text) => text.trim()).filter((text) => text && !/successfully|uploaded$/i.test(text)).join(" | ");
}

async function typeInto(input: Locator, value: string) {
  await input.click();
  await input.fill("");
  await input.pressSequentially(value, { delay: TYPE_DELAY });
}

/** The button behind Workday's `click_filter` layer: the layer takes the click, as a person's click would land on it. */
async function pressGuarded(page: Page, button: string) {
  const layer = page.locator(`${id("noCaptchaWrapper")} ${id("click_filter")}`).first();
  if (await layer.isVisible().catch(() => false)) await layer.click();
  else await page.locator(id(button)).first().click();
}

async function accountOutcome(page: Page, timeoutMs = 30000): Promise<AccountOutcome> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    await page.waitForTimeout(1000);
    if ((await visible(page, id("pageFooterNextButton"))) && !(await visible(page, id("signInContent")))) return "in";
    const said = readAccountMessage(await errorText(page));
    if (said) return said;
    // A verify-your-email message can come as a page or a dialog, not an alert.
    const box = await page.locator(`${id("signInContent")}, [role='dialog']`).first().innerText().catch(() => "");
    const verdict = readAccountMessage(box);
    if (verdict === "verify") return verdict;
  }
  return { error: "did not answer within 30 seconds" };
}

function workdayAccountPage(page: Page): AccountPage {
  return {
    signedIn: async () => (await visible(page, id("pageFooterNextButton"))) && !(await visible(page, id("signInContent"))),
    signIn: async (email, password) => {
      if (!(await visible(page, id("signInSubmitButton")))) {
        await page.locator(id("signInLink")).first().click();
        await page.locator(id("signInSubmitButton")).first().waitFor({ state: "attached", timeout: 15000 });
      }
      await typeInto(page.locator(`${id("signInContent")} ${id("email")}`).first(), email);
      await typeInto(page.locator(`${id("signInContent")} ${id("password")}`).first(), password);
      await pressGuarded(page, "signInSubmitButton");
      return accountOutcome(page);
    },
    create: async (email, password, consent) => {
      if (!(await visible(page, id("createAccountSubmitButton")))) {
        await page.locator(id("createAccountLink")).first().click();
        await page.locator(id("createAccountSubmitButton")).first().waitFor({ state: "attached", timeout: 15000 });
      }
      await typeInto(page.locator(`${id("signInContent")} ${id("email")}`).first(), email);
      await typeInto(page.locator(`${id("signInContent")} ${id("password")}`).first(), password);
      await typeInto(page.locator(`${id("signInContent")} ${id("verifyPassword")}`).first(), password);
      const box = page.locator(id("createAccountCheckbox")).first();
      if (consent && (await box.count()) > 0 && !(await box.isChecked().catch(() => false))) await box.check({ force: true });
      await pressGuarded(page, "createAccountSubmitButton");
      return accountOutcome(page);
    },
  };
}

/** Reads the visible page's questions; each block gets a `data-swipe-field` index for its selector. */
async function readPage(page: Page): Promise<FormField[]> {
  // The footer shows before the page's questions are drawn (23 Nov dry run: My Information read as 0 fields).
  await page.locator('[data-automation-id^="formField-"], input[data-automation-id="file-upload-input-ref"]').first().waitFor({ state: "visible", timeout: 20000 }).catch(() => undefined);
  // Workday draws a page in stages (23 Nov: the radio group came after the first read): read once the number of
  // question blocks has held for a moment.
  let last = -1;
  for (let tries = 0; tries < 15; tries += 1) {
    await page.waitForTimeout(700);
    const count = await page.locator('[data-automation-id^="formField-"]').count();
    if (count === last && count > 0) break;
    last = count;
  }
  const raw = await page.evaluate((attr) => {
    // Each page has its own container (applyFlowMyInfoPage, ...): the whole body is read, the footer has no fields.
    const root = document.querySelector('[data-automation-id^="applyFlow"][data-automation-id$="Page"]') ?? document.body;
    const blocks = [...root.querySelectorAll<HTMLElement>('[data-automation-id^="formField-"]')].filter((el) => !el.parentElement?.closest('[data-automation-id^="formField-"]') && el.getClientRects().length > 0); // offsetParent is null for a display:contents fieldset (23 Nov: the radio group was dropped)
    // No named helpers in here: the bundler wraps them in __name, which the page does not have (23 Nov).
    const out: Array<{ index: number; label: string; type: string; required: boolean; options: string[]; auto: string }> = [];
    blocks.forEach((el, index) => {
      el.setAttribute(attr, String(index));
      const labelEl = el.querySelector("legend") ?? el.querySelector("label");
      const label = (labelEl?.textContent ?? el.getAttribute("aria-label") ?? "").replace(/\s+/g, " ").trim();
      const required = /\*/.test(label) || Boolean(el.querySelector('[aria-required="true"], [required]')) || /required/i.test(el.querySelector("button[aria-label]")?.getAttribute("aria-label") ?? "");
      const auto = el.getAttribute("data-automation-id") ?? "";
      const listbox = el.querySelector<HTMLElement>('button[aria-haspopup="listbox"]');
      const text = el.querySelector<HTMLInputElement>('input[type="text"], input:not([type]), input[type="email"], input[type="tel"]');
      let type = "text";
      let options: string[] = [];
      let answered = false;
      if (el.querySelector('input[type="file"]')) type = "file";
      else if (listbox) {
        type = "select";
        answered = !/select one/i.test(listbox.innerText) && listbox.innerText.trim() !== "";
      } else if (el.querySelector('[data-uxi-widget-type="selectinput"], [data-automation-id="multiselectInputContainer"], [data-automation-id="searchBox"]')) {
        type = "search";
        answered = Boolean(el.querySelector('[data-automation-id="selectedItem"]'));
      } else if (el.querySelector('input[type="radio"]')) {
        type = "radio";
        options = [...el.querySelectorAll('input[type="radio"]')].map((input) => ((input.id ? document.querySelector(`label[for="${CSS.escape(input.id)}"]`)?.textContent : null) ?? input.closest("div")?.querySelector("label")?.textContent ?? input.getAttribute("aria-label") ?? "").trim()).filter(Boolean);
        answered = Boolean(el.querySelector('input[type="radio"]:checked'));
      } else if (el.querySelectorAll('input[type="checkbox"]').length > 1) {
        type = "checkbox-group";
        options = [...el.querySelectorAll('input[type="checkbox"]')].map((input) => ((input.id ? document.querySelector(`label[for="${CSS.escape(input.id)}"]`)?.textContent : null) ?? input.closest("div")?.querySelector("label")?.textContent ?? input.getAttribute("aria-label") ?? "").trim()).filter(Boolean);
      } else if (el.querySelector('input[type="checkbox"]')) type = "checkbox";
      else if (el.querySelector('[data-automation-id^="dateSection"]')) {
        type = "date";
        const parts = [...el.querySelectorAll<HTMLInputElement>('input[data-automation-id^="dateSection"]')];
        answered = parts.length > 0 && parts.every((input) => input.value.trim() !== "" || Boolean(input.getAttribute("aria-valuenow")));
      }
      else if (el.querySelector("textarea")) {
        type = "textarea";
        answered = (el.querySelector("textarea")?.value ?? "").trim() !== "";
      } else if (!text) return;
      else answered = text.value.trim() !== "";
      // Workday fills some itself (Country, the account's email, a returning candidate's details): left as they are.
      if (answered) return;
      // A phone extension is never ours to fill (23 Nov: "Phone Extension" took the phone number by its label).
      if (/extension$/i.test(auto)) return;
      out.push({ index, label, type, required, options, auto });
    });
    // The resume input on My Experience is not always inside a formField block.
    const file = document.querySelector<HTMLInputElement>('input[data-automation-id="file-upload-input-ref"]');
    if (file && !out.some((field) => field.type === "file")) {
      const holder = (file.closest("section, div") ?? file) as HTMLElement;
      holder.setAttribute(attr, "file");
      out.push({ index: -1, label: "Resume/CV", type: "file", required: false, options: [], auto: "file-upload-input-ref" });
    }
    return out;
  }, FIELD);

  const fields: FormField[] = [];
  for (const field of raw) {
    const selector = field.index < 0 ? `[${FIELD}="file"]` : `[${FIELD}="${field.index}"]`;
    let options = field.options.length > 0 ? field.options : undefined;
    if (field.type === "select") options = await listboxOptions(page, selector).catch(() => undefined);
    fields.push({ selector, label: field.label.replace(/\*/g, "").trim(), type: field.type === "search" ? "text" : field.type, required: field.required, options, hintKey: hintFor(field.auto, field.type) });
  }
  const step = await activeStep(page);
  const seen = SEEN.get(page);
  if (!seen || seen.step !== step) SEEN.set(page, { step, labels: new Set(fields.map((field) => field.label)), retried: new Set() });
  else for (const field of fields) seen.labels.add(field.label);
  return fields;
}

/**
 * The questions already handed to the runner on the page now showing. A question that appears only once another is
 * answered (23 Nov, Cisco: "office # times per week") is found by reading the page again before Save and Continue;
 * a required one we filled that still reads empty is handed back once more.
 */
const SEEN = new WeakMap<Page, { step: string; labels: Set<string>; retried: Set<string> }>();

async function leftOnPage(page: Page): Promise<FormField[]> {
  const before = SEEN.get(page);
  const step = await activeStep(page);
  if (!before || before.step !== step) return [];
  const known = new Set(before.labels);
  const retried = before.retried;
  const fields = await readPage(page);
  return fields.filter((field) => {
    if (!known.has(field.label)) return true;
    if (!field.required || retried.has(field.label)) return false;
    retried.add(field.label);
    return true;
  });
}

/** Standard keys from Workday's own field ids, so name, contact and resume map without the model. */
function hintFor(auto: string, type: string): string | undefined {
  if (type === "file") return "resume";
  // Two spellings seen: `legalNameSection_firstName` (older tenants) and `legalName--firstName` (Cotality, 23 Nov).
  const rules: Array<[RegExp, string]> = [
    [/legalName(Section)?[-_]+firstName$/i, "first_name"],
    [/legalName(Section)?[-_]+lastName$/i, "last_name"],
    [/formField-email$/i, "email"],
    [/formField-phone-?number$/i, "phone"],
    [/formField-(addressSection_)?city$/i, "city"],
    [/countryDropdown|formField-country$/i, "country"],
    [/linkedin/i, "linkedin"],
  ];
  return rules.find(([pattern]) => pattern.test(auto))?.[1];
}

/**
 * The options of the dropdown a button just opened: the list its `aria-controls` names, else a visible popup list.
 * Not a prompt's own list of chosen items (`selectedItemList`): 23 Nov, the State dropdown read "India (+91)", the
 * phone code chosen in another box, as its first option.
 */
async function openedOptions(page: Page, button: Locator) {
  const controls = await button.getAttribute("aria-controls").catch(() => null);
  if (controls) {
    const owned = page.locator(`[id="${controls}"] [role="option"]`);
    if (await owned.first().isVisible({ timeout: 3000 }).catch(() => false)) return owned;
  }
  return page.locator('[role="listbox"]:visible:not([data-automation-id="selectedItemList"]) [role="option"]:not([data-automation-id="selectedItem"])');
}

async function listboxOptions(page: Page, selector: string): Promise<string[]> {
  const button = page.locator(`${selector} button[aria-haspopup="listbox"]`).first();
  await button.click();
  const list = await openedOptions(page, button);
  await list.first().waitFor({ state: "visible", timeout: 5000 });
  const options = (await list.allInnerTexts()).map((text) => text.trim()).filter((text) => text && !/^select one$/i.test(text));
  await page.keyboard.press("Escape");
  return [...new Set(options)];
}

function bestOption(options: string[], value: string) {
  const want = norm(value);
  return options.find((option) => norm(option) === want) ?? options.find((option) => norm(option).startsWith(want)) ?? options.find((option) => norm(option).includes(want) || want.includes(norm(option)));
}

async function fillOne(page: Page, value: ResolvedValue) {
  const block = page.locator(value.selector).first();
  switch (value.type) {
    case "select": {
      // The last dropdown's list must be gone before this one opens (23 Nov: a Yes/No question read the salary list
      // still on screen and found no "Yes").
      await page.locator('[role="listbox"]:visible:not([data-automation-id="selectedItemList"])').first().waitFor({ state: "hidden", timeout: 3000 }).catch(() => undefined);
      const opener = block.locator('button[aria-haspopup="listbox"]').first();
      await opener.scrollIntoViewIfNeeded().catch(() => undefined);
      await opener.click();
      const list = await openedOptions(page, opener);
      await list.first().waitFor({ state: "visible", timeout: 5000 });
      const options = (await list.allInnerTexts()).map((text) => text.trim()).filter(Boolean);
      const pick = bestOption(options, value.value);
      if (!pick) {
        await page.keyboard.press("Escape");
        throw new NeedsAnswerError({ key: value.key, label: value.label, type: "select", options: options.filter((option) => !/^select one$/i.test(option)), required: value.required ?? true });
      }
      await list.filter({ hasText: pick }).first().click();
      await list.first().waitFor({ state: "hidden", timeout: 3000 }).catch(() => undefined);
      // The box must show the choice (23 Nov, Cisco: "Internship/Co-Op? = No" did not stick): once more by keyboard.
      if (norm(await opener.innerText().catch(() => "")) !== norm(pick)) {
        await opener.click();
        const again = await openedOptions(page, opener);
        await again.filter({ hasText: pick }).first().click({ force: true }).catch(() => undefined);
        await page.waitForTimeout(600);
      }
      return;
    }
    case "radio": {
      // Only the radio buttons' own labels: the question is a label too, and "No" once matched "DXC TechNOlogy" in it
      // (23 Nov). The input is clicked natively, inside the page: Workday's label never settles for a click, and
      // Playwright's check did not register.
      const radios = block.locator('input[type="radio"]');
      const choices = await radios.evaluateAll((inputs) => inputs.map((input) => ((input.id ? document.querySelector(`label[for="${CSS.escape(input.id)}"]`)?.textContent : null) ?? input.getAttribute("aria-label") ?? "").trim()));
      const want = norm(value.value);
      const at = choices.findIndex((text) => norm(text) === want) >= 0 ? choices.findIndex((text) => norm(text) === want) : choices.findIndex((text) => norm(text).startsWith(want) || want.startsWith(norm(text)));
      if (at < 0) throw new NeedsAnswerError({ key: value.key, label: value.label, type: "radio", options: choices.filter(Boolean), required: value.required ?? true });
      await radios.nth(at).evaluate((input) => (input as HTMLInputElement).click());
      if (!(await radios.nth(at).isChecked().catch(() => false))) throw new Error(`Workday did not take "${choices[at]}" for "${value.label.slice(0, 60)}"`);
      return;
    }
    case "checkbox": {
      const box = block.locator('input[type="checkbox"]').first();
      if (/^(y|yes|true|checked|1)$/i.test(value.value.trim()) && !(await box.isChecked())) await box.check({ force: true });
      return;
    }
    case "checkbox-group": {
      for (const choice of value.value.split(/\n/).map((line) => line.trim()).filter(Boolean)) {
        const pick = bestOption(await block.locator("label").allInnerTexts(), choice);
        if (pick) await block.locator("label", { hasText: pick }).first().click();
      }
      return;
    }
    case "date": {
      const parsed = workdayDate(value.value);
      if (!parsed) throw new NeedsAnswerError({ key: value.key, label: `${value.label} (a date)`, type: "text", required: value.required ?? true });
      const { year, month, day } = parsed;
      const part = async (name: string, text: string | undefined) => {
        const input = block.locator(`[data-automation-id="${name}"]`).first();
        // A display layer sits over each date part (23 Nov: a click timed out): focus the input and type, as a keyboard does.
        if (text && (await input.count()) > 0) {
          await input.focus();
          await page.keyboard.type(text, { delay: TYPE_DELAY });
        }
      };
      await part("dateSectionMonth-input", month);
      await part("dateSectionDay-input", day);
      await part("dateSectionYear-input", year);
      return;
    }
    case "textarea":
      await typeInto(block.locator("textarea").first(), value.value);
      return;
    default: {
      // A search box ("How did you hear about us?", skills): type, Enter, then the matching suggestion.
      const search = block.locator('[data-uxi-widget-type="selectinput"], [data-automation-id="searchBox"] input, [data-automation-id="multiselectInputContainer"] input').first();
      if ((await search.count()) > 0) {
        await fillPrompt(page, block, search, value);
        return;
      }
      const input = block.locator('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([data-automation-id="beecatcher"])').first();
      // Workday asks the country code in its own box (Country Phone Code): the number goes in without it.
      // Workday checks a LinkedIn address as https://www.linkedin.com/... (23 Nov: "Invalid LinkedIn URL" without www).
      const text =
        value.key === "phone"
          ? value.value.replace(/^\s*\+\d{1,3}[\s-]*/, "").replace(/[\s-]/g, "")
          : /linkedin\.com/i.test(value.value)
            ? value.value.trim().replace(/^(https?:\/\/)?(www\.)?linkedin\.com/i, "https://www.linkedin.com")
            : value.value;
      await typeInto(input, text);
      await input.press("Tab");
    }
  }
}

/** The open popup's entries: never another box's chosen item, which Workday also marks as an option ("India (+91)"). */
async function promptEntries(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-automation-id="promptOption"]')]
      .filter((el) => (el as HTMLElement).getClientRects().length > 0 && !el.closest('[data-automation-id="selectedItem"], [data-automation-id="selectedItemList"]'))
      .map((el) => (el.textContent ?? "").trim())
      .filter(Boolean),
  );
}

/** Words shared with the answer, for a list whose wording differs ("Computer Science" for "Computer Science and Engineering"). */
function closestByWords(options: string[], value: string) {
  const want = new Set(norm(value).split(/[^a-z0-9]+/).filter((word) => word.length > 2));
  let best: string | undefined;
  let score = 0;
  for (const option of options) {
    const shared = norm(option).split(/[^a-z0-9]+/).filter((word) => want.has(word)).length;
    if (shared > score) [best, score] = [option, shared];
  }
  return best;
}

const HOW_HEARD = ["job board", "job portal", "job site", "online", "career site", "website", "linkedin", "naukri", "other"];

/**
 * A Workday prompt box ("How did you hear", Field of Study, skills): opened first, and the employer's own list chosen
 * from, following a list inside a list to the end (a category, then the source); only when the answer is not in that
 * list are its words typed as a search, the whole answer then shorter. 23 Nov: typing "Job" searched Workday's global
 * list of job sites (DXC), while opening the box showed DXC's own list with "Job Board".
 */
async function fillPrompt(page: Page, block: Locator, search: Locator, value: ResolvedValue) {
  const choose = (texts: string[]) =>
    bestOption(texts, value.value) ?? closestByWords(texts, value.value) ?? (value.key === "how_heard" ? HOW_HEARD.map((word) => texts.find((text) => norm(text).includes(word))).find(Boolean) : undefined);
  const chosen = async () => (await block.locator('[data-automation-id="selectedItem"]').count()) > 0;
  const click = async (text: string) => {
    // The popup's own layer takes pointer events over its entries; the last match is the popup's (a chosen item, if any,
    // comes first on the page).
    await page.locator('[data-automation-id="promptOption"]').filter({ hasText: text }).last().click({ force: true });
    await page.waitForTimeout(1200);
  };
  await search.click();
  await page.waitForTimeout(1500);
  let texts = await promptEntries(page);
  let pick = choose(texts);
  if (!pick) {
    const words = value.value.split(/\s+/).filter(Boolean);
    for (const query of [...new Set([value.value, words.slice(0, 2).join(" "), words[0]].filter(Boolean))]) {
      await typeInto(search, query);
      await page.keyboard.press("Enter");
      await page.waitForTimeout(1500);
      texts = await promptEntries(page);
      pick = choose(texts);
      if (pick) break;
    }
  }
  if (!pick) {
    await page.keyboard.press("Escape").catch(() => undefined);
    throw new NeedsAnswerError({ key: value.key, label: `${value.label} (nothing matched "${value.value.slice(0, 40)}")`, type: "text", required: value.required ?? true });
  }
  await click(pick);
  // A category opens its own list: the closest entry there, else the first, until the box shows a chosen item.
  for (let level = 0; level < 3 && !(await chosen()); level += 1) {
    const inner = await promptEntries(page);
    if (inner.length === 0) break;
    await click(choose(inner) ?? inner[0]);
  }
  await page.keyboard.press("Escape").catch(() => undefined);
  if (!(await chosen())) throw new Error(`Workday did not take "${pick}" for "${value.label.slice(0, 60)}"`);
}

async function activeStep(page: Page) {
  return (await page.locator(id("progressBarActiveStep")).first().innerText().catch(() => "")).replace(/\s+/g, " ").trim();
}

async function footerText(page: Page) {
  return (await page.locator(id("pageFooterNextButton")).first().innerText().catch(() => "")).trim();
}

export const workdayAdapter: AtsAdapter = {
  source: "workday",
  window: true,
  matches(url) {
    try {
      return HOST.test(new URL(url).hostname);
    } catch {
      return false;
    }
  },
  formUrl: ({ applyUrl }) => workdayFormUrl(applyUrl),

  async prepare(page, ctx) {
    const page1 = `${id("signInContent")}, ${id("pageFooterNextButton")}`;
    try {
      await page.locator(page1).first().waitFor({ state: "visible", timeout: 45000 });
    } catch {
      const text = await page.locator("body").innerText().catch(() => "");
      if (/doesn.t exist|no longer (available|accepting)|job (is )?(closed|filled)|not available/i.test(text)) throw new Error("This job is no longer open on Workday");
      throw new Error("Workday's application page did not load");
    }
    await runAccountStep(ctx, "workday", workdayTenant(page.url()), workdayAccountPage(page));
    await page.locator(id("pageFooterNextButton")).first().waitFor({ state: "visible", timeout: 30000 });
  },

  inspect: readPage,

  async uploadFile(page, value, bytes) {
    const dir = join(tmpdir(), `swipeapply-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    const path = join(dir, value.fileName ?? "resume.pdf");
    await fs.writeFile(path, bytes);
    const input = page.locator(`${value.selector} input[type="file"], input[data-automation-id="file-upload-input-ref"]`).first();
    await input.setInputFiles(path);
    // Workday shows the file once it is uploaded (and parses it into the page's sections on many tenants).
    await page.locator(`${id("file-upload-successful")}, ${id("file-upload-item")}`).first().waitFor({ state: "visible", timeout: 60000 }).catch(() => undefined);
    return async () => {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    };
  },
  attachesBySelector: true,

  async fill(page, values) {
    const filled: FilledField[] = [];
    for (const value of values) {
      if (value.type === "file") continue;
      await fillOne(page, value);
      filled.push({ key: value.key, label: value.label, value: value.value, source: value.source, selector: value.selector });
    }
    return filled;
  },

  // Save and Continue until a page with questions, or Review (null): the runner answers and fills each page.
  async nextStep(page) {
    for (let hop = 0; hop < 8; hop += 1) {
      // Questions that appeared after the answers on this page, or a required one that did not take: answered first.
      if (hop === 0) {
        const left = await leftOnPage(page);
        if (left.length > 0) return left;
      }
      if (/submit/i.test(await footerText(page))) return null;
      const before = await activeStep(page);
      await page.locator(id("pageFooterNextButton")).first().click();
      const until = Date.now() + 30000;
      let moved = false;
      while (Date.now() < until) {
        await page.waitForTimeout(1000);
        if ((await activeStep(page)) !== before) {
          moved = true;
          break;
        }
        const errors = await errorText(page);
        if (errors) throw new Error(`Workday did not accept "${before || "this page"}": ${errors.slice(0, 900)}`);
      }
      if (!moved) throw new Error(`Workday stayed on "${before || "this page"}" after Save and Continue`);
      await page.waitForTimeout(1500);
      if (/submit/i.test(await footerText(page))) return null;
      const fields = await readPage(page);
      if (fields.length > 0) return fields;
    }
    return null;
  },

  async submit(page, ctx) {
    // Pages with no questions left before Review are passed here (the runner stops calling nextStep at the first null).
    for (let hop = 0; hop < 6 && !/submit/i.test(await footerText(page)); hop += 1) {
      const before = await activeStep(page);
      await page.locator(id("pageFooterNextButton")).first().click();
      await page.waitForTimeout(3000);
      const errors = await errorText(page);
      if (errors && (await activeStep(page)) === before) throw new Error(`Workday did not accept "${before}": ${errors.slice(0, 900)}`);
    }
    if (!/submit/i.test(await footerText(page))) throw new Error("Workday's Review page with Submit did not appear");
    await ctx.markAttempted?.();
    await page.locator(id("pageFooterNextButton")).first().click();
    const until = Date.now() + 45000;
    while (Date.now() < until) {
      await page.waitForTimeout(1500);
      const body = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ");
      const said = /application (has been )?submitted|successfully submitted|congratulations|thank you for (your )?appl/i.exec(body);
      if (said || (await visible(page, id("congratulationsPopup")))) return { confirmed: true, evidence: `Workday: "${(said?.[0] ?? "Congratulations").slice(0, 80)}"` };
      const errors = await errorText(page);
      if (errors && /submit/i.test(await footerText(page))) throw new RefusedError(`Workday did not take the application: ${errors.slice(0, 200)}. Nothing was sent.`);
    }
    throw new MaybeSentError("Workday showed no confirmation after Submit");
  },

  async confirmation(page) {
    const body = await page.locator("body").innerText().catch(() => "");
    const said = /application (has been )?submitted|successfully submitted|congratulations/i.exec(body);
    return said ? `Workday: "${said[0]}"` : null;
  },
};

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * A date answer as Workday's parts (month, day and year inputs; education dates are often a year alone). Takes
 * 2026-06-30, 2026-06, 06/2026, "June 2026" and a bare year (23 Nov, Fractal: "2026" for "To (Actual or Expected)").
 */
export function workdayDate(text: string): { year: string; month?: string; day?: string } | null {
  const t = text.trim();
  let m = /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/.exec(t);
  if (m) return { year: m[1], month: m[2].padStart(2, "0"), day: m[3]?.padStart(2, "0") };
  m = /^(\d{1,2})\/(\d{4})$/.exec(t);
  if (m) return { year: m[2], month: m[1].padStart(2, "0") };
  m = /^([a-z]{3})[a-z]*\.?\s+(\d{4})$/i.exec(t);
  if (m && MONTHS.includes(m[1].toLowerCase())) return { year: m[2], month: String(MONTHS.indexOf(m[1].toLowerCase()) + 1).padStart(2, "0") };
  // Day first, as written in India (a date of birth saved as "06-08-2003", 23 Nov).
  m = /^(\d{1,2})[-./](\d{1,2})[-./](\d{4})$/.exec(t);
  if (m) return { year: m[3], month: m[2].padStart(2, "0"), day: m[1].padStart(2, "0") };
  m = /^(\d{4})$/.exec(t);
  if (m) return { year: m[1] };
  return null;
}
