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
  if (/verify|verification|activate your account|sent (you )?an? (email|link)|check your (email|inbox)/i.test(t)) return "verify";
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
  return texts.map((text) => text.trim()).filter(Boolean).join(" | ");
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
  const raw = await page.evaluate((attr) => {
    const root = document.querySelector('[data-automation-id="applyFlowPage"]') ?? document.body;
    const blocks = [...root.querySelectorAll<HTMLElement>('[data-automation-id^="formField-"]')].filter((el) => !el.parentElement?.closest('[data-automation-id^="formField-"]') && el.offsetParent !== null);
    const out: Array<{ index: number; label: string; type: string; required: boolean; options: string[]; auto: string }> = [];
    blocks.forEach((el, index) => {
      el.setAttribute(attr, String(index));
      const labelEl = el.querySelector("label, legend");
      const label = (labelEl?.textContent ?? el.getAttribute("aria-label") ?? "").replace(/\s+/g, " ").trim();
      const required = /\*/.test(label) || Boolean(el.querySelector('[aria-required="true"], [required]'));
      const auto = el.getAttribute("data-automation-id") ?? "";
      let type = "text";
      let options: string[] = [];
      if (el.querySelector('input[type="file"]')) type = "file";
      else if (el.querySelector('button[aria-haspopup="listbox"]')) type = "select";
      else if (el.querySelector('[data-uxi-widget-type="selectinput"], [data-automation-id="multiselectInputContainer"], [data-automation-id="searchBox"]')) type = "search";
      else if (el.querySelector('input[type="radio"]')) {
        type = "radio";
        options = [...el.querySelectorAll('input[type="radio"]')].map((input) => (input.closest("div")?.querySelector("label")?.textContent ?? input.getAttribute("aria-label") ?? "").trim()).filter(Boolean);
      } else if (el.querySelectorAll('input[type="checkbox"]').length > 1) {
        type = "checkbox-group";
        options = [...el.querySelectorAll('input[type="checkbox"]')].map((input) => (input.closest("div")?.querySelector("label")?.textContent ?? input.getAttribute("aria-label") ?? "").trim()).filter(Boolean);
      } else if (el.querySelector('input[type="checkbox"]')) type = "checkbox";
      else if (el.querySelector('[data-automation-id^="dateSection"]')) type = "date";
      else if (el.querySelector("textarea")) type = "textarea";
      else if (!el.querySelector("input")) return;
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
  return fields;
}

/** Standard keys from Workday's own field ids, so name, contact and resume map without the model. */
function hintFor(auto: string, type: string): string | undefined {
  if (type === "file") return "resume";
  const rules: Array<[RegExp, string]> = [
    [/legalNameSection_firstName/i, "first_name"],
    [/legalNameSection_lastName/i, "last_name"],
    [/formField-email/i, "email"],
    [/phone-?number/i, "phone"],
    [/addressSection_city/i, "city"],
    [/countryDropdown|formField-country$/i, "country"],
    [/linkedin/i, "linkedin"],
  ];
  return rules.find(([pattern]) => pattern.test(auto))?.[1];
}

async function listboxOptions(page: Page, selector: string): Promise<string[]> {
  const button = page.locator(`${selector} button[aria-haspopup="listbox"]`).first();
  await button.click();
  const list = page.locator('[role="listbox"] [role="option"]');
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
      await block.locator('button[aria-haspopup="listbox"]').first().click();
      const list = page.locator('[role="listbox"] [role="option"]');
      await list.first().waitFor({ state: "visible", timeout: 5000 });
      const options = (await list.allInnerTexts()).map((text) => text.trim()).filter(Boolean);
      const pick = bestOption(options, value.value);
      if (!pick) {
        await page.keyboard.press("Escape");
        throw new NeedsAnswerError({ key: value.key, label: value.label, type: "select", options: options.filter((option) => !/^select one$/i.test(option)), required: value.required ?? true });
      }
      await list.filter({ hasText: pick }).first().click();
      return;
    }
    case "radio": {
      const pick = bestOption(await block.locator("label").allInnerTexts(), value.value);
      if (!pick) throw new NeedsAnswerError({ key: value.key, label: value.label, type: "radio", options: (await block.locator("label").allInnerTexts()).map((text) => text.trim()).filter(Boolean), required: value.required ?? true });
      await block.locator("label", { hasText: pick }).first().click();
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
      const date = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(value.value) ?? /^(\d{1,2})\/(\d{4})$/.exec(value.value);
      if (!date) throw new NeedsAnswerError({ key: value.key, label: `${value.label} (a date)`, type: "text", required: value.required ?? true });
      const [year, month, day] = date[0].includes("/") ? [date[2], date[1].padStart(2, "0"), undefined] : [date[1], date[2], date[3]];
      const part = async (name: string, text: string | undefined) => {
        const input = block.locator(`[data-automation-id="${name}"]`).first();
        if (text && (await input.count()) > 0) await typeInto(input, text);
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
        await typeInto(search, value.value);
        await page.keyboard.press("Enter");
        await page.waitForTimeout(1500);
        const suggestions = page.locator('[data-automation-id="promptOption"], [role="listbox"] [role="option"]');
        const texts = (await suggestions.allInnerTexts().catch(() => [] as string[])).map((text) => text.trim()).filter(Boolean);
        const pick = bestOption(texts, value.value) ?? (texts.length === 1 ? texts[0] : undefined);
        if (!pick) throw new NeedsAnswerError({ key: value.key, label: `${value.label} (nothing matched "${value.value.slice(0, 40)}")`, type: "text", required: value.required ?? true });
        await suggestions.filter({ hasText: pick }).first().click();
        return;
      }
      const input = block.locator('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([data-automation-id="beecatcher"])').first();
      await typeInto(input, value.value);
      await input.press("Tab");
    }
  }
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
        if (errors) throw new Error(`Workday did not accept "${before || "this page"}": ${errors.slice(0, 300)}`);
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
      if (errors && (await activeStep(page)) === before) throw new Error(`Workday did not accept "${before}": ${errors.slice(0, 300)}`);
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
