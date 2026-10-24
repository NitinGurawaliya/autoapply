import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "playwright";
import { joinChoices, splitChoices } from "@/lib/choices";
import { customQuestionKey } from "@/modules/answers";
import type { AtsAdapter, FilledField, FormField, ResolvedValue, SubmitResult } from "../adapter";
import { NeedsAnswerError, NoRetryError, NotSentError } from "../adapter";
import { assertJobOpen, dismissOverlays, firstVisible, friendlyError, inField } from "./common";

// Lever hosts every company's form on jobs.lever.co/<company>/<id>/apply (jobs.eu.lever.co for the EU).
function formUrl(job: { applyUrl: string }) {
  const url = job.applyUrl.split(/[?#]/)[0].replace(/\/+$/, "");
  return /\/apply$/i.test(url) ? url : `${url}/apply`;
}

const norm = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();
const byName = (name: string) => `[name="${name.replace(/"/g, '\\"')}"]`;

// Lever names the fixed fields instead of labelling them with ids, so tell the mapper what they are.
function hintFor(name: string): string | undefined {
  const lower = name.toLowerCase();
  if (lower === "name") return "full_name";
  if (lower === "email") return "email";
  if (lower === "phone") return "phone";
  if (lower === "org") return "current_company";
  if (lower === "location") return "city";
  if (lower === "resume") return "resume";
  if (lower === "urls[linkedin]") return "linkedin";
  if (lower === "urls[github]") return "github";
  if (lower === "urls[portfolio]") return "portfolio";
  return undefined;
}

type Row = { name: string; label: string; kind: string; required: boolean; options?: string[] };

// Runs inside the page. A plain string on purpose: tsx would wrap named helpers in a function the page does not have.
const READ_FORM = `(() => {
  const form = document.querySelector('#application-form') || document;
  const rows = [];
  const seen = new Set();
  const clean = (text) => (text || '').replace(/\\u2731/g, '').replace(/\\s+/g, ' ').trim();
  form.querySelectorAll('li.application-question').forEach((li) => {
    if (li.querySelector('.awli-button-container')) return;
    const labelEl = li.querySelector('.application-label');
    const textEl = labelEl ? labelEl.querySelector('.text') : null;
    const label = clean(textEl ? textEl.textContent : labelEl ? labelEl.textContent : '');
    const required = Boolean(li.querySelector('.required-field, .application-label .required, .text .required'));
    const controls = Array.from(li.querySelectorAll('input, select, textarea')).filter((c) => c.type !== 'hidden' && c.name);
    const groups = new Map();
    controls.forEach((c) => groups.set(c.name, [...(groups.get(c.name) || []), c]));
    groups.forEach((list, name) => {
      if (seen.has(name)) return;
      seen.add(name);
      const first = list[0];
      const optionLabel = (c) => clean((c.closest('label') || c.parentElement).textContent);
      if (first.type === 'file') rows.push({ name, label: label || 'Resume/CV', kind: 'file', required: true });
      else if (first.id === 'location-input') rows.push({ name, label: label || 'Current location', kind: 'location', required });
      else if (first.tagName === 'SELECT') rows.push({ name, label, kind: 'select', required, options: Array.from(first.options).filter((o) => o.value).map((o) => clean(o.textContent)) });
      else if (first.tagName === 'TEXTAREA') rows.push({ name, label, kind: 'textarea', required });
      else if (first.type === 'radio') rows.push({ name, label, kind: 'radio', required, options: list.map(optionLabel) });
      else if (first.type === 'checkbox' && list.length > 1) rows.push({ name, label, kind: 'checkbox-group', required, options: list.map(optionLabel) });
      else if (first.type === 'checkbox') rows.push({ name, label: label || optionLabel(first), kind: 'checkbox', required });
      else rows.push({ name, label, kind: 'text', required });
    });
  });
  const file = form.querySelector('input[type=file][name=resume]');
  if (file && !seen.has('resume')) rows.push({ name: 'resume', label: 'Resume/CV', kind: 'file', required: true });
  return rows;
})()`;

async function readFields(page: Page): Promise<FormField[]> {
  await page
    .locator("#application-form")
    .waitFor({ timeout: 25000 })
    .catch(async (error) => {
      await assertJobOpen(page);
      throw error;
    });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
  const rows = (await page.evaluate(READ_FORM)) as Row[];
  const fields: FormField[] = [];
  for (const row of rows) {
    // The optional demographic survey is left blank: an unanswered question is the same as "decline to answer".
    if (row.name.startsWith("surveysResponses") && !row.required) continue;
    fields.push({
      selector: byName(row.name),
      label: row.label || row.name,
      type: row.kind,
      required: row.required,
      options: row.options,
      hintKey: hintFor(row.name),
    });
  }
  return fields;
}

/** Lever reads the resume after it is attached; wait for that to finish before touching the form. */
async function attachFile(page: Page, value: ResolvedValue, bytes: Uint8Array) {
  const name = value.fileName ?? "resume.pdf";
  const dir = await mkdtemp(join(tmpdir(), "swipeapply-"));
  const cleanup = async () => {
    await rm(dir, { recursive: true, force: true });
  };
  try {
    const file = join(dir, name);
    await writeFile(file, bytes);
    await page.locator('input[name="resume"]').setInputFiles(file);
    // The file name appears in the resume row (shown in capitals by the page's CSS), then "Analyzing resume..."
    // gives way to "Success!" once the parser has filled what it could.
    await page.waitForFunction(
      (fileName) => {
        const shown = document.querySelector("li.application-question.resume .filename")?.textContent ?? "";
        // innerText, not textContent: the "Analyzing" message stays in the page, hidden, after it is done.
        const row = (document.querySelector("li.application-question.resume") as HTMLElement | null)?.innerText ?? "";
        return shown.toLowerCase().includes(fileName.toLowerCase()) && !/analy[sz]ing resume/i.test(row);
      },
      name,
      { timeout: 45000 },
    );
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

async function fillLocation(page: Page, value: ResolvedValue) {
  const input = page.locator("#location-input");
  await input.scrollIntoViewIfNeeded();
  await input.click();
  await input.fill("");
  await input.pressSequentially(value.value, { delay: 60 });
  const results = page.locator(".dropdown-results .dropdown-location");
  await results.first().waitFor({ timeout: 8000 }).catch(() => undefined);
  const texts = (await results.allInnerTexts()).map((text) => text.trim());
  if (texts.length === 0) {
    await input.fill("");
    // An optional location with no match is skipped; a required one asks the user for another search word.
    if (!value.required) return null;
    throw new NeedsAnswerError({ key: customQuestionKey(value.label), label: `${value.label} (nothing matched "${value.value}", try another search word)`, type: "text", required: true });
  }
  const index = Math.max(0, pickLabel(texts, value.value));
  await results.nth(index).click();
  await page.waitForFunction(() => Boolean((document.querySelector("#selected-location") as HTMLInputElement | null)?.value), undefined, { timeout: 5000 }).catch(() => undefined);
  return texts[index];
}

const CONFIRMATION = /application submitted|thank you for applying|thanks for applying|we('| ha)ve received your application/i;

async function captchaChallengeVisible(page: Page) {
  const frames = page.locator('iframe[src*="hcaptcha.com"][title*="challenge" i]');
  const count = await frames.count();
  for (let index = 0; index < count; index += 1) {
    const box = await frames.nth(index).boundingBox();
    if (box && box.height > 120 && (await frames.nth(index).isVisible())) return true;
  }
  return false;
}

async function invalidFieldLabels(page: Page) {
  return page.evaluate(
    `Array.from(document.querySelectorAll('#application-form :invalid')).map((el) => {
      const li = el.closest('li');
      const label = li && li.querySelector('.application-label');
      return ((label && label.textContent) || el.getAttribute('name') || '').replace(/\\u2731/g, '').replace(/\\s+/g, ' ').trim();
    }).filter(Boolean)`,
  ) as Promise<string[]>;
}

export async function waitForLeverConfirmation(page: Page, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (/\/thanks\b|\/confirmation\b/i.test(page.url())) return `url ${page.url().replace(/[0-9a-f-]{36}/i, "<id>")}`;
    const body = await page.locator("body").innerText().catch(() => "");
    const match = body.match(CONFIRMATION);
    if (match) return `text "${match[0]}"`;
    if (await captchaChallengeVisible(page)) throw new NoRetryError("Lever showed a CAPTCHA. Open the form and submit it yourself.");
    const invalid = await invalidFieldLabels(page);
    if (invalid.length > 0 && Date.now() > deadline - timeoutMs + 6000) {
      throw new NoRetryError(`Lever rejected the form: ${[...new Set(invalid)].slice(0, 5).join(", ")}`);
    }
    await page.waitForTimeout(1000);
  }
  throw new NoRetryError("Submit clicked but no confirmation appeared. Check your email before applying again.");
}

export const leverAdapter: AtsAdapter = {
  source: "lever",
  matches(url: string) {
    return /lever\.co/i.test(url);
  },
  formUrl,
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
        const target = page.locator(value.selector);
        if (value.type === "location") return fillLocation(page, value);
        if (value.type === "select") {
          await target.first().selectOption({ label: value.value }).catch(async () => {
            await target.first().selectOption(value.value);
          });
          return value.value;
        }
        if (value.type === "radio" || value.type === "checkbox-group") {
          const labels = await target.evaluateAll((nodes) => nodes.map((node) => ((node.closest("label") ?? node.parentElement)?.textContent ?? "").replace(/\s+/g, " ").trim()));
          // A checkbox group may hold several choices, one per line (lib/choices.ts); a radio holds one.
          const wanted = value.type === "checkbox-group" ? splitChoices(value.value) : [value.value];
          const picked: string[] = [];
          for (const choice of wanted) {
            const index = pickLabel(labels, choice);
            if (index < 0) throw new Error(`No option "${choice}" for "${value.label}"`);
            await target.nth(index).check({ force: true });
            picked.push(labels[index]);
          }
          return joinChoices(picked);
        }
        if (value.type === "checkbox") {
          if (/^(yes|true|checked|agree|i agree|1)$/i.test(value.value.trim())) await target.first().check({ force: true });
          else await target.first().uncheck({ force: true });
          return value.value;
        }
        await target.first().fill(value.value);
        return value.value;
      });
      if (written === null) continue;
      filled.push({ key: value.key, label: value.label, value: written, source: value.source, selector: value.selector });
    }
    return filled;
  },
  async submit(page, ctx): Promise<SubmitResult> {
    await dismissOverlays(page);
    // Lever's own validation says what is missing; clicking Submit with a hole in the form only costs a bad attempt.
    const missing = await invalidFieldLabels(page);
    if (missing.length > 0) throw new NoRetryError(`Lever needs these filled before it will submit: ${[...new Set(missing)].slice(0, 5).join(", ")}`);
    const button = await firstVisible(page, ["#hcaptchaSubmitBtn", "button[type=submit].postings-btn", "#btn-submit", "button[type=submit]"], 20000);
    if (!button) throw new NoRetryError("The Submit button never appeared on the Lever form. Open the form and submit it yourself.");
    await button.scrollIntoViewIfNeeded().catch(() => undefined);
    await ctx.markAttempted?.();
    try {
      await button.click({ timeout: 15000 });
    } catch (error) {
      throw new NotSentError(`Could not press Submit on the Lever form: ${friendlyError(error)}`);
    }
    const evidence = await waitForLeverConfirmation(page);
    return { confirmed: true, evidence };
  },
};
